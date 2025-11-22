require("../../otel"); // before anything else

require("dotenv").config();
const WebSocket = require("ws");
const url = require("url");
const jwtUtils = require("../utils/jwt");
const { connect } = require("../broker"); // <-- FIXED

const WS_PORT = process.env.WS_PORT || 4000;

(async () => {
  let channel;

  // ---- RabbitMQ retry logic ----
  async function connectRabbitMQ(retries = 10) {
    while (retries > 0) {
      try {
        console.log("WS trying to connect to RabbitMQ...");
        const { conn, channel: ch } = await connect();
        console.log("WS connected to RabbitMQ");
        return ch;
      } catch (err) {
        console.error("WS RabbitMQ error:", err.message);
        retries--;
        console.log(`Retrying in 3s... (${retries} retries left)`);
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
    throw new Error("WS could not connect to RabbitMQ");
  }

  channel = await connectRabbitMQ();

  // -----------------------------------------------------
  // NOW RabbitMQ is ready → you can safely assert queues
  // -----------------------------------------------------
  const { queue } = await channel.assertQueue("broadcast_queue", {
    durable: true,
  });
  await channel.bindQueue("broadcast_queue", "chat", "message.persisted");

  // Start WebSocket server AFTER RabbitMQ works
  const wss = new WebSocket.Server({ port: WS_PORT });
  console.log("WebSocket server running on port", WS_PORT);

  const rooms = new Map();

  // ----------------------------------------------------------------
  //  Worker → WS broadcast: worker persists messages, WS distributes
  // ----------------------------------------------------------------
  channel.consume("broadcast_queue", (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      const { roomId, message } = payload;

      const set = rooms.get(roomId);
      if (set) {
        for (const client of set) {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type: "message", data: message }));
          }
        }
      }
      channel.ack(msg);
    } catch (e) {
      console.error("Failed processing broadcast", e);
      channel.nack(msg, false, false);
    }
  });

  // ----------------------------------------------------------------
  //  WS → RabbitMQ
  // ----------------------------------------------------------------
  wss.on("connection", (ws, req) => {
    const parsed = url.parse(req.url, true);
    const token = parsed.query.token;

    if (!token) {
      ws.close(4001, "missing token");
      return;
    }

    let payload;
    try {
      payload = jwtUtils.verify(token);
    } catch {
      ws.close(4002, "invalid token");
      return;
    }

    const user = { id: payload.sub, username: payload.username };

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "join") {
          const roomId = msg.roomId;
          if (!rooms.has(roomId)) rooms.set(roomId, new Set());
          rooms.get(roomId).add({ ws, user });

          await channel.publish(
            "chat",
            "room.joined",
            Buffer.from(JSON.stringify({ roomId, user })),
            { persistent: true }
          );
        } else if (msg.type === "leave") {
          const roomId = msg.roomId;
          const set = rooms.get(roomId);

          if (set) {
            for (const client of Array.from(set)) {
              if (client.ws === ws) set.delete(client);
            }
            if (set.size === 0) rooms.delete(roomId);
          }

          await channel.publish(
            "chat",
            "room.left",
            Buffer.from(JSON.stringify({ roomId, user })),
            { persistent: true }
          );
        } else if (msg.type === "message") {
          const payload = {
            roomId: msg.roomId,
            content: msg.content,
            user,
            clientGeneratedId: msg.clientId ?? null,
            createdAt: new Date().toISOString(),
          };

          await channel.publish(
            "chat",
            "message.new",
            Buffer.from(JSON.stringify(payload)),
            { persistent: true }
          );
        }
      } catch (err) {
        console.error("WS message error:", err);
      }
    });

    ws.on("close", () => {
      for (const [roomId, set] of rooms.entries()) {
        for (const client of Array.from(set)) {
          if (client.ws === ws) set.delete(client);
        }
        if (set.size === 0) rooms.delete(roomId);
      }
    });
  });
})();
