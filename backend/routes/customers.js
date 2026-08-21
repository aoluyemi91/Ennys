const express = require('express');
const db = require('../db');

const router = express.Router();

const BASE_SELECT = `
  SELECT c.id, c.name, c.email, c.location,
    COUNT(o.id) AS orders,
    COALESCE(SUM(o.total), 0) AS ltv,
    MAX(o.created_at) AS last_order
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.id
`;

router.get('/', (req, res) => {
  const { search = '' } = req.query;
  let sql = BASE_SELECT;
  const params = {};
  if (search) {
    sql += ' WHERE c.name LIKE @search OR c.email LIKE @search';
    params.search = `%${search}%`;
  }
  sql += ' GROUP BY c.id ORDER BY ltv DESC';
  res.json(db.prepare(sql).all(params));
});

router.get('/:id', (req, res) => {
  const customer = db.prepare(BASE_SELECT + ' WHERE c.id = @id GROUP BY c.id').get({ id: req.params.id });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const contact = db.prepare(
    'SELECT phone, address_line1, address_line2, city, postcode, created_at FROM customers WHERE id = ?'
  ).get(req.params.id);
  // NB: `customer.orders` (from BASE_SELECT) is the order COUNT — keep the full
  // order rows under a different key so it doesn't silently overwrite that count.
  const orderHistory = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...customer, ...contact, orderHistory });
});

module.exports = router;
