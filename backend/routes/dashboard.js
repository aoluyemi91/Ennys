const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/summary', (req, res) => {
  const todayRevenue = db.prepare(
    `SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE date(created_at) = date('now')`
  ).get().s;
  const yesterdayRevenue = db.prepare(
    `SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE date(created_at) = date('now','-1 day')`
  ).get().s;
  const ordersToday = db.prepare(
    `SELECT COUNT(*) AS c FROM orders WHERE date(created_at) = date('now')`
  ).get().c;
  const ordersYesterday = db.prepare(
    `SELECT COUNT(*) AS c FROM orders WHERE date(created_at) = date('now','-1 day')`
  ).get().c;
  const activeProducts = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE status = 'active'`).get().c;
  const lowStock = db.prepare(
    `SELECT COUNT(*) AS c FROM products WHERE stock_quantity > 0 AND stock_quantity <= 5`
  ).get().c;
  const avgOrderValue = db.prepare(`SELECT COALESCE(AVG(total),0) AS a FROM orders`).get().a;

  res.json({
    todayRevenue,
    revenueChangePct: yesterdayRevenue > 0 ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100) : 0,
    ordersToday,
    ordersChange: ordersToday - ordersYesterday,
    activeProducts,
    lowStock,
    avgOrderValue: Math.round(avgOrderValue * 100) / 100
  });
});

router.get('/revenue', (req, res) => {
  const rows = db.prepare(
    `SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS rev, COUNT(*) AS orders
     FROM orders
     WHERE created_at >= datetime('now','-7 days')
     GROUP BY day ORDER BY day`
  ).all();
  res.json(rows);
});

router.get('/top-products', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 5;
  const rows = db.prepare(
    `SELECT id, name, emoji, sales_count AS sales FROM products ORDER BY sales_count DESC LIMIT ?`
  ).all(limit);
  res.json(rows);
});

router.get('/recent-orders', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 6;
  res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit));
});

router.get('/stock-alerts', (req, res) => {
  const out = db.prepare(`SELECT id, name, emoji FROM products WHERE stock_quantity = 0 AND status = 'active'`).all();
  const low = db.prepare(
    `SELECT id, name, emoji, stock_quantity FROM products WHERE stock_quantity > 0 AND stock_quantity <= 5 AND status = 'active'`
  ).all();
  res.json({ out, low });
});

router.get('/activity', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  res.json(db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit));
});

module.exports = router;
