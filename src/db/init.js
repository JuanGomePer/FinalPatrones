const db = require('./index');

// Ejecuta SQL ignorando errores en "already exists"
async function runSafe(query) {
  try {
    await db.query(query);
  } catch (err) {
    if (!String(err.message).includes('already exists')) {
      console.error("❌ DB INIT ERROR:", err);
    }
  }
}

async function initDb() {
  console.log("🔍 Inicializando base de datos...");

  // Extensiones necesarias para UUID
  await runSafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
  await runSafe(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // USERS
  await runSafe(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // ROOMS
  await runSafe(`
    CREATE TABLE IF NOT EXISTS rooms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(150) NOT NULL,
      is_private BOOLEAN DEFAULT FALSE,
      password TEXT,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // ROOM MEMBERS
  await runSafe(`
    CREATE TABLE IF NOT EXISTS room_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(room_id, user_id)
    );
  `);

  // MESSAGES
  await runSafe(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // INDEXES (para optimizar búsquedas)
  await runSafe(`CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at DESC);`);
  await runSafe(`CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);`);

  console.log("✅ Base de datos lista.");
}

module.exports = initDb;
