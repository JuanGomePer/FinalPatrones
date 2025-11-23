// Must be required first for OpenTelemetry
require("../../otel");
require("dotenv").config();

const WebSocket = require("ws");
const url = require("url");
const jwtUtils = require("../utils/jwt");
const { connect } = require("../broker");

const WS_PORT = process.env.WS_PORT || 4000;

(async () => {
  let channel;

  async function connectRabbitMQ(retries = 10) {
    while (retries > 0) {
      try {
        console.log("[WS] Trying to connect to RabbitMQ...");
        const { channel: ch } = await connect();
        console.log("[WS] Connected to RabbitMQ");
        return ch;
      } catch (err) {
        console.error("[WS] RabbitMQ error:", err.message);
        retries--;
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
    throw new Error("WS could not connect to RabbitMQ");
  }

  channel = await connectRabbitMQ();

  // Queue for persisted messages
  await channel.assertQueue("broadcast_queue", { durable: true });
  await channel.bindQueue("broadcast_queue", "chat", "message.persisted");

  const wss = new WebSocket.Server({ port: WS_PORT });
  console.log("[WS] Server running on port", WS_PORT);

  const rooms = new Map();

  // RABBITMQ → WS BROADCAST
  channel.consume("broadcast_queue", (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      const { roomId, message } = payload;

      const set = rooms.get(roomId);
      if (!set) return channel.ack(msg);

      console.log(`[WS] Broadcasting to ${set.size} clients in room ${roomId}`);
      for (const client of set) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: "message", data: message }));
        }
      }

      channel.ack(msg);
    } catch (err) {
      console.error("[WS] Failed processing broadcast:", err);
      channel.nack(msg, false, false);
    }
  });

  // WS → RabbitMQ
  wss.on("connection", (ws, req) => {
    const parsed = url.parse(req.url, true);
    const token = parsed.query.token;

    if (!token) return ws.close(4001, "missing token");

    let payload;
    try {
      payload = jwtUtils.verify(token);
    } catch {
      return ws.close(4002, "invalid token");
    }

    const user = { id: payload.sub, username: payload.username };

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const roomId = msg.roomId;

        if (msg.type === "join") {
          if (!rooms.has(roomId)) rooms.set(roomId, new Set());
          rooms.get(roomId).add({ ws, user });

          await channel.publish(
            "chat",
            "room.joined",
            Buffer.from(JSON.stringify({ roomId, user })),
            { persistent: true }
          );
        } else if (msg.type === "leave") {
          const set = rooms.get(roomId);
          if (set) {
            for (const client of Array.from(set))
              if (client.ws === ws) set.delete(client);
            if (set.size === 0) rooms.delete(roomId);
          }

          await channel.publish(
            "chat",
            "room.left",
            Buffer.from(JSON.stringify({ roomId, user })),
            { persistent: true }
          );
        } else if (msg.type === "message") {
          const messagePayload = {
            roomId,
            content: msg.content,
            user,
            clientGeneratedId: msg.clientId ?? null,
            createdAt: new Date().toISOString(),
          };

          await channel.publish(
            "chat",
            "message.new",
            Buffer.from(JSON.stringify(messagePayload)),
            { persistent: true }
          );
        }
      } catch (err) {
        console.error("[WS] message error:", err);
      }
    });

    ws.on("close", () => {
      for (const [roomId, set] of rooms.entries()) {
        for (const client of Array.from(set))
          if (client.ws === ws) set.delete(client);
        if (set.size === 0) rooms.delete(roomId);
      }
    });
  });
})();
