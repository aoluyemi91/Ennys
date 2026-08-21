require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { requireAuthApi, requireAuthPage } = require('./middleware/requireAuth');
const errorHandler = require('./middleware/errorHandler');

const PORT = process.env.PORT || 4000;

// Seed/refresh the single admin account from .env on every boot.
// Login always checks against this DB row, keeping .env as the source of truth.
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
  db.prepare(
    `INSERT INTO admin_users (username, password_hash) VALUES (?, ?)
     ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`
  ).run(process.env.ADMIN_USERNAME, hash);
}

const app = express();

// Stripe webhook needs the untouched raw body for signature verification, so it
// must be registered BEFORE the global express.json() body parser below.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/stripeWebhook'));

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

// Separate session scope for customers (distinct cookie, never touches admin auth).
const customerSession = session({
  name: 'ennys.customer.sid',
  secret: process.env.CUSTOMER_SESSION_SECRET || 'dev-customer-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 }
});

// Public: admin login page + login assets
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Public: standalone product-variations demo page — proof-of-concept only,
// not the real storefront.
app.get('/product-demo', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'product-demo.html'));
});

// Public: customer storefront home — the site root is now the customer-facing
// store; the admin dashboard moved to /admin (see below).
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'store', 'index.html'));
});

// Public: auth API (login/logout/session-check) + health check + read-only storefront API
app.use('/api/auth', require('./routes/auth'));
app.get('/api/health', (req, res) => res.json({ ok: true, dbConnected: true }));
app.use('/api/storefront', require('./routes/storefront'));

// Customer-facing account + checkout API — own session scope, own auth middleware.
app.use('/api/account', customerSession, require('./routes/account'));
app.use('/api/checkout', customerSession, require('./routes/checkout'));

// Everything else under /api requires an active ADMIN session
app.use('/api', requireAuthApi);
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api', require('./routes/promotions'));
app.use('/api/cms', require('./routes/cms'));
app.use('/api/settings', require('./routes/settings'));

// Admin dashboard, now at /admin (moved off the site root to make room for the
// customer storefront). Requires an active admin session; kept in views/ (not
// statically served) so it can't be fetched directly, bypassing the auth gate.
app.get('/admin', requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Printable order invoice — same auth gate as the dashboard, kept out of public/.
app.get('/admin/invoice', requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'invoice.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Ennys backend listening on http://localhost:${PORT}`);
});
