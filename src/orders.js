const { query, one, audit } = require('./db');
const { grantOrder } = require('./access');

// SQL for the price a learner pays right now (special price while its window is open).
const cur = (a = 'pr') =>
  `IF(${a}.sale_price IS NOT NULL AND (${a}.sale_starts IS NULL OR ${a}.sale_starts <= NOW()) AND (${a}.sale_ends IS NULL OR ${a}.sale_ends > NOW()), ${a}.sale_price, ${a}.price)`;
const priceCols = (a = 'pr') =>
  `${a}.id AS product_id, ${a}.name, ${cur(a)} AS price, ${a}.price AS regular_price, (${cur(a)} < ${a}.price) AS on_sale, ${a}.sale_label, ${a}.sale_ends`;

const money = (n) => Math.round(Number(n) * 100) / 100;

// Validates a voucher for this user/basket. Returns { voucher, discount } or throws Error(message).
async function applyVoucher(code, userId, products, subtotal) {
  const v = await one('SELECT * FROM vouchers WHERE code=?', [String(code || '').trim().toUpperCase()]);
  const fail = (m) => { throw new Error(m); };
  if (!v || !v.active) fail('That voucher code is not valid.');
  const now = new Date();
  if (v.starts_at && new Date(v.starts_at) > now) fail('This voucher is not active yet.');
  if (v.expires_at && new Date(v.expires_at) < now) fail('This voucher has expired.');
  if (v.max_uses !== null && v.used_count >= v.max_uses) fail('This voucher has been fully redeemed.');
  if (v.min_total && subtotal < Number(v.min_total)) fail(`This voucher needs a minimum spend of ${Number(v.min_total).toFixed(2)}.`);
  if (v.per_user_limit) {
    const used = await one("SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND voucher_code=? AND status='paid'", [userId, v.code]);
    if (used.n >= v.per_user_limit) fail('You have already used this voucher.');
  }
  let base = subtotal;
  if (v.product_id) {
    const p = products.find((x) => x.product_id === v.product_id);
    if (!p) fail('This voucher does not apply to the selected item.');
    base = Number(p.price);
  }
  const discount = money(v.type === 'percent' ? (base * Number(v.value)) / 100 : Math.min(Number(v.value), base));
  return { voucher: v, discount: Math.min(discount, subtotal) };
}

// Marks an order paid exactly once, records voucher use and grants access.
async function markPaid(orderId, ref) {
  const r = await query("UPDATE orders SET status='paid', paid_at=NOW(), dpo_trans_ref=COALESCE(?, dpo_trans_ref) WHERE id=? AND status<>'paid'", [ref || null, orderId]);
  if (r.affectedRows) {
    const o = await one('SELECT * FROM orders WHERE id=?', [orderId]);
    if (o.voucher_code) await query('UPDATE vouchers SET used_count=used_count+1 WHERE code=?', [o.voucher_code]);
    audit(o.user_id, 'payment_paid', { orderId, ref, voucher: o.voucher_code });
  }
  await grantOrder(orderId);
}

module.exports = { cur, priceCols, money, applyVoucher, markPaid };
