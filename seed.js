// Creates the first admin account (safe to re-run) and sample products for any subject without one.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, one, pool } = require('./src/db');

(async () => {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const pass = process.env.ADMIN_PASSWORD;
  if (!email || !pass) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  const hash = await bcrypt.hash(pass, 10);
  if (await one('SELECT id FROM users WHERE email=?', [email])) {
    await query("UPDATE users SET password_hash=?, role='admin', active=1 WHERE email=?", [hash, email]);
    console.log('Admin updated:', email);
  } else {
    await query("INSERT INTO users (name,email,password_hash,role) VALUES ('Administrator',?,?,'admin')", [email, hash]);
    console.log('Admin created:', email);
  }
  // Placeholder bundle products so the catalogue is purchasable; change prices in the admin area.
  const subs = await query('SELECT s.id, s.name, q.code FROM subjects s JOIN qualifications q ON q.id=s.qualification_id');
  for (const s of subs) {
    if (!(await one("SELECT id FROM products WHERE type='subject' AND subject_id=?", [s.id])))
      await query("INSERT INTO products (type,subject_id,name,price) VALUES ('subject',?,?,150)", [s.id, `${s.code} ${s.name} - Complete Collection`]);
  }
  for (const q of await query('SELECT id, code FROM qualifications')) {
    if (!(await one("SELECT id FROM products WHERE type='qualification' AND qualification_id=?", [q.id])))
      await query("INSERT INTO products (type,qualification_id,name,price) VALUES ('qualification',?,?,500)", [q.id, `${q.code} - Complete (All Papers)`]);
  }
  console.log('Seed complete.');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
