const express = require('express');
const db = require('../db');

const router = express.Router();
const VALID_GROUPS = ['store', 'delivery', 'notifications', 'payments'];

router.get('/:group', (req, res) => {
  if (!VALID_GROUPS.includes(req.params.group)) {
    return res.status(404).json({ error: 'Unknown settings group' });
  }
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(req.params.group);
  if (!row) return res.status(404).json({ error: 'Settings group not found' });
  res.json(JSON.parse(row.value_json));
});

router.put('/:group', (req, res) => {
  if (!VALID_GROUPS.includes(req.params.group)) {
    return res.status(404).json({ error: 'Unknown settings group' });
  }
  // Payments group only ever toggles boolean "connected" flags here — no real
  // Stripe/PayPal/Klarna API calls are made (out of scope for this pass).
  const value = JSON.stringify(req.body || {});
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`
  ).run(req.params.group, value);
  res.json(req.body || {});
});

module.exports = router;
