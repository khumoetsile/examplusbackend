require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  charset: 'utf8mb4',
});

const query = async (sql, params = []) => (await pool.query(sql, params))[0];
const one = async (sql, params = []) => (await query(sql, params))[0] || null;

const audit = (userId, action, detail) =>
  query('INSERT INTO audit_log (user_id, action, detail) VALUES (?,?,?)', [
    userId || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
  ]).catch((e) => console.error('audit failed', e.message));

const getCurrency = async () => (await one("SELECT v FROM settings WHERE k='currency'"))?.v || 'BWP';

module.exports = { pool, query, one, audit, getCurrency };
