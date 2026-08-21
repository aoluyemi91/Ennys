const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireCustomerAuthApi } = require('../middleware/requireCustomerAuth');

const router = express.Router();

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function serializeCustomer(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    addressLine1: c.address_line1,
    addressLine2: c.address_line2,
    city: c.city,
    postcode: c.postcode
  };
}

router.post('/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes('@')) return res.status(400).json({ error: 'A valid email is required' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.prepare('SELECT id FROM customers WHERE lower(email) = ?').get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO customers (name, email, password_hash) VALUES (?, ?, ?)'
  ).run(name.trim(), normalizedEmail, passwordHash);

  req.session.customerId = info.lastInsertRowid;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(serializeCustomer(customer));
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const customer = db.prepare('SELECT * FROM customers WHERE lower(email) = ?').get(normalizedEmail);
  if (!customer || !customer.password_hash || !bcrypt.compareSync(password || '', customer.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.customerId = customer.id;
  res.json(serializeCustomer(customer));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ennys.customer.sid');
    res.json({ ok: true });
  });
});

router.get('/session', (req, res) => {
  if (!req.session || !req.session.customerId) return res.json({ loggedIn: false });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.session.customerId);
  if (!customer) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, customer: serializeCustomer(customer) });
});

router.get('/profile', requireCustomerAuthApi, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.session.customerId);
  if (!customer) return res.status(404).json({ error: 'Account not found' });
  res.json(serializeCustomer(customer));
});

router.put('/profile', requireCustomerAuthApi, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.session.customerId);
  if (!existing) return res.status(404).json({ error: 'Account not found' });
  db.prepare(
    `UPDATE customers SET name = @name, phone = @phone, address_line1 = @address_line1,
      address_line2 = @address_line2, city = @city, postcode = @postcode WHERE id = @id`
  ).run({
    id: req.session.customerId,
    name: (b.name || existing.name).trim(),
    phone: b.phone ?? existing.phone,
    address_line1: b.addressLine1 ?? existing.address_line1,
    address_line2: b.addressLine2 ?? existing.address_line2,
    city: b.city ?? existing.city,
    postcode: b.postcode ?? existing.postcode
  });
  res.json(serializeCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.session.customerId)));
});

router.put('/password', requireCustomerAuthApi, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.session.customerId);
  if (!customer || !customer.password_hash || !bcrypt.compareSync(currentPassword || '', customer.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').run(hash, req.session.customerId);
  res.json({ ok: true });
});

router.get('/orders', requireCustomerAuthApi, (req, res) => {
  const orders = db.prepare(
    `SELECT * FROM orders WHERE customer_id = ? AND payment_status = 'paid' ORDER BY created_at DESC`
  ).all(req.session.customerId);
  res.json(orders);
});

router.get('/orders/:id', requireCustomerAuthApi, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.session.customerId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ ...order, items });
});

module.exports = router;
