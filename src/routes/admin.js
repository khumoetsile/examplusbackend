const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query, one, audit } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { cur } = require('../orders');
const { removeCover } = require('../cover');

router.use(requireAuth, requireAdmin);

const dir = path.join(__dirname, '..', '..', 'storage', 'papers');
fs.mkdirSync(dir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: dir,
    filename: (_r, _f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.pdf'),
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
});

// Default access period (days) applied to newly created products; null = lifetime.
const defaultDays = async () => { const v = (await one("SELECT v FROM settings WHERE k='default_access_days'"))?.v; return v ? Number(v) : null; };
const bad = (res, msg) => res.status(400).json({ error: msg });
const flag = (v) => (v === false || v === 0 || v === '0' || v === 'false' ? 0 : 1);

// ---------- Qualifications ----------
router.get('/qualifications', async (_q, res) => res.json(await query('SELECT * FROM qualifications ORDER BY sort_order, name')));
router.post('/qualifications', async (req, res) => {
  const { code, name, description, sort_order } = req.body;
  if (!code?.trim() || !name?.trim()) return bad(res, 'Code and name are required.');
  const r = await query('INSERT INTO qualifications (code,name,description,sort_order) VALUES (?,?,?,?)',
    [code.trim().toUpperCase(), name.trim(), description || null, Number(sort_order) || 0]);
  await query("INSERT INTO products (type,qualification_id,name,price,access_days) VALUES ('qualification',?,?,0,?)", [r.insertId, `${code.trim().toUpperCase()} - Complete (All Papers)`, await defaultDays()]);
  audit(req.user.id, 'admin_qualification_create', code);
  res.json({ id: r.insertId });
});
router.put('/qualifications/:id', async (req, res) => {
  const { code, name, description, sort_order, active } = req.body;
  await query('UPDATE qualifications SET code=?,name=?,description=?,sort_order=?,active=? WHERE id=?',
    [String(code).trim().toUpperCase(), name, description || null, Number(sort_order) || 0, flag(active), req.params.id]);
  res.json({ ok: true });
});
router.delete('/qualifications/:id', async (req, res) => {
  await query('DELETE FROM qualifications WHERE id=?', [req.params.id]);
  audit(req.user.id, 'admin_qualification_delete', req.params.id);
  res.json({ ok: true });
});

// ---------- Subjects ----------
router.get('/subjects', async (_q, res) => res.json(await query(
  `SELECT s.*, q.code AS qualification_code FROM subjects s JOIN qualifications q ON q.id=s.qualification_id
    ORDER BY q.sort_order, s.name`)));
router.post('/subjects', async (req, res) => {
  const { qualification_id, name } = req.body;
  if (!qualification_id || !name?.trim()) return bad(res, 'Qualification and name are required.');
  const r = await query('INSERT INTO subjects (qualification_id,name) VALUES (?,?)', [qualification_id, name.trim()]);
  const q = await one('SELECT code FROM qualifications WHERE id=?', [qualification_id]);
  await query("INSERT INTO products (type,subject_id,name,price,access_days) VALUES ('subject',?,?,0,?)", [r.insertId, `${q?.code || ''} ${name.trim()} - Complete Collection`, await defaultDays()]);
  res.json({ id: r.insertId });
});
router.put('/subjects/:id', async (req, res) => {
  const { qualification_id, name, active } = req.body;
  await query('UPDATE subjects SET qualification_id=?,name=?,active=? WHERE id=?', [qualification_id, name, flag(active), req.params.id]);
  res.json({ ok: true });
});
router.delete('/subjects/:id', async (req, res) => {
  const papers = await query('SELECT file_name FROM papers WHERE subject_id=?', [req.params.id]);
  await query('DELETE FROM subjects WHERE id=?', [req.params.id]);
  papers.forEach((p) => fs.rm(path.join(dir, path.basename(p.file_name)), () => {}));
  audit(req.user.id, 'admin_subject_delete', req.params.id);
  res.json({ ok: true });
});

