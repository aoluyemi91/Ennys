const express = require('express');
const db = require('../db');
const logActivity = require('../lib/activityLog');

const router = express.Router();

router.get('/', (req, res) => {
  const { status = '' } = req.query;
  let sql = 'SELECT * FROM returns';
  const params = {};
  if (status) {
    sql += ' WHERE status = @status';
    params.status = status;
  }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(params));
});

router.get('/stats', (req, res) => {
  const open = db.prepare(`SELECT COUNT(*) AS c FROM returns WHERE status = 'Pending'`).get().c;
  const processedThisMonth = db.prepare(
    `SELECT COUNT(*) AS c FROM returns WHERE status = 'Processed' AND processed_at >= datetime('now','start of month')`
  ).get().c;
  const refundsIssued = db.prepare(
    `SELECT COALESCE(SUM(refund_amount),0) AS s FROM returns WHERE status = 'Processed' AND processed_at >= datetime('now','start of month')`
  ).get().s;
  res.json({ open, processedThisMonth, refundsIssued });
});

router.patch('/:id/approve', (req, res) => {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Return not found' });
  db.prepare(`UPDATE returns SET status = 'Processed', processed_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logActivity(`Return ${r.return_number} approved — £${Number(r.refund_amount).toFixed(2)} refund issued`, '#2e7d32');
  res.json({ ok: true });
});

router.patch('/:id/reject', (req, res) => {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Return not found' });
  db.prepare(`UPDATE returns SET status = 'Rejected', processed_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logActivity(`Return ${r.return_number} rejected`, '#c62828');
  res.json({ ok: true });
});

module.exports = router;
