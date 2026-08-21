const express = require('express');
const db = require('../db');
const { getVariationsFor, syncProductFromVariations, attributeKey } = require('../lib/variationHelpers');

const router = express.Router({ mergeParams: true });

function serializeVariation(v) {
  return {
    id: v.id,
    sku: v.sku,
    price: v.price,
    compareAtPrice: v.compare_at_price,
    stock: v.stock_quantity,
    isDefault: !!v.is_default,
    displayOrder: v.display_order,
    attributes: v.attributes
  };
}

function requireProduct(req, res, next) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  req.product = product;
  next();
}
router.use(requireProduct);

function setAttributes(variationId, attributes) {
  db.prepare('DELETE FROM variation_attributes WHERE variation_id = ?').run(variationId);
  const insert = db.prepare('INSERT INTO variation_attributes (variation_id, attribute_name, attribute_value) VALUES (?, ?, ?)');
  attributes.forEach(a => insert.run(variationId, String(a.name).trim(), String(a.value).trim()));
}

function dedupeAttributes(attributes) {
  const byName = new Map();
  (attributes || []).forEach(a => {
    const name = String(a.name || '').trim();
    const value = String(a.value || '').trim();
    if (name && value) byName.set(name.toLowerCase(), { name, value });
  });
  return [...byName.values()];
}

function clearOtherDefaults(productId, exceptVariationId) {
  db.prepare('UPDATE product_variations SET is_default = 0 WHERE product_id = ? AND id != ?').run(productId, exceptVariationId || -1);
}

router.get('/', (req, res) => {
  res.json(getVariationsFor(req.params.productId).map(serializeVariation));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const attributes = dedupeAttributes(b.attributes);
  if (attributes.length === 0) {
    return res.status(400).json({ error: 'At least one attribute (e.g. Size, Colour) is required' });
  }

  const existing = getVariationsFor(req.params.productId);
  const key = attributeKey(attributes);
  if (existing.some(v => attributeKey(v.attributes) === key)) {
    return res.status(409).json({ error: 'A variation with this exact attribute combination already exists' });
  }

  const isFirstVariation = existing.length === 0;
  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO product_variations (product_id, sku, price, compare_at_price, stock_quantity, is_default, display_order)
       VALUES (@product_id, @sku, @price, @compare_at_price, @stock_quantity, @is_default, @display_order)`
    ).run({
      product_id: req.params.productId,
      sku: b.sku || null,
      price: parseFloat(b.price) || 0,
      compare_at_price: b.compareAtPrice != null && b.compareAtPrice !== '' ? parseFloat(b.compareAtPrice) : null,
      stock_quantity: parseInt(b.stock, 10) || 0,
      is_default: isFirstVariation || b.isDefault ? 1 : 0,
      display_order: existing.length
    });
    const variationId = info.lastInsertRowid;
    setAttributes(variationId, attributes);
    if (isFirstVariation || b.isDefault) clearOtherDefaults(req.params.productId, variationId);
    syncProductFromVariations(req.params.productId);
    return variationId;
  });

  const variationId = tx();
  const created = getVariationsFor(req.params.productId).find(v => v.id === variationId);
  res.status(201).json(serializeVariation(created));
});

router.put('/:variationId', (req, res) => {
  const existingVariation = db.prepare('SELECT * FROM product_variations WHERE id = ? AND product_id = ?').get(req.params.variationId, req.params.productId);
  if (!existingVariation) return res.status(404).json({ error: 'Variation not found' });

  const b = req.body || {};
  const attributes = dedupeAttributes(b.attributes);
  if (attributes.length === 0) {
    return res.status(400).json({ error: 'At least one attribute (e.g. Size, Colour) is required' });
  }

  const all = getVariationsFor(req.params.productId);
  const key = attributeKey(attributes);
  if (all.some(v => v.id !== existingVariation.id && attributeKey(v.attributes) === key)) {
    return res.status(409).json({ error: 'A variation with this exact attribute combination already exists' });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE product_variations SET sku = @sku, price = @price, compare_at_price = @compare_at_price,
        stock_quantity = @stock_quantity, is_default = @is_default, updated_at = datetime('now')
       WHERE id = @id`
    ).run({
      id: req.params.variationId,
      sku: b.sku || null,
      price: parseFloat(b.price) || 0,
      compare_at_price: b.compareAtPrice != null && b.compareAtPrice !== '' ? parseFloat(b.compareAtPrice) : null,
      stock_quantity: parseInt(b.stock, 10) || 0,
      is_default: b.isDefault ? 1 : existingVariation.is_default
    });
    setAttributes(req.params.variationId, attributes);
    if (b.isDefault) clearOtherDefaults(req.params.productId, req.params.variationId);
    syncProductFromVariations(req.params.productId);
  });
  tx();

  const updated = getVariationsFor(req.params.productId).find(v => v.id === parseInt(req.params.variationId, 10));
  res.json(serializeVariation(updated));
});

router.patch('/:variationId/default', (req, res) => {
  const variation = db.prepare('SELECT * FROM product_variations WHERE id = ? AND product_id = ?').get(req.params.variationId, req.params.productId);
  if (!variation) return res.status(404).json({ error: 'Variation not found' });

  const tx = db.transaction(() => {
    clearOtherDefaults(req.params.productId, req.params.variationId);
    db.prepare(`UPDATE product_variations SET is_default = 1, updated_at = datetime('now') WHERE id = ?`).run(req.params.variationId);
    syncProductFromVariations(req.params.productId);
  });
  tx();
  res.json({ ok: true });
});

router.delete('/:variationId', (req, res) => {
  const variation = db.prepare('SELECT * FROM product_variations WHERE id = ? AND product_id = ?').get(req.params.variationId, req.params.productId);
  if (!variation) return res.status(404).json({ error: 'Variation not found' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM product_variations WHERE id = ?').run(req.params.variationId);
    if (variation.is_default) {
      const remaining = db.prepare(
        'SELECT id FROM product_variations WHERE product_id = ? ORDER BY display_order, id LIMIT 1'
      ).get(req.params.productId);
      if (remaining) {
        db.prepare(`UPDATE product_variations SET is_default = 1, updated_at = datetime('now') WHERE id = ?`).run(remaining.id);
      }
    }
    syncProductFromVariations(req.params.productId);
  });
  tx();

  const remainingCount = getVariationsFor(req.params.productId).length;
  res.json({ ok: true, remainingVariationCount: remainingCount });
});

module.exports = router;
