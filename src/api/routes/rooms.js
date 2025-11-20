const express = require('express');
const db = require('../../db');
const { verify } = require('../../utils/jwt');

const router = express.Router();

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'missing auth' });
  const token = auth.split(' ')[1];
  try {
    req.user = verify(token);
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// create room
router.post('/', authMiddleware, async (req, res) => {
  const { name, is_private, password } = req.body;
  const q = 'INSERT INTO rooms(name, is_private, password, created_by) VALUES($1,$2,$3,$4) RETURNING *';
  const { rows } = await db.query(q, [name, !!is_private, password || null, req.user.sub]);
  res.json(rows[0]);
});

// list rooms
router.get('/', authMiddleware, async (req, res) => {
  const { rows } = await db.query('SELECT id, name, is_private, created_at FROM rooms ORDER BY created_at DESC');
  res.json(rows);
});

// join room (adds to room_members if allowed)
router.post('/:roomId/join', authMiddleware, async (req, res) => {
  const { roomId } = req.params;
  const { password } = req.body;
  const r = await db.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
  const room = r.rows[0];
  if (!room) return res.status(404).json({ error: 'room not found' });
  if (room.is_private && room.password !== password) return res.status(403).json({ error: 'invalid room password' });
  await db.query('INSERT INTO room_members(room_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [roomId, req.user.sub]);
  res.json({ ok: true });
});

// history paginated
router.get('/:roomId/messages', authMiddleware, async (req, res) => {
  const { roomId } = req.params;
  const page = parseInt(req.query.page || '1', 10);
  const pageSize = parseInt(req.query.pageSize || '20', 10);
  const offset = (page - 1) * pageSize;
  const q = `
    SELECT m.id, m.content, m.created_at, u.id as user_id, u.username
    FROM messages m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.room_id = $1
    ORDER BY m.created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const { rows } = await db.query(q, [roomId, pageSize, offset]);
  res.json({ page, pageSize, messages: rows });
});

module.exports = router;
