const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('../db');
const slugify = require('../lib/slugify');
const logActivity = require('../lib/activityLog');
const { getVariationsFor } = require('../lib/variationHelpers');
const upload = require('../middleware/upload');

const router = express.Router();

router.use('/:productId/variations', require('./variations'));

function deleteImageFile(url) {
  const filePath = path.join(__dirname, '..', 'public', url.replace(/^\//, ''));
  fs.unlink(filePath, () => {}); // best-effort; ignore if already gone
}

function uniqueSlug(base) {
  let slug = slugify(base) || 'product';
  let n = 2;
  while (db.prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) {
    slug = `${slugify(base)}-${n++}`;
  }
  return slug;
}

function getCategoriesFor(productId) {
  return db.prepare(
    `SELECT c.id, c.name, c.slug FROM categories c
     JOIN product_categories pc ON pc.category_id = c.id
     WHERE pc.product_id = ?`
  ).all(productId);
}

function getTagsFor(productId) {
  return db.prepare(
    `SELECT t.name FROM tags t
     JOIN product_tags pt ON pt.tag_id = t.id
     WHERE pt.product_id = ?`
  ).all(productId).map(r => r.name);
}

function getImagesFor(productId) {
  return db.prepare('SELECT id, url FROM product_images WHERE product_id = ? ORDER BY sort_order').all(productId);
}

function serializeProduct(p) {
  const variations = getVariationsFor(p.id);
  const hasVariations = variations.length > 0;
  return {
    ...p,
    isNew: !!p.is_new_arrival,
    isFeatured: !!p.is_featured,
    needsReview: !!p.needs_review,
    needsStockReview: !!p.needs_stock_review,
    categories: getCategoriesFor(p.id),
    tags: getTagsFor(p.id),
    images: getImagesFor(p.id),
    variations,
    hasVariations,
    variationCount: variations.length,
    priceMin: hasVariations ? Math.min(...variations.map(v => v.price)) : p.price,
    priceMax: hasVariations ? Math.max(...variations.map(v => v.price)) : p.price,
    stockTotal: hasVariations ? variations.reduce((s, v) => s + v.stock_quantity, 0) : p.stock_quantity
  };
}

function setCategories(productId, categoryIds) {
  db.prepare('DELETE FROM product_categories WHERE product_id = ?').run(productId);
  const insert = db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?, ?)');
  (categoryIds || []).forEach(cid => insert.run(productId, cid));
}

function setTags(productId, tagNames) {
  db.prepare('DELETE FROM product_tags WHERE product_id = ?').run(productId);
  const findOrCreate = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)');
  (tagNames || []).filter(Boolean).forEach(name => {
    findOrCreate.run(name);
    const tag = getTag.get(name);
    link.run(productId, tag.id);
  });
}

