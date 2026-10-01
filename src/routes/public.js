const router = require('express').Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { query, one, audit, getCurrency } = require('../db');
const { sign, requireAuth } = require('../auth');
const { hasPaperAccess, listEntitlements } = require('../access');
const dpo = require('../dpo');
const { cur, priceCols, money, applyVoucher, markPaid } = require('../orders');

const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '');
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Auth ----------
router.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !EMAIL_RE.test(email || '') || (password || '').length < 8)
    return res.status(400).json({ error: 'Enter your name, a valid email and a password of at least 8 characters.' });
  const mail = email.trim().toLowerCase();
  if (await one('SELECT id FROM users WHERE email=?', [mail]))
    return res.status(409).json({ error: 'An account with this email already exists.' });
  const hash = await bcrypt.hash(password, 10);
  const r = await query('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)', [name.trim(), mail, hash]);
  const user = await one('SELECT * FROM users WHERE id=?', [r.insertId]);
  audit(user.id, 'register', mail);
  res.json({ token: sign(user), user: publicUser(user) });
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await one('SELECT * FROM users WHERE email=?', [String(email || '').trim().toLowerCase()]);
  if (!user || !user.active || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    audit(null, 'login_failed', email);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

router.get('/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- Catalog ----------
async function productFor(where, id) {
  return one(`SELECT ${priceCols('pr')} FROM products pr WHERE pr.active=1 AND pr.price>0 AND pr.${where}=? LIMIT 1`, [id]);
}

router.get('/catalog/qualifications', async (_req, res) => {
  const quals = await query(
    `SELECT q.id, q.code, q.name, q.description,
            (SELECT COUNT(*) FROM subjects s WHERE s.qualification_id=q.id AND s.active=1) AS subject_count
       FROM qualifications q WHERE q.active=1 ORDER BY q.sort_order, q.name`);
  res.json({ currency: await getCurrency(), qualifications: quals });
});

router.get('/catalog/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  res.json(await query(
    `SELECT s.id, s.name, qu.code AS qualification FROM subjects s JOIN qualifications qu ON qu.id=s.qualification_id
      WHERE s.active=1 AND qu.active=1 AND (s.name LIKE ? OR qu.code LIKE ?) ORDER BY qu.sort_order, s.name LIMIT 12`, [`%${q}%`, `%${q}%`]));
});

router.get('/catalog/qualifications/:code', async (req, res) => {
  const q = await one('SELECT * FROM qualifications WHERE code=? AND active=1', [req.params.code]);
  if (!q) return res.status(404).json({ error: 'Qualification not found.' });
  const subjects = await query(
    `SELECT s.id, s.name,
            (SELECT COUNT(*) FROM papers p WHERE p.subject_id=s.id AND p.active=1) AS paper_count
       FROM subjects s WHERE s.qualification_id=? AND s.active=1 ORDER BY s.name`, [q.id]);
  res.json({
    currency: await getCurrency(), qualification: q, subjects,
    bundle: await productFor('qualification_id', q.id),
  });
});

