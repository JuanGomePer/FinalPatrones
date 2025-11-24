const { Pool } = require('pg');
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/chatdb';
const pool = new Pool({ connectionString });

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
