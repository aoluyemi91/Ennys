function requireAuthApi(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'unauthenticated' });
}

function requireAuthPage(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect('/login');
}

module.exports = { requireAuthApi, requireAuthPage };
