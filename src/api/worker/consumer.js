require('dotenv').config();
const broker = require('../broker');
const db = require('../db');

(async () => {
  const { conn, channel } = await broker.connect();

  // Ensure a queue for incoming messages
  const q = await channel.assertQueue('message_new_queue', { durable: true });
  await channel.bindQueue('message_new_queue', 'chat', 'message.new');

  console.log('Worker listening for message.new ...');

  channel.consume('message_new_queue', async (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString());
      const { roomId, content, user, clientGeneratedId, createdAt } = payload;
      // Persist into DB
      const insertQ = `INSERT INTO messages(room_id, user_id, content, created_at) VALUES($1,$2,$3,$4) RETURNING id, room_id, user_id, content, created_at`;
      const userId = user.id;
      const created = createdAt || new Date().toISOString();
      const res = await db.query(insertQ, [roomId, userId, content, created]);
      const saved = res.rows[0];

      // Build broadcast payload (include username)
      const broadcast = {
        roomId,
        message: {
          id: saved.id,
          content: saved.content,
          created_at: saved.created_at,
          user: { id: userId, username: user.username },
          clientGeneratedId: clientGeneratedId || null
        }
      };
      // publish persisted message
      channel.publish('chat', 'message.persisted', Buffer.from(JSON.stringify(broadcast)), { persistent: true });
      channel.ack(msg);
    } catch (err) {
      console.error('Worker failed to persist message', err);
      // nack with requeue or drop depending on error
      channel.nack(msg, false, false);
    }
  }, { noAck: false });
})();