// ---------- Papers ----------
const uploadMany = upload.array('files', 40);
const isPdf = (p) => { const b = Buffer.alloc(5); const fd = fs.openSync(p, 'r'); fs.readSync(fd, b, 0, 5, 0); fs.closeSync(fd); return b.toString() === '%PDF-'; };
const nameFromFile = (n) => n.replace(/\.pdf$/i, '').replace(/[_+-]+/g, ' ').trim();

router.get('/papers', async (_q, res) => res.json(await query(
  `SELECT p.id, p.subject_id, p.exam_year, p.paper_type, p.original_name, p.active, p.created_at,
          s.name AS subject, q.code AS qualification, q.id AS qualification_id,
          pr.id AS product_id, pr.price, ${cur('pr')} AS current_price
     FROM papers p JOIN subjects s ON s.id=p.subject_id JOIN qualifications q ON q.id=s.qualification_id
     LEFT JOIN products pr ON pr.paper_id=p.id AND pr.type='paper'
    ORDER BY q.sort_order, s.name, p.exam_year DESC, p.paper_type`)));

// Upload one or many PDFs for a subject + year. With several files, each paper type defaults to its file name.
router.post('/papers', (req, res, next) => uploadMany(req, res, (e) => (e ? next(e) : next())), async (req, res) => {
  const files = req.files || [];
  const cleanup = () => files.forEach((f) => fs.rm(f.path, () => {}));
  const { subject_id, exam_year, paper_type, price } = req.body;
  if (!files.length || !subject_id || !exam_year) { cleanup(); return bad(res, 'Choose a subject, a year and at least one PDF.'); }
  if (files.some((f) => !isPdf(f.path))) { cleanup(); return bad(res, 'Only PDF files are accepted.'); }
  const subject = await one('SELECT s.name, q.code FROM subjects s JOIN qualifications q ON q.id=s.qualification_id WHERE s.id=?', [subject_id]);
  if (!subject) { cleanup(); return bad(res, 'Unknown subject.'); }
  const ids = [];
  const days = await defaultDays();
  for (const f of files) {
    const type = (files.length === 1 && paper_type?.trim()) || nameFromFile(f.originalname) || 'Paper 1';
    const r = await query('INSERT INTO papers (subject_id,exam_year,paper_type,file_name,original_name) VALUES (?,?,?,?,?)',
      [subject_id, Number(exam_year), type, f.filename, f.originalname]);
    await query("INSERT INTO products (type,paper_id,name,price,access_days) VALUES ('paper',?,?,?,?)",
      [r.insertId, `${subject.code} ${subject.name} ${exam_year} ${type}`, Number(price) || 0, days]);
    ids.push(r.insertId);
  }
  audit(req.user.id, 'admin_paper_upload', { ids });
  res.json({ ids });
});

// Edit details; optionally replace the PDF.
router.put('/papers/:id', upload.single('file'), async (req, res) => {
  const old = await one('SELECT file_name FROM papers WHERE id=?', [req.params.id]);
  if (!old) return bad(res, 'Paper not found.');
  const { subject_id, exam_year, paper_type, active } = req.body;
  let file = null;
  if (req.file) {
    if (!isPdf(req.file.path)) { fs.rm(req.file.path, () => {}); return bad(res, 'Only PDF files are accepted.'); }
    file = req.file;
  }
  await query('UPDATE papers SET subject_id=?,exam_year=?,paper_type=?,active=?' + (file ? ',file_name=?,original_name=?' : '') + ' WHERE id=?',
    [subject_id, Number(exam_year), paper_type, flag(active), ...(file ? [file.filename, file.originalname] : []), req.params.id]);
  if (file) { fs.rm(path.join(dir, path.basename(old.file_name)), () => {}); removeCover(old.file_name); }
  audit(req.user.id, 'admin_paper_update', { id: req.params.id, replaced: !!file });
  res.json({ ok: true });
});
router.delete('/papers/:id', async (req, res) => {
  const p = await one('SELECT file_name FROM papers WHERE id=?', [req.params.id]);
  await query('DELETE FROM papers WHERE id=?', [req.params.id]);
  if (p) { fs.rm(path.join(dir, path.basename(p.file_name)), () => {}); removeCover(p.file_name); }
  audit(req.user.id, 'admin_paper_delete', req.params.id);
  res.json({ ok: true });
});

