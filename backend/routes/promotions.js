const express = require('express');
const db = require('../db');

const router = express.Router();

// ── PROMO CODES ──
router.get('/promo-codes', (req, res) => {
  res.json(db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all());
});

router.post('/promo-codes', (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Promo code is required' });
  const typeMap = { 'Percentage (%)': 'percentage', 'Fixed Amount (£)': 'fixed', 'Free Delivery': 'free_delivery' };
  const type = typeMap[b.type] || b.type || 'percentage';
  db.prepare(
    `INSERT INTO promo_codes (code, type, value, min_order_value, max_uses, applies_to, expires_at)
     VALUES (@code, @type, @value, @min_order_value, @max_uses, @applies_to, @expires_at)`
  ).run({
    code,
    type,
    value: parseFloat(b.value) || 0,
    min_order_value: parseFloat(b.min) || 0,
    max_uses: b.maxUses ? parseInt(b.maxUses, 10) : null,
    applies_to: b.appliesTo || 'all',
    expires_at: b.expiresAt || null
  });
  res.status(201).json(db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code));
});

router.delete('/promo-codes/:id', (req, res) => {
  db.prepare('DELETE FROM promo_codes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── PROMO BANNERS ──
router.get('/promo-banners', (req, res) => {
  res.json(db.prepare('SELECT * FROM promo_banners ORDER BY sort_order').all());
});

router.put('/promo-banners/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM promo_banners WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Banner not found' });
  const b = req.body || {};
  db.prepare(
    `UPDATE promo_banners SET title=@title, subtitle=@subtitle, background_color=@background_color,
      cta_text=@cta_text, cta_link=@cta_link, active=@active WHERE id=@id`
  ).run({
    id: req.params.id,
    title: b.title ?? existing.title,
    subtitle: b.subtitle ?? existing.subtitle,
    background_color: b.background_color ?? existing.background_color,
    cta_text: b.cta_text ?? existing.cta_text,
    cta_link: b.cta_link ?? existing.cta_link,
    active: b.active != null ? (b.active ? 1 : 0) : existing.active
  });
  res.json(db.prepare('SELECT * FROM promo_banners WHERE id = ?').get(req.params.id));
});

// ── FLASH SALES ──
router.get('/flash-sales', (req, res) => {
  const rows = db.prepare('SELECT * FROM flash_sales ORDER BY created_at DESC').all();
  const productsStmt = db.prepare(
    `SELECT p.id, p.name FROM products p
     JOIN flash_sale_products fsp ON fsp.product_id = p.id
     WHERE fsp.flash_sale_id = ?`
  );
  res.json(rows.map(r => ({ ...r, products: productsStmt.all(r.id) })));
});

router.post('/flash-sales', (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Title is required' });
  const info = db.prepare(
    `INSERT INTO flash_sales (title, discount_percent, starts_at, ends_at, status)
     VALUES (@title, @discount_percent, @starts_at, @ends_at, @status)`
  ).run({
    title: b.title,
    discount_percent: parseFloat(b.discountPercent) || 0,
    starts_at: b.startsAt || null,
    ends_at: b.endsAt || null,
    status: b.status || 'scheduled'
  });
  const id = info.lastInsertRowid;
  const link = db.prepare('INSERT OR IGNORE INTO flash_sale_products (flash_sale_id, product_id) VALUES (?, ?)');
  (b.productIds || []).forEach(pid => link.run(id, pid));
  res.status(201).json(db.prepare('SELECT * FROM flash_sales WHERE id = ?').get(id));
});

router.patch('/flash-sales/:id/end', (req, res) => {
  db.prepare(`UPDATE flash_sales SET status = 'ended' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
