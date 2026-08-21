const db = require('../db');

function getVariationsFor(productId) {
  const variations = db.prepare(
    'SELECT * FROM product_variations WHERE product_id = ? ORDER BY display_order, id'
  ).all(productId);
  if (variations.length === 0) return [];

  const attrStmt = db.prepare(
    'SELECT attribute_name AS name, attribute_value AS value FROM variation_attributes WHERE variation_id = ? ORDER BY id'
  );
  return variations.map(v => ({ ...v, attributes: attrStmt.all(v.id) }));
}

// Mirrors the default variation's price/stock/sku onto the base products row,
// so anything reading raw product columns (CSV export, etc.) stays correct
// without needing to know variations exist.
function syncProductFromVariations(productId) {
  const variations = getVariationsFor(productId);
  if (variations.length === 0) return;
  const def = variations.find(v => v.is_default) || variations[0];
  db.prepare(
    `UPDATE products SET price = ?, stock_quantity = ?, sku = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(def.price, def.stock_quantity, def.sku, productId);
}

// Canonical key for matching/deduping an attribute combination, e.g.
// [{name:'Size',value:'1kg'},{name:'Colour',value:'Red'}] -> "colour:red|size:1kg"
function attributeKey(attributes) {
  return (attributes || [])
    .map(a => `${String(a.name).trim().toLowerCase()}:${String(a.value).trim().toLowerCase()}`)
    .sort()
    .join('|');
}

module.exports = { getVariationsFor, syncProductFromVariations, attributeKey };