// ---------- Pricing: products, sale prices and specials ----------
const dt = (v) => (v ? new Date(v) : null);
router.get('/products', async (_q, res) => res.json(await query(
  `SELECT pr.*, ${cur('pr')} AS current_price, (${cur('pr')} < pr.price) AS on_sale,
          COALESCE(q1.code, q2.code, q3.code) AS qualification, COALESCE(s1.name, s2.name) AS subject,
          pa.exam_year, pa.paper_type
     FROM products pr
     LEFT JOIN papers pa ON pa.id=pr.paper_id
     LEFT JOIN subjects s1 ON s1.id=pa.subject_id LEFT JOIN qualifications q1 ON q1.id=s1.qualification_id
     LEFT JOIN subjects s2 ON s2.id=pr.subject_id LEFT JOIN qualifications q2 ON q2.id=s2.qualification_id
     LEFT JOIN qualifications q3 ON q3.id=pr.qualification_id
    ORDER BY FIELD(pr.type,'qualification','subject','paper'), qualification, subject, pa.exam_year DESC, pa.paper_type`)));

router.post('/products', async (req, res) => {
  const { type, paper_id, subject_id, qualification_id, name, price, access_days } = req.body;
  if (!['paper', 'subject', 'qualification'].includes(type) || !name?.trim()) return bad(res, 'Type and name are required.');
  const target = { paper: paper_id, subject: subject_id, qualification: qualification_id }[type];
  if (!target) return bad(res, `Choose the ${type} this product unlocks.`);
  const r = await query('INSERT INTO products (type,paper_id,subject_id,qualification_id,name,price,access_days) VALUES (?,?,?,?,?,?,?)',
    [type, type === 'paper' ? target : null, type === 'subject' ? target : null, type === 'qualification' ? target : null,
      name.trim(), Number(price) || 0, access_days ? Number(access_days) : null]);
  res.json({ id: r.insertId });
});
router.put('/products/:id', async (req, res) => {
  const b = req.body;
  const sale = b.sale_price === '' || b.sale_price === null || b.sale_price === undefined ? null : Number(b.sale_price);
  if (sale !== null && (Number.isNaN(sale) || sale < 0)) return bad(res, 'Special price must be a number.');
  if (sale !== null && Number(b.price) && sale > Number(b.price)) return bad(res, 'The special price must be lower than the regular price.');
  await query('UPDATE products SET name=COALESCE(?,name), price=?, access_days=?, active=?, sale_price=?, sale_starts=?, sale_ends=?, sale_label=? WHERE id=?',
    [b.name || null, Number(b.price) || 0, b.access_days ? Number(b.access_days) : null, flag(b.active), sale,
      sale === null ? null : dt(b.sale_starts), sale === null ? null : dt(b.sale_ends), sale === null ? null : (b.sale_label || null), req.params.id]);
  audit(req.user.id, 'admin_product_update', { id: req.params.id, price: b.price, sale });
  res.json({ ok: true });
});
// Price-only update (used by the papers screen so specials are never overwritten).
router.put('/products/:id/price', async (req, res) => {
  const p = Number(req.body.price);
  if (Number.isNaN(p) || p < 0) return bad(res, 'Enter a valid price.');
  await query('UPDATE products SET price=? WHERE id=?', [p, req.params.id]);
  audit(req.user.id, 'admin_price_update', { id: req.params.id, price: p });
  res.json({ ok: true });
});
router.delete('/products/:id', async (req, res) => {
  await query('DELETE FROM products WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// Bulk special: X% off everything in a scope, for a date window.
router.post('/specials', async (req, res) => {
  const { scope, scope_id, type, percent, starts, ends, label } = req.body;
  const pct = Number(percent);
  if (!(pct > 0 && pct < 100)) return bad(res, 'Enter a discount between 1 and 99 percent.');
  const where = [], args = [];
  if (scope === 'qualification') {
    where.push('(pr.qualification_id=? OR pr.subject_id IN (SELECT id FROM subjects WHERE qualification_id=?) OR pr.paper_id IN (SELECT p.id FROM papers p JOIN subjects s ON s.id=p.subject_id WHERE s.qualification_id=?))');
    args.push(scope_id, scope_id, scope_id);
  } else if (scope === 'subject') {
    where.push('(pr.subject_id=? OR pr.paper_id IN (SELECT id FROM papers WHERE subject_id=?))');
    args.push(scope_id, scope_id);
  } else if (scope !== 'all') return bad(res, 'Choose where the special applies.');
  if (['paper', 'subject', 'qualification'].includes(type)) { where.push('pr.type=?'); args.push(type); }
  const r = await query(
    `UPDATE products pr SET sale_price=ROUND(pr.price*(1-?/100),2), sale_starts=?, sale_ends=?, sale_label=?
      WHERE pr.price>0 ${where.length ? 'AND ' + where.join(' AND ') : ''}`,
    [pct, dt(starts), dt(ends), label || `${pct}% off`, ...args]);
  audit(req.user.id, 'admin_special_apply', { scope, scope_id, type, pct, changed: r.affectedRows });
  res.json({ changed: r.affectedRows });
});
router.delete('/specials', async (req, res) => {
  const r = await query('UPDATE products SET sale_price=NULL, sale_starts=NULL, sale_ends=NULL, sale_label=NULL WHERE sale_price IS NOT NULL');
  audit(req.user.id, 'admin_special_clear', { changed: r.affectedRows });
  res.json({ changed: r.affectedRows });
});

// ---------- Vouchers ----------
router.get('/vouchers', async (_q, res) => res.json(await query(
  `SELECT v.*, pr.name AS product_name FROM vouchers v LEFT JOIN products pr ON pr.id=v.product_id ORDER BY v.id DESC`)));
const voucherFields = (b) => {
  const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new Error('Code must be 3-40 letters or numbers.');
  const type = b.type === 'fixed' ? 'fixed' : 'percent';
  const value = Number(b.value);
  if (!(value > 0) || (type === 'percent' && value > 100)) throw new Error('Enter a valid discount value.');
  return [code, b.description || null, type, value, Number(b.min_total) || 0, b.max_uses ? Number(b.max_uses) : null,
    b.per_user_limit === '' || b.per_user_limit === null || b.per_user_limit === undefined ? 1 : Number(b.per_user_limit),
    b.product_id ? Number(b.product_id) : null, dt(b.starts_at), dt(b.expires_at)];
};
router.post('/vouchers', async (req, res) => {
  let f; try { f = voucherFields(req.body); } catch (e) { return bad(res, e.message); }
  const r = await query('INSERT INTO vouchers (code,description,type,value,min_total,max_uses,per_user_limit,product_id,starts_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)', f);
  audit(req.user.id, 'admin_voucher_create', f[0]);
  res.json({ id: r.insertId });
});
router.put('/vouchers/:id', async (req, res) => {
  let f; try { f = voucherFields(req.body); } catch (e) { return bad(res, e.message); }
  await query('UPDATE vouchers SET code=?,description=?,type=?,value=?,min_total=?,max_uses=?,per_user_limit=?,product_id=?,starts_at=?,expires_at=?,active=? WHERE id=?',
    [...f, flag(req.body.active), req.params.id]);
  res.json({ ok: true });
});
router.delete('/vouchers/:id', async (req, res) => {
  await query('DELETE FROM vouchers WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- Orders, users, access ----------
router.get('/orders', async (_q, res) => res.json(await query(
  `SELECT o.id, o.subtotal, o.discount, o.voucher_code, o.total, o.currency, o.status, o.dpo_token, o.dpo_trans_ref, o.created_at, o.paid_at, u.email,
          (SELECT GROUP_CONCAT(name SEPARATOR ', ') FROM order_items WHERE order_id=o.id) AS items
     FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 500`)));

router.get('/users', async (_q, res) => res.json(await query(
  `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
          (SELECT COUNT(*) FROM entitlements e WHERE e.user_id=u.id AND e.revoked=0) AS active_access
     FROM users u ORDER BY u.id DESC LIMIT 1000`)));
router.put('/users/:id', async (req, res) => {
  if (Number(req.params.id) === req.user.id) return bad(res, 'You cannot change your own account here.');
  await query('UPDATE users SET active=?, role=? WHERE id=?',
    [flag(req.body.active), req.body.role === 'admin' ? 'admin' : 'learner', req.params.id]);
  audit(req.user.id, 'admin_user_update', { id: req.params.id, body: req.body });
  res.json({ ok: true });
});

router.get('/users/:id/access', async (req, res) => res.json(await query(
  `SELECT e.id, e.granted_at, e.expires_at, e.revoked, e.order_id, pr.name
     FROM entitlements e JOIN products pr ON pr.id=e.product_id WHERE e.user_id=? ORDER BY e.id DESC`, [req.params.id])));
router.post('/users/:id/access', async (req, res) => {
  const pr = await one('SELECT id, access_days FROM products WHERE id=?', [req.body.product_id]);
  if (!pr) return bad(res, 'Choose a product.');
  await query('INSERT INTO entitlements (user_id,product_id,expires_at) VALUES (?,?, IF(? IS NULL, NULL, DATE_ADD(NOW(), INTERVAL ? DAY)))',
    [req.params.id, pr.id, pr.access_days, pr.access_days]);
  audit(req.user.id, 'admin_access_grant', { user: req.params.id, product: pr.id });
  res.json({ ok: true });
});
router.put('/access/:id', async (req, res) => {
  await query('UPDATE entitlements SET revoked=? WHERE id=?', [flag(req.body.revoked), req.params.id]);
  audit(req.user.id, 'admin_access_change', { id: req.params.id, revoked: req.body.revoked });
  res.json({ ok: true });
});

// ---------- Reports, settings, audit ----------
router.get('/reports', async (_q, res) => {
  const totals = await one(
    `SELECT COUNT(*) AS orders_paid, COALESCE(SUM(total),0) AS revenue FROM orders WHERE status='paid'`);
  const users = await one("SELECT COUNT(*) AS n FROM users WHERE role='learner'");
  const views = await one("SELECT COUNT(*) AS n FROM audit_log WHERE action='paper_view'");
  const top = await query(
    `SELECT oi.name, COUNT(*) AS sales, SUM(oi.price) AS revenue FROM order_items oi
       JOIN orders o ON o.id=oi.order_id WHERE o.status='paid' GROUP BY oi.name ORDER BY sales DESC LIMIT 10`);
  const daily = await query(
    `SELECT DATE(paid_at) AS day, COUNT(*) AS orders, SUM(total) AS revenue FROM orders
      WHERE status='paid' AND paid_at > DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY DATE(paid_at) ORDER BY day`);
  res.json({ ...totals, learners: users.n, paper_views: views.n, top, daily });
});
router.get('/settings', async (_q, res) => res.json(Object.fromEntries((await query('SELECT k,v FROM settings')).map((r) => [r.k, r.v]))));
router.put('/settings', async (req, res) => {
  const b = req.body || {};
  if (b.currency !== undefined) {
    const cur = String(b.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) return bad(res, 'Enter a 3-letter currency code, e.g. BWP.');
    await query("INSERT INTO settings (k,v) VALUES ('currency',?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [cur]);
  }
  if (b.default_access_days !== undefined) {
    const d = b.default_access_days === '' || b.default_access_days === null ? '' : Number(b.default_access_days);
    if (d !== '' && !(Number.isInteger(d) && d > 0)) return bad(res, 'Access period must be a whole number of days.');
    await query("INSERT INTO settings (k,v) VALUES ('default_access_days',?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [String(d)]);
  }
  audit(req.user.id, 'admin_settings', b);
  res.json({ ok: true });
});
// Set the same access period on every existing product (affects future purchases only).
router.post('/settings/apply-access', async (req, res) => {
  const d = req.body.days === '' || req.body.days === null || req.body.days === undefined ? null : Number(req.body.days);
  if (d !== null && !(Number.isInteger(d) && d > 0)) return bad(res, 'Access period must be a whole number of days.');
  const r = await query('UPDATE products SET access_days=?', [d]);
  audit(req.user.id, 'admin_apply_access', { days: d, changed: r.affectedRows });
  res.json({ changed: r.affectedRows });
});
router.get('/audit', async (_q, res) => res.json(await query(
  `SELECT a.id, a.action, a.detail, a.created_at, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    ORDER BY a.id DESC LIMIT 300`)));

module.exports = router;
