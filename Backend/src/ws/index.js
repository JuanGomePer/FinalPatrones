// Must be required first for OpenTelemetry
require("../../otel");
require("dotenv").config();

const WebSocket = require("ws");
const url = require("url");
const jwtUtils = require("../utils/jwt");
const { connect } = require("../broker");
const client = require("prom-client");
const express = require("express");

const WS_PORT = process.env.WS_PORT || 4000;

// --------------------------
// Prometheus metrics
// --------------------------
const wsMessagesReceived = new client.Counter({
  name: "ws_messages_received_total",
  help: "Total number of WebSocket messages received",
});

const wsMessagesBroadcasted = new client.Counter({
  name: "ws_messages_broadcasted_total",
  help: "Total number of WebSocket messages broadcasted",
});

const wsMessageDuration = new client.Histogram({
  name: "ws_message_duration_seconds",
  help: "Time taken to process and broadcast a WS message",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

// Expose metrics for Prometheus
const metricsApp = express();
metricsApp.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});
metricsApp.listen(9090, () => {
  console.log("[WS] Prometheus metrics server running on port 9090");
});

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
        console.log(`[WS] Retrying in 3s... (${retries} retries left)`);
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
    throw new Error("WS could not connect to RabbitMQ");
  }

  channel = await connectRabbitMQ();

  await channel.assertQueue("broadcast_queue", { durable: true });
  await channel.bindQueue("broadcast_queue", "chat", "message.persisted");

  const wss = new WebSocket.Server({ port: WS_PORT });
  console.log("[WS] Server running on port", WS_PORT);

  const rooms = new Map();

  function logRooms() {
    console.log("[WS] Current rooms and users:");
    for (const [roomId, set] of rooms.entries()) {
      const usernames = Array.from(set).map((c) => c.user.username);
      console.log(`  Room ${roomId}: ${usernames.join(", ")}`);
    }
  }

  // --------------------------
  // RABBITMQ → WS BROADCAST
  // --------------------------
  channel.consume("broadcast_queue", (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      const { roomId, message } = payload;

      const set = rooms.get(roomId);
      if (!set) {
        console.log(`[WS] No clients in room ${roomId}, skipping broadcast`);
        return channel.ack(msg);
      }

      console.log(
        `[WS] Broadcasting message to ${set.size} clients in room ${roomId}`
      );
      console.log(
        `  Message content: ${message.content} from user ${message.user.username}`
      );

      // Measure broadcast duration
      const end = wsMessageDuration.startTimer();
      for (const client of set) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: "message", data: message }));
          wsMessagesBroadcasted.inc();
        }
      }
      end();

      logRooms();
      channel.ack(msg);
    } catch (err) {
      console.error("[WS] Failed processing broadcast:", err);
      channel.nack(msg, false, false);
    }
  });

  // --------------------------
  // WS → RabbitMQ
  // --------------------------
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
    console.log(`[WS] New WS connection from user ${user.username}`);

    ws.on("message", async (raw) => {
      try {
        wsMessagesReceived.inc();
        const timerEnd = wsMessageDuration.startTimer();

        const msg = JSON.parse(raw.toString());
        const roomId = msg.roomId;

        console.log(
          `[WS] Received message type "${msg.type}" from ${user.username}`
        );

        if (msg.type === "join") {
          if (!rooms.has(roomId)) rooms.set(roomId, new Set());
          rooms.get(roomId).add({ ws, user });
          console.log(`[WS] ${user.username} joined room ${roomId}`);
          logRooms();

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
          console.log(`[WS] ${user.username} left room ${roomId}`);
          logRooms();

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
          console.log(
            `[WS] Publishing message from ${user.username} to RabbitMQ`
          );
          await channel.publish(
            "chat",
            "message.new",
            Buffer.from(JSON.stringify(messagePayload)),
            { persistent: true }
          );
        }

        timerEnd(); // record duration
      } catch (err) {
        console.error("[WS] message error:", err);
      }
    });

    ws.on("close", () => {
      console.log(`[WS] Connection closed for user ${user.username}`);
      for (const [roomId, set] of rooms.entries()) {
        for (const client of Array.from(set))
          if (client.ws === ws) set.delete(client);
        if (set.size === 0) rooms.delete(roomId);
      }
      logRooms();
    });
  });
})();