router.get('/catalog/subjects/:id', async (req, res) => {
  const s = await one(
    `SELECT s.id, s.name, q.code AS qualification_code, q.name AS qualification_name, q.id AS qualification_id
       FROM subjects s JOIN qualifications q ON q.id=s.qualification_id WHERE s.id=? AND s.active=1`, [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Subject not found.' });
  const papers = await query(
    `SELECT p.id, p.exam_year, p.paper_type, pr.id AS product_id, ${cur('pr')} AS price, pr.price AS regular_price, (${cur('pr')} < pr.price) AS on_sale, pr.sale_label
       FROM papers p LEFT JOIN products pr ON pr.paper_id=p.id AND pr.type='paper' AND pr.active=1 AND pr.price>0
      WHERE p.subject_id=? AND p.active=1 ORDER BY p.exam_year DESC, p.paper_type`, [s.id]);
  let ents = [];
  if (req.user) ents = await listEntitlements(req.user.id);
  const covers = (e, p) =>
    (e.type === 'paper' && e.paper_id === p.id) ||
    (e.type === 'subject' && e.subject_id === s.id) ||
    (e.type === 'qualification' && e.qualification_id === s.qualification_id);
  for (const p of papers) p.owned = ents.some((e) => covers(e, p));
  res.json({
    currency: await getCurrency(), subject: s, papers,
    subjectBundle: await productFor('subject_id', s.id),
    qualificationBundle: await productFor('qualification_id', s.qualification_id),
    ownsSubject: ents.some((e) => (e.type === 'subject' && e.subject_id === s.id) ||
      (e.type === 'qualification' && e.qualification_id === s.qualification_id)),
  });
});

const loadBasket = async (ids) =>
  ids.length ? query(`SELECT ${priceCols('pr')}, pr.type FROM products pr WHERE pr.active=1 AND pr.price>0 AND pr.id IN (?)`, [ids]) : [];

const parseIds = (b) => [...new Set((b?.productIds || []).map(Number).filter(Boolean))];

// Public product info for the checkout page.
router.get('/catalog/products/:id', async (req, res) => {
  const [p] = await loadBasket([Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'This item is not available for purchase.' });
  res.json({ product: p, currency: await getCurrency() });
});

// Live voucher check for the checkout page.
router.post('/vouchers/validate', requireAuth, async (req, res) => {
  const ids = parseIds(req.body);
  const products = await loadBasket(ids);
  if (!products.length || products.length !== ids.length) return res.status(400).json({ error: 'Item not available.' });
  const subtotal = money(products.reduce((a, p) => a + Number(p.price), 0));
  try {
    const { voucher, discount } = await applyVoucher(req.body.code, req.user.id, products, subtotal);
    res.json({ code: voucher.code, description: voucher.description, subtotal, discount, total: money(subtotal - discount) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Orders & payments ----------
router.post('/orders', requireAuth, async (req, res) => {
  const ids = parseIds(req.body);
  if (!ids.length) return res.status(400).json({ error: 'Nothing selected.' });
  const products = await loadBasket(ids);
  if (products.length !== ids.length) return res.status(400).json({ error: 'A selected item is no longer available.' });
  const subtotal = money(products.reduce((a, p) => a + Number(p.price), 0));
  let discount = 0, code = null;
  if (req.body.voucherCode) {
    try {
      const a = await applyVoucher(req.body.voucherCode, req.user.id, products, subtotal);
      discount = a.discount; code = a.voucher.code;
    } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  const total = money(subtotal - discount);
  const currency = await getCurrency();
  const r = await query('INSERT INTO orders (user_id,subtotal,discount,voucher_code,total,currency) VALUES (?,?,?,?,?,?)',
    [req.user.id, subtotal, discount, code, total, currency]);
  const orderId = r.insertId;
  for (const p of products)
    await query('INSERT INTO order_items (order_id,product_id,name,price) VALUES (?,?,?,?)', [orderId, p.product_id, p.name, p.price]);
  audit(req.user.id, 'order_created', { orderId, total, voucher: code });
  // A voucher that covers the whole price needs no payment.
  if (total <= 0) {
    await markPaid(orderId, 'VOUCHER');
    return res.json({ orderId, free: true, payUrl: `/payment/result?order=${orderId}&status=paid` });
  }
  try {
    const t = await dpo.createToken({
      order: { id: orderId, total, currency },
      description: products.map((p) => p.name).join(', '),
      appUrl: appUrl(),
    });
    await query('UPDATE orders SET dpo_token=?, dpo_trans_ref=? WHERE id=?', [t.token, t.ref, orderId]);
    res.json({ orderId, payUrl: t.payUrl });
  } catch (e) {
    console.error(e);
    await query("UPDATE orders SET status='failed' WHERE id=?", [orderId]);
    audit(req.user.id, 'dpo_error', e.message);
    res.status(502).json({ error: 'The payment gateway is unavailable. Please try again shortly.' });
  }
});

async function settle(order) {
  if (order.status === 'paid' || !order.dpo_token) return order;
  const v = await dpo.verifyToken(order.dpo_token);
  if (v.status === 'paid') {
    await markPaid(order.id, v.ref);
  } else if (v.status === 'failed' || v.status === 'cancelled') {
    await query('UPDATE orders SET status=? WHERE id=? AND status="pending"', [v.status, order.id]);
    audit(order.user_id, `payment_${v.status}`, { orderId: order.id, code: v.raw });
  }
  return one('SELECT * FROM orders WHERE id=?', [order.id]);
}

// DPO sends the learner back here; we never trust the redirect, we verify with DPO server-side.
router.get('/payments/return', async (req, res) => {
  const token = req.query.TransactionToken || req.query.token;
  const order = token && (await one('SELECT * FROM orders WHERE dpo_token=?', [String(token)]));
  if (!order) return res.redirect('/payment/result?status=unknown');
  const o = await settle(order);
  res.redirect(`/payment/result?order=${o.id}&status=${o.status}`);
});

router.get('/payments/cancel', async (req, res) => {
  const order = await one('SELECT * FROM orders WHERE id=?', [Number(req.query.order) || 0]);
  if (order && order.status === 'pending') {
    const o = await settle(order);
    return res.redirect(`/payment/result?order=${o.id}&status=${o.status === 'pending' ? 'cancelled' : o.status}`);
  }
  res.redirect(`/payment/result?order=${order?.id || ''}&status=${order?.status || 'cancelled'}`);
});

router.get('/orders/:id', requireAuth, async (req, res) => {
  let o = await one('SELECT * FROM orders WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (o.status === 'pending') o = await settle(o);
  const items = await query('SELECT name, price FROM order_items WHERE order_id=?', [o.id]);
  res.json({ order: { id: o.id, status: o.status, total: o.total, currency: o.currency, created_at: o.created_at }, items });
});

// Built-in mock gateway, only active when no DPO company token is configured.
router.get('/payments/mock', (req, res) => {
  if (dpo.live() || !dpo.mockAllowed()) return res.status(404).end();
  const t = encodeURIComponent(String(req.query.token || ''));
  res.type('html').send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<body style="font-family:sans-serif;max-width:420px;margin:15vh auto;text-align:center">
<h2>Mock payment gateway</h2><p>Testing only. No DPO credentials are configured.</p>
<a href="/api/payments/mock/result?token=${t}&outcome=paid" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none">Simulate successful payment</a>
<a href="/api/payments/mock/result?token=${t}&outcome=cancelled" style="display:inline-block;padding:12px 24px;background:#6b7280;color:#fff;border-radius:8px;text-decoration:none;margin-left:8px">Cancel</a></body>`);
});
router.get('/payments/mock/result', (req, res) => {
  if (dpo.live() || !dpo.mockAllowed()) return res.status(404).end();
  const token = String(req.query.token || '');
  dpo.setMock(token, req.query.outcome === 'paid' ? 'paid' : 'cancelled');
  res.redirect(`/api/payments/return?TransactionToken=${encodeURIComponent(token)}`);
});

// ---------- My papers & protected viewing ----------
router.get('/my/papers', requireAuth, async (req, res) => {
  const ents = await listEntitlements(req.user.id);
  const papers = await query(
    `SELECT DISTINCT p.id, p.exam_year, p.paper_type, s.id AS subject_id, s.name AS subject, q.code AS qualification
       FROM papers p JOIN subjects s ON s.id=p.subject_id JOIN qualifications q ON q.id=s.qualification_id
      WHERE p.active=1 AND (
        p.id IN (SELECT paper_id FROM products pr JOIN entitlements e ON e.product_id=pr.id
                  WHERE e.user_id=? AND e.revoked=0 AND (e.expires_at IS NULL OR e.expires_at>NOW()) AND pr.type='paper')
        OR s.id IN (SELECT subject_id FROM products pr JOIN entitlements e ON e.product_id=pr.id
                  WHERE e.user_id=? AND e.revoked=0 AND (e.expires_at IS NULL OR e.expires_at>NOW()) AND pr.type='subject')
        OR q.id IN (SELECT qualification_id FROM products pr JOIN entitlements e ON e.product_id=pr.id
                  WHERE e.user_id=? AND e.revoked=0 AND (e.expires_at IS NULL OR e.expires_at>NOW()) AND pr.type='qualification'))
      ORDER BY q.code, s.name, p.exam_year DESC`, [req.user.id, req.user.id, req.user.id]);
  const orders = await query(
    'SELECT id,subtotal,discount,voucher_code,total,currency,status,created_at,paid_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50', [req.user.id]);
  res.json({ products: ents, papers, orders });
});

router.get('/papers/:id/meta', requireAuth, async (req, res) => {
  const p = await one(
    `SELECT p.id, p.exam_year, p.paper_type, s.name AS subject, q.code AS qualification
       FROM papers p JOIN subjects s ON s.id=p.subject_id JOIN qualifications q ON q.id=s.qualification_id
      WHERE p.id=? AND p.active=1`, [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Paper not found.' });
  if (req.user.role !== 'admin' && !(await hasPaperAccess(req.user.id, p.id)))
    return res.status(403).json({ error: 'You have not purchased this paper.' });
  res.json({ paper: p, viewer: req.user.email });
});

// The file is streamed only to authorised, signed-in users; it is never a public URL.
router.get('/papers/:id/file', requireAuth, async (req, res) => {
  const p = await one('SELECT * FROM papers WHERE id=? AND active=1', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Paper not found.' });
  if (req.user.role !== 'admin' && !(await hasPaperAccess(req.user.id, p.id))) {
    audit(req.user.id, 'paper_denied', p.id);
    return res.status(403).json({ error: 'You have not purchased this paper.' });
  }
  const file = path.join(__dirname, '..', '..', 'storage', 'papers', path.basename(p.file_name));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File missing on server.' });
  audit(req.user.id, 'paper_view', p.id);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
});

module.exports = router;
