function requireCustomerAuthApi(req, res, next) {
  if (req.session && req.session.customerId) return next();
  return res.status(401).json({ error: 'unauthenticated' });
}

module.exports = { requireCustomerAuthApi };
