require("../../otel");
require("dotenv").config();
const broker = require("../broker");
const db = require("../db");

async function connectWithRetry(retries = 10, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const { conn, channel } = await broker.connect();
      return { conn, channel };
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Worker: could not connect to RabbitMQ");
}

(async () => {
  const { channel } = await connectWithRetry();

  const q = await channel.assertQueue("message_new_queue", { durable: true });
  await channel.bindQueue(q.queue, "chat", "message.new");

  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const { roomId, content, user, clientGeneratedId, createdAt } =
        JSON.parse(msg.content.toString());

      const insertQ = `
        INSERT INTO messages(room_id, user_id, username, content, created_at)
        VALUES($1,$2,$3,$4,$5)
        RETURNING id, room_id, user_id, username, content, created_at
      `;
      const created = createdAt || new Date().toISOString();
      const res = await db.query(insertQ, [
        roomId,
        user.id,
        user.username,
        content,
        created,
      ]);

      const saved = res.rows[0];

      const broadcast = {
        roomId,
        message: {
          id: saved.id,
          content: saved.content,
          created_at: saved.created_at,
          user: { id: saved.user_id, username: saved.username },
          clientGeneratedId: clientGeneratedId || null,
        },
      };

      channel.publish(
        "chat",
        "message.persisted",
        Buffer.from(JSON.stringify(broadcast)),
        { persistent: true }
      );
      channel.ack(msg);
    } catch (err) {
      console.error("Worker error:", err);
      channel.nack(msg, false, false);
    }
  });

  const client = require("prom-client");

  // Create a counter for processed messages
  const messagesProcessed = new client.Counter({
    name: "worker_messages_processed_total",
    help: "Total number of messages processed by the worker",
  });

  // Expose metrics via HTTP for Prometheus to scrape
  const express = require("express");
  const app = express();

  app.get("/metrics", async (req, res) => {
    res.set("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
  });

  app.listen(9100, () => {
    console.log("Prometheus metrics server running on port 9100");
  });
})();