// GET /api/products?search=&category=&status=&page=&pageSize=
router.get('/', (req, res) => {
  const { search = '', category = '', status = '', page = '1', pageSize = '500' } = req.query;
  const limit = parseInt(pageSize, 10) || 500;
  const offset = (parseInt(page, 10) - 1) * limit;

  let sql = `SELECT DISTINCT p.* FROM products p`;
  const where = [];
  const params = {};

  if (category) {
    sql += ` JOIN product_categories pc ON pc.product_id = p.id JOIN categories c ON c.id = pc.category_id`;
    where.push(`c.slug = @category`);
    params.category = category;
  }
  if (search) {
    where.push(`(p.name LIKE @search OR p.origin LIKE @search)`);
    params.search = `%${search}%`;
  }
  if (status) {
    where.push(`p.status = @status`);
    params.status = status;
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY p.display_order, p.name LIMIT @limit OFFSET @offset`;
  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(sql).all(params);
  res.json(rows.map(serializeProduct));
});

router.get('/export.csv', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY name').all();
  const header = ['id', 'name', 'sku', 'price', 'stock_quantity', 'status', 'origin'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="catalogue_ennys.csv"');
  res.send(lines.join('\n'));
});

router.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(serializeProduct(p));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  const slug = uniqueSlug(b.name);
  const info = db.prepare(
    `INSERT INTO products
      (name, slug, sku, origin, price, compare_at_price, stock_quantity, emoji,
       short_description, full_description, status, is_new_arrival, is_featured,
       best_seller_rank, weight)
     VALUES (@name, @slug, @sku, @origin, @price, @compare_at_price, @stock_quantity, @emoji,
       @short_description, @full_description, @status, @is_new_arrival, @is_featured,
       @best_seller_rank, @weight)`
  ).run({
    name: b.name.trim(),
    slug,
    sku: b.sku || null,
    origin: b.origin || 'Unspecified',
    price: parseFloat(b.price) || 0,
    compare_at_price: b.oldPrice != null && b.oldPrice !== '' ? parseFloat(b.oldPrice) : null,
    stock_quantity: parseInt(b.stock, 10) || 0,
    emoji: b.emoji || '📦',
    short_description: b.seoDesc || null,
    full_description: b.desc || null,
    status: b.status === 'inactive' ? 'inactive' : 'active',
    is_new_arrival: b.isNew ? 1 : 0,
    is_featured: b.isFeatured ? 1 : 0,
    best_seller_rank: b.bsRank ? parseInt(b.bsRank, 10) : null,
    weight: b.weight != null ? parseFloat(b.weight) : null
  });
  const productId = info.lastInsertRowid;
  if (b.categoryIds) setCategories(productId, b.categoryIds);
  if (b.tags) setTags(productId, Array.isArray(b.tags) ? b.tags : String(b.tags).split(',').map(t => t.trim()));
  logActivity(`New product added: ${b.name.trim()}`, '#2e7d32');
  res.status(201).json(serializeProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(productId)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'Product name is required' });
  }
  db.prepare(
    `UPDATE products SET
      name = @name, origin = @origin, price = @price, compare_at_price = @compare_at_price,
      stock_quantity = @stock_quantity, emoji = @emoji, short_description = @short_description,
      full_description = @full_description, status = @status, is_new_arrival = @is_new_arrival,
      is_featured = @is_featured, best_seller_rank = @best_seller_rank, sku = @sku, weight = @weight,
      updated_at = datetime('now')
     WHERE id = @id`
  ).run({
    id: req.params.id,
    name: b.name.trim(),
    origin: b.origin || existing.origin,
    price: parseFloat(b.price) || 0,
    compare_at_price: b.oldPrice != null && b.oldPrice !== '' ? parseFloat(b.oldPrice) : null,
    stock_quantity: parseInt(b.stock, 10) || 0,
    weight: b.weight != null && b.weight !== '' ? parseFloat(b.weight) : existing.weight,
    emoji: b.emoji || existing.emoji,
    short_description: b.seoDesc ?? existing.short_description,
    full_description: b.desc ?? existing.full_description,
    status: b.status === 'inactive' ? 'inactive' : 'active',
    is_new_arrival: b.isNew ? 1 : 0,
    is_featured: b.isFeatured ? 1 : 0,
    best_seller_rank: b.bsRank ? parseInt(b.bsRank, 10) : null,
    sku: b.sku ?? existing.sku
  });
  if (b.categoryIds) setCategories(req.params.id, b.categoryIds);
  if (b.tags) setTags(req.params.id, Array.isArray(b.tags) ? b.tags : String(b.tags).split(',').map(t => t.trim()));
  res.json(serializeProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)));
});

router.patch('/:id/status', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const status = req.body.active ? 'active' : 'inactive';
  db.prepare(`UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);
  res.json({ ok: true, status });
});

router.post('/:id/duplicate', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const slug = uniqueSlug(`${p.name} copy`);
  const info = db.prepare(
    `INSERT INTO products
      (name, slug, sku, origin, price, compare_at_price, stock_quantity, emoji,
       short_description, full_description, status, weight)
     VALUES (@name, @slug, NULL, @origin, @price, @compare_at_price, @stock_quantity, @emoji,
       @short_description, @full_description, 'inactive', @weight)`
  ).run({
    name: `${p.name} (Copy)`,
    slug,
    origin: p.origin,
    price: p.price,
    compare_at_price: p.compare_at_price,
    stock_quantity: p.stock_quantity,
    emoji: p.emoji,
    short_description: p.short_description,
    full_description: p.full_description,
    weight: p.weight
  });
  const newId = info.lastInsertRowid;
  const catIds = getCategoriesFor(p.id).map(c => c.id);
  setCategories(newId, catIds);
  const tagNames = getTagsFor(p.id);
  setTags(newId, tagNames);
  res.status(201).json(serializeProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(newId)));
});

router.delete('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  getImagesFor(req.params.id).forEach(img => deleteImageFile(img.url));
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── PRODUCT IMAGES ──
router.post('/:id/images', (req, res, next) => {
  const p = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  upload.array('images', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No image files were uploaded' });
    }
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_images WHERE product_id = ?').get(req.params.id).m;
    const insert = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)');
    req.files.forEach((file, i) => {
      const url = `/uploads/products/${file.filename}`;
      insert.run(req.params.id, url, maxOrder + 1 + i);
    });
    res.status(201).json(getImagesFor(req.params.id));
  });
});

router.delete('/:id/images/:imageId', (req, res) => {
  const image = db.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(req.params.imageId, req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  db.prepare('DELETE FROM product_images WHERE id = ?').run(req.params.imageId);
  deleteImageFile(image.url);
  res.json({ ok: true, images: getImagesFor(req.params.id) });
});

router.patch('/:id/images/:imageId/primary', (req, res) => {
  const image = db.prepare('SELECT * FROM product_images WHERE id = ? AND product_id = ?').get(req.params.imageId, req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE product_images SET sort_order = sort_order + 1 WHERE product_id = ?').run(req.params.id);
    db.prepare('UPDATE product_images SET sort_order = 0 WHERE id = ?').run(req.params.imageId);
  });
  tx();
  res.json(getImagesFor(req.params.id));
});

module.exports = router;
