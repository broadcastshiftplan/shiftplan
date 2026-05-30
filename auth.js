const jwt = require('jsonwebtoken');
const SECRET = () => process.env.JWT_SECRET || 'nobet-secret-2026-degistir';

const sign   = payload => jwt.sign(payload, SECRET(), { expiresIn: '30d' });
const verify = token   => { try { return jwt.verify(token, SECRET()); } catch { return null; } };

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Giriş gerekli' });
  const p = verify(t);
  if (!p) return res.status(401).json({ error: 'Oturum süresi doldu' });
  req.user = p;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Yönetici yetkisi gerekli' });
    next();
  });
}

module.exports = { sign, verify, requireAuth, requireAdmin };
