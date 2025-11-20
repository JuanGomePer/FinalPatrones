require('dotenv').config();
const WebSocket = require('ws');
const url = require('url');
const jwtUtils = require('../utils/jwt');
const broker = require('../broker');

const WS_PORT = process.env.WS_PORT || 4000;

(async () => {
  const { conn, channel } = await broker.connect();

  // queue for receiving persisted messages to broadcast
  const { queue } = await channel.assertQueue('broadcast_queue', { durable: true });
  await channel.bindQueue('broadcast_queue', 'chat', 'message.persisted');

  const wss = new WebSocket.Server({ port: WS_PORT });
  console.log('WebSocket server running on port', WS_PORT);

  // map roomId -> Set of ws connections metadata {ws, user}
  const rooms = new Map();

  // handle delivering broadcast messages from worker (persisted)
  channel.consume('broadcast_queue', msg => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      const { roomId, message } = payload; // message contains id, content, user...
      const set = rooms.get(roomId);
      if (set) {
        for (const client of set) {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type: 'message', data: message }));
          }
        }
      }
      channel.ack(msg);
    } catch (e) {
      console.error('Failed processing broadcast', e);
      channel.nack(msg, false, false);
    }
  });

  wss.on('connection', (ws, req) => {
    // Expect token in query ?token=...
    const parsed = url.parse(req.url, true);
    const token = parsed.query.token;
    if (!token) {
      ws.close(4001, 'missing token');
      return;
    }
    let payload;
    try {
      payload = jwtUtils.verify(token);
    } catch (e) {
      ws.close(4002, 'invalid token');
      return;
    }
    const user = { id: payload.sub, username: payload.username };

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // message format: { type: 'join'|'leave'|'message', roomId, content }
        if (msg.type === 'join') {
          const roomId = msg.roomId;
          if (!rooms.has(roomId)) rooms.set(roomId, new Set());
          rooms.get(roomId).add({ ws, user });
          // notify room members
          const payload = { roomId, user: { id: user.id, username: user.username } };
          await channel.publish('chat', 'room.joined', Buffer.from(JSON.stringify(payload)), { persistent: true });
        } else if (msg.type === 'leave') {
          const roomId = msg.roomId;
          const set = rooms.get(roomId);
          if (set) {
            for (const client of Array.from(set)) {
              if (client.ws === ws) set.delete(client);
            }
            if (set.size === 0) rooms.delete(roomId);
          }
          const payload = { roomId, user: { id: user.id, username: user.username } };
          await channel.publish('chat', 'room.left', Buffer.from(JSON.stringify(payload)), { persistent: true });
        } else if (msg.type === 'message') {
          // publish new message to broker for worker to persist
          const payload = {
            roomId: msg.roomId,
            content: msg.content,
            user: { id: user.id, username: user.username },
            clientGeneratedId: msg.clientId || null,
            createdAt: new Date().toISOString()
          };
          await channel.publish('chat', 'message.new', Buffer.from(JSON.stringify(payload)), { persistent: true });
        }
      } catch (err) {
        console.error('ws message error', err);
      }
    });

    ws.on('close', () => {
      // cleanup: remove ws from all rooms
      for (const [roomId, set] of rooms.entries()) {
        for (const client of Array.from(set)) {
          if (client.ws === ws) set.delete(client);
        }
        if (set.size === 0) rooms.delete(roomId);
      }
      // Optionally publish leave events (omitted to avoid noise)
    });
  });
})();
