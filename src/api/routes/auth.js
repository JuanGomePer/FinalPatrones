const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { sign } = require('../../utils/jwt');

const router = express.Router();

// Register (simple)
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username & password required' });
  const hash = await bcrypt.hash(password, 10);
  const q = 'INSERT INTO users(username, password_hash) VALUES($1, $2) RETURNING id, username';
  try {
    const { rows } = await db.query(q, [username, hash]);
    const user = rows[0];
    const token = sign({ sub: user.id, username: user.username });
    res.json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'username taken' });
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const q = 'SELECT id, username, password_hash FROM users WHERE username = $1';
  const { rows } = await db.query(q, [username]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const token = sign({ sub: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username } });
});

module.exports = router;
