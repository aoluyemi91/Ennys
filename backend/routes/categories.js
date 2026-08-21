const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY display_order, name').all();
  res.json(rows.map(r => ({ ...r, visible: !!r.visible })));
});

router.put('/reorder', (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of category ids' });
  const stmt = db.prepare('UPDATE categories SET display_order = ? WHERE id = ?');
  const tx = db.transaction((ids) => {
    ids.forEach((id, i) => stmt.run(i, id));
  });
  tx(order);
  res.json({ ok: true });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const b = req.body || {};
  db.prepare(
    `UPDATE categories SET name = @name, emoji = @emoji, visible = @visible, display_order = @display_order WHERE id = @id`
  ).run({
    id: req.params.id,
    name: b.name ?? existing.name,
    emoji: b.emoji ?? existing.emoji,
    visible: b.visible != null ? (b.visible ? 1 : 0) : existing.visible,
    display_order: b.display_order != null ? b.display_order : existing.display_order
  });
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

module.exports = router;
