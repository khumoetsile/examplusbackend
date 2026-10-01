const { one, query } = require('./db');

// Does this user hold a live entitlement covering the paper (directly, via subject or via qualification)?
async function hasPaperAccess(userId, paperId) {
  const row = await one(
    `SELECT e.id FROM entitlements e
       JOIN products pr ON pr.id = e.product_id
       JOIN papers p ON p.id = ?
       JOIN subjects s ON s.id = p.subject_id
      WHERE e.user_id = ? AND e.revoked = 0
        AND (e.expires_at IS NULL OR e.expires_at > NOW())
        AND ( (pr.type='paper' AND pr.paper_id = p.id)
           OR (pr.type='subject' AND pr.subject_id = s.id)
           OR (pr.type='qualification' AND pr.qualification_id = s.qualification_id) )
      LIMIT 1`, [paperId, userId]);
  return !!row;
}

// Live entitlement rows with product info.
const listEntitlements = (userId) =>
  query(
    `SELECT e.id, e.granted_at, e.expires_at, pr.id AS product_id, pr.type, pr.name,
            pr.paper_id, pr.subject_id, pr.qualification_id
       FROM entitlements e JOIN products pr ON pr.id = e.product_id
      WHERE e.user_id=? AND e.revoked=0 AND (e.expires_at IS NULL OR e.expires_at > NOW())
      ORDER BY e.granted_at DESC`, [userId]);

// Grants entitlements for every item in an order (idempotent per order).
async function grantOrder(orderId) {
  const order = await one('SELECT * FROM orders WHERE id=?', [orderId]);
  if (!order) return;
  const exists = await one('SELECT id FROM entitlements WHERE order_id=? LIMIT 1', [orderId]);
  if (exists) return;
  const items = await query(
    `SELECT oi.product_id, pr.access_days FROM order_items oi JOIN products pr ON pr.id=oi.product_id
      WHERE oi.order_id=?`, [orderId]);
  for (const it of items) {
    await query(
      `INSERT INTO entitlements (user_id, product_id, order_id, expires_at)
       VALUES (?,?,?, IF(? IS NULL, NULL, DATE_ADD(NOW(), INTERVAL ? DAY)))`,
      [order.user_id, it.product_id, orderId, it.access_days, it.access_days]);
  }
}

module.exports = { hasPaperAccess, listEntitlements, grantOrder };
