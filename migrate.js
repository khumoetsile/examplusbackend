// Applies database/migrations/*.sql in order, once each (tracked in schema_migrations).
// Run automatically by the deploy pipeline; safe to run by hand: `npm run migrate`.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// "Already exists" errors mean a fresh install (schema.sql) already contains the change.
const BENIGN = new Set(['ER_DUP_FIELDNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_DUP_KEYNAME', 'ER_CANT_DROP_FIELD_OR_KEY']);

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, multipleStatements: true,
  });
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  // On the server the folder sits beside app.js; in the repo it is one level up.
  const dir = [path.join(__dirname, 'database', 'migrations'), path.join(__dirname, '..', 'database', 'migrations')].find(fs.existsSync);
  const files = dir ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [];
  const [done] = await db.query('SELECT name FROM schema_migrations');
  const applied = new Set(done.map((r) => r.name));
  for (const f of files) {
    if (applied.has(f)) continue;
    // Run statement by statement so one "already exists" does not skip the rest of the file.
    const stmts = fs.readFileSync(path.join(dir, f), 'utf8').split(/;\s*(?:\r?\n|$)/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
    for (const sql of stmts) {
      try { await db.query(sql); }
      catch (e) { if (!BENIGN.has(e.code)) throw new Error(`${f}: ${e.message}`); }
    }
    await db.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
    console.log('applied', f);
  }
  console.log(files.length ? 'Migrations up to date.' : 'No migrations found.');
  await db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
