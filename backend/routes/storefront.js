// Public, unauthenticated read-only API for the customer-facing side.
// Mounted in server.js BEFORE the requireAuthApi gate.
const express = require('express');
const db = require('../db');
const { getVariationsFor, attributeKey } = require('../lib/variationHelpers');
const { validatePromoCode } = require('../lib/promoHelpers');

const router = express.Router();

function getImagesFor(productId) {
  return db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order').all(productId).map(r => r.url);
}

function getCategoriesFor(productId) {
  return db.prepare(
    `SELECT c.id, c.name, c.slug FROM categories c
     JOIN product_categories pc ON pc.category_id = c.id
     WHERE pc.product_id = ?`
  ).all(productId);
}

const SORTS = {
  'price-asc': 'p.price ASC',
  'price-desc': 'p.price DESC',
  name: 'p.name ASC'
};

router.get('/products', (req, res) => {
  const { category = '', tag = '', search = '', sort = 'name' } = req.query;

  let sql = `SELECT DISTINCT p.* FROM products p`;
  const where = [`p.status = 'active'`];
  const params = {};

  if (category) {
    sql += ` JOIN product_categories pc ON pc.product_id = p.id JOIN categories c ON c.id = pc.category_id`;
    where.push('c.slug = @category');
    params.category = category;
  }
  if (tag === 'new') where.push('p.is_new_arrival = 1');
  if (tag === 'featured') where.push('p.is_featured = 1');
  if (tag === 'best-sellers') where.push('p.best_seller_rank IS NOT NULL');
  if (search) {
    where.push('p.name LIKE @search');
    params.search = `%${search}%`;
  }

  sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY ${tag === 'best-sellers' ? 'p.best_seller_rank ASC' : (SORTS[sort] || SORTS.name)}`;

  const products = db.prepare(sql).all(params);
  res.json(products.map(p => {
    const variations = getVariationsFor(p.id);
    const hasVariations = variations.length > 0;
    const images = getImagesFor(p.id);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      emoji: p.emoji,
      image: images[0] || null,
      hasVariations,
      isNew: !!p.is_new_arrival,
      isFeatured: !!p.is_featured,
      price: p.price,
      compareAtPrice: p.compare_at_price,
      priceMin: hasVariations ? Math.min(...variations.map(v => v.price)) : p.price,
      priceMax: hasVariations ? Math.max(...variations.map(v => v.price)) : p.price,
      stockTotal: hasVariations ? variations.reduce((s, v) => s + v.stock_quantity, 0) : p.stock_quantity,
      categories: getCategoriesFor(p.id)
    };
  }));
});

router.get('/products/:id', (req, res) => {
  const p = db.prepare(`SELECT * FROM products WHERE id = ? AND status = 'active'`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });

  const variations = getVariationsFor(p.id);
  const hasVariations = variations.length > 0;

  const attributeNames = [];
  const seen = new Set();
  variations.forEach(v => v.attributes.forEach(a => {
    if (!seen.has(a.name)) { seen.add(a.name); attributeNames.push(a.name); }
  }));

  const serializedVariations = variations.map(v => ({
    id: v.id,
    sku: v.sku,
    price: v.price,
    compareAtPrice: v.compare_at_price,
    stock: v.stock_quantity,
    isDefault: !!v.is_default,
    attributes: Object.fromEntries(v.attributes.map(a => [a.name, a.value])),
    key: attributeKey(v.attributes)
  }));

  const defaultVariation = serializedVariations.find(v => v.isDefault) || serializedVariations[0];

  res.json({
    id: p.id,
    name: p.name,
    slug: p.slug,
    emoji: p.emoji,
    images: getImagesFor(p.id),
    shortDescription: p.short_description,
    fullDescription: p.full_description,
    hasVariations,
    price: p.price,
    compareAtPrice: p.compare_at_price,
    stock: p.stock_quantity,
    weight: p.weight,
    categories: getCategoriesFor(p.id),
    attributeNames,
    variations: serializedVariations,
    defaultVariationId: defaultVariation ? defaultVariation.id : null
  });
});

router.get('/config', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    mockPayments: !process.env.STRIPE_SECRET_KEY
  });
});

router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories WHERE visible = 1 ORDER BY display_order, name').all();
  res.json(rows.map(c => ({ id: c.id, name: c.name, slug: c.slug, emoji: c.emoji })));
});

const CMS_SECTIONS = [
  'homepage_hero', 'announcement_bar', 'footer', 'seo_homepage',
  'help_support_page', 'about_us_page', 'delivery_returns_page', 'faq_page'
];
router.get('/cms/:section', (req, res) => {
  if (!CMS_SECTIONS.includes(req.params.section)) return res.status(404).json({ error: 'Unknown section' });
  const row = db.prepare('SELECT value_json FROM cms_content WHERE key = ?').get(req.params.section);
  if (!row) return res.status(404).json({ error: 'Section not found' });
  res.json(JSON.parse(row.value_json));
});

router.get('/promo-banners', (req, res) => {
  res.json(db.prepare('SELECT * FROM promo_banners WHERE active = 1 ORDER BY sort_order').all());
});

router.get('/delivery-options', (req, res) => {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('delivery');
  const delivery = row ? JSON.parse(row.value_json) : {};
  res.json({
    freeDeliveryThreshold: delivery.free_delivery_threshold,
    options: [
      { type: 'Standard', label: 'Standard Delivery', fee: delivery.standard_fee },
      { type: 'Next-Day', label: 'Next-Day Delivery', fee: delivery.express_fee },
      { type: 'Weekend', label: 'Weekend Delivery', fee: delivery.weekend_fee }
    ]
  });
});

router.post('/promo-preview', (req, res) => {
  const { code, subtotal } = req.body || {};
  const result = validatePromoCode(code, parseFloat(subtotal) || 0);
  if (!result.valid) return res.status(400).json({ error: result.error });
  res.json({
    code: result.promo.code,
    type: result.promo.type,
    discountAmount: result.discountAmount,
    freeDelivery: result.freeDelivery
  });
});

module.exports = router;
