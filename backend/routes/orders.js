const express = require('express');
const db = require('../db');
const logActivity = require('../lib/activityLog');
const { sendOrderStatusEmail } = require('../lib/orderNotifications');

const router = express.Router();

function serializeOrder(o) {
  return o;
}

router.get('/', (req, res) => {
  const { search = '', status = '' } = req.query;
  let sql = `SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items FROM orders o`;
  const where = [];
  const params = {};
  if (search) {
    where.push('(order_number LIKE @search OR customer_name LIKE @search)');
    params.search = `%${search}%`;
  }
  if (status) {
    where.push('status = @status');
    params.status = status;
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(params);
  res.json(rows.map(serializeOrder));
});

router.get('/stats', (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const monthlyRevenue = db.prepare(
    `SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE created_at >= datetime('now','start of month')`
  ).get().s;
  const pendingDispatch = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'Processing'`).get().c;
  const totalReturns = db.prepare('SELECT COUNT(*) AS c FROM returns').get().c;
  const returnsRate = totalOrders > 0 ? (totalReturns / totalOrders) * 100 : 0;
  res.json({
    totalOrders,
    monthlyRevenue,
    pendingDispatch,
    returnsRate: Math.round(returnsRate * 10) / 10
  });
});

router.get('/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare(
    `SELECT oi.*, p.weight AS product_weight
     FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ?`
  ).all(o.id);
  const totalWeight = items.reduce((sum, it) => sum + (it.product_weight ? it.product_weight * it.quantity : 0), 0);
  res.json({ ...o, items, totalWeight });
});

router.patch('/:id/status', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const { status } = req.body || {};
  const valid = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (status === 'Shipped' || status === 'Delivered') {
    logActivity(`Order ${o.order_number} marked as ${status}`, '#0d47a1');
  }
  res.json({ ok: true, status });

  // Fire-and-forget: the customer email shouldn't hold up the admin's response.
  sendOrderStatusEmail(req.params.id, status);
});

module.exports = router;
