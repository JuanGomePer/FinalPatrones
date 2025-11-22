require("../../otel");

require("dotenv").config();
const broker = require("../broker");
const db = require("../db");

async function connectWithRetry(retries = 10, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(
        `Worker: intentando conectar a RabbitMQ... (intento ${i + 1})`
      );
      const { conn, channel } = await broker.connect();
      console.log("Worker: conectado a RabbitMQ");
      return { conn, channel };
    } catch (err) {
      console.error("Worker: error conectando a RabbitMQ:", err.message);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(
    "Worker: no se pudo conectar a RabbitMQ después de varios intentos"
  );
}

(async () => {
  const { conn, channel } = await connectWithRetry();

  const q = await channel.assertQueue("message_new_queue", { durable: true });
  await channel.bindQueue(q.queue, "chat", "message.new");

  console.log("Worker listening for message.new ...");

  channel.consume(q.queue, async (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      const { roomId, content, user, clientGeneratedId, createdAt } = payload;

      const insertQ = `
        INSERT INTO messages(room_id, user_id, content, created_at)
        VALUES($1,$2,$3,$4)
        RETURNING id, room_id, user_id, content, created_at
      `;

      const created = createdAt || new Date().toISOString();
      const res = await db.query(insertQ, [roomId, user.id, content, created]);

      const saved = res.rows[0];

      const broadcast = {
        roomId,
        message: {
          id: saved.id,
          content: saved.content,
          created_at: saved.created_at,
          user: user,
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
})();
