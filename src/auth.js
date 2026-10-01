const jwt = require('jsonwebtoken');
const { one } = require('./db');

const secret = () => process.env.JWT_SECRET;
const sign = (u) => jwt.sign({ id: u.id, role: u.role }, secret(), { expiresIn: '7d' });

// Attaches req.user if a valid token is present (never rejects).
async function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const p = jwt.verify(h.slice(7), secret());
      const u = await one('SELECT id, name, email, role, active FROM users WHERE id=?', [p.id]);
      if (u && u.active) req.user = u;
    } catch { /* ignore invalid token */ }
  }
  next();
}

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Please sign in.' });

const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required.' });

module.exports = { sign, optionalAuth, requireAuth, requireAdmin };
