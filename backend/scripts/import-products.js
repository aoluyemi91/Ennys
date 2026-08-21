// One-off importer: Enny Prod List (2).xlsx (real nopCommerce export, 230 products)
//   -> products / categories / tags / product_images tables.
//
// The source export has real, verified corruption (see plan/report):
//   - Picture1/2/3 columns are wrong for ~96% of rows; real image URLs frequently
//     leak into the ProductTags/Categories cells instead.
//   - SKU is empty on every row; StockQuantity is 0 on all but one row.
//   - FullDescription is populated on only ~3% of rows.
// This script works around all of that rather than importing it blindly.
//
// Usage: node scripts/import-products.js [--force]

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../db');
const slugify = require('../lib/slugify');

const XLSX_PATH = path.join(__dirname, '..', '..', 'Enny Prod List (2).xlsx');
const REPORT_PATH = path.join(__dirname, '..', '.tmp', 'import-report.json');

const KNOWN_CATEGORIES = [
  'Spices, Seasoning & Condiments',
  'Frozen Beef, Chicken & Seafoods',
  'Dried Vegetable, Fish & Seeds',
  'Flours & Grains',
  'Snacks',
  'Tea & Beverages',
  'Canned Foods',
  'Beans and Pulses',
  'Household Items',
  'Rice, Noodles & Pasta',
  'Cereal & Baby Foods',
  'Drinks',
  'Frozen Vegetable & Dough',
  'Tubers & Vegetables',
  'Oils',
  'Soups',
  'Bread & Buns'
];

const CATEGORY_EMOJI = {
  'Spices, Seasoning & Condiments': '🧂',
  'Frozen Beef, Chicken & Seafoods': '🥩',
  'Dried Vegetable, Fish & Seeds': '🌿',
  'Flours & Grains': '🌾',
  'Snacks': '🍘',
  'Tea & Beverages': '☕',
  'Canned Foods': '🥫',
  'Beans and Pulses': '🫘',
  'Household Items': '🧴',
  'Rice, Noodles & Pasta': '🍚',
  'Cereal & Baby Foods': '🥣',
  'Drinks': '🥤',
  'Frozen Vegetable & Dough': '🥦',
  'Tubers & Vegetables': '🍠',
  'Oils': '🛢️',
  'Soups': '🍲',
  'Bread & Buns': '🍞',
  'Uncategorised': '📦'
};

const URL_RE = /^https?:\/\//i;

function toBool(v) {
  if (v === true || v === 1) return true;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function decodeEntities(str) {
  return String(str).replace(/&amp;/g, '&').trim();
}

function splitDelimited(str) {
  return String(str || '')
    .split(';')
    .map(s => decodeEntities(s))
    .filter(Boolean);
}

function slugFromImageUrl(url) {
  const filename = url.split('/').pop().split('?')[0];
  const noExt = filename.replace(/\.[a-z0-9]+$/i, '');
  const noLeadingId = noExt.replace(/^\d+[_\-]/, '');
  return slugify(noLeadingId);
}

function forceWipe() {
  db.prepare('DELETE FROM products').run(); // cascades to product_categories/product_tags/product_images
  console.log('--force: wiped existing products (and their category/tag/image links).');
}

function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`Source file not found: ${XLSX_PATH}`);
    process.exit(1);
  }

  const existingCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const force = process.argv.includes('--force');
  if (existingCount > 0 && !force) {
    console.error(
      `products table already has ${existingCount} rows. Re-run with --force to wipe and re-import, ` +
      `or delete backend/data/ennys.db to start fresh.`
    );
    process.exit(1);
  }
  if (existingCount > 0 && force) forceWipe();

  const workbook = XLSX.readFile(XLSX_PATH);
  const sheet = workbook.Sheets['Product'];
  if (!sheet) {
    console.error(`Sheet "Product" not found. Sheets present: ${workbook.SheetNames.join(', ')}`);
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  console.log(`Read ${rows.length} rows from sheet "Product".`);

  // ── Pass 1: build a global filename-slug -> URL pool from every cell that looks like a URL ──
  const imagePool = new Map();
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === 'string' && URL_RE.test(value.trim())) {
        const url = value.trim();
        const slug = slugFromImageUrl(url);
        if (slug && !imagePool.has(slug)) imagePool.set(slug, url);
      }
    }
  }
  console.log(`Built image pool: ${imagePool.size} candidate URLs found across all cells.`);

  const categoryIdByName = new Map(
    db.prepare('SELECT id, name FROM categories').all().map(c => [c.name, c.id])
  );
  const uncategorisedId = categoryIdByName.get('Uncategorised');

  const insertProduct = db.prepare(
    `INSERT INTO products
      (legacy_product_id, name, slug, sku, price, stock_quantity, needs_stock_review,
       emoji, short_description, full_description, status, is_new_arrival, is_featured,
       display_order, weight, is_ship_enabled, is_tax_exempt, needs_review, review_notes)
     VALUES
      (@legacy_product_id, @name, @slug, @sku, @price, @stock_quantity, @needs_stock_review,
       @emoji, @short_description, @full_description, @status, @is_new_arrival, @is_featured,
       @display_order, @weight, @is_ship_enabled, @is_tax_exempt, @needs_review, @review_notes)`
  );
  const linkCategory = db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?, ?)');
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const linkTag = db.prepare('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)');
  const insertImage = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)');
  const usedSlugs = new Set(db.prepare('SELECT slug FROM products').all().map(r => r.slug));

  const report = [];
  const flagCounts = {};
  const bumpFlag = (flag) => { flagCounts[flag] = (flagCounts[flag] || 0) + 1; };

  const importAll = db.transaction((rows) => {
    for (const row of rows) {
      const name = String(row.Name || '').trim();
      if (!name) continue; // no usable row without a name

      let slug = slugify(name) || 'product';
      if (usedSlugs.has(slug)) {
        let n = 2;
        while (usedSlugs.has(`${slug}-${n}`)) n++;
        slug = `${slug}-${n}`;
      }
      usedSlugs.add(slug);

      const needsReview = [];
      const rawShort = decodeEntities(row.ShortDescription || '');
      const rawFull = decodeEntities(row.FullDescription || '');

      // Special case found in the source data: ShortDescription sometimes holds a
      // stock-status message ("out of stock") rather than real marketing copy.
      const isStockStatusText = /out of stock/i.test(rawShort) && !rawFull;

      let stockQuantity = parseInt(row.StockQuantity, 10) || 0;
      let needsStockReview = 0;
      if (isStockStatusText) {
        stockQuantity = 0;
        needsReview.push('stock_status_from_description');
      } else if (stockQuantity <= 0) {
        stockQuantity = 25; // placeholder — source export doesn't track real inventory
        needsStockReview = 1;
        bumpFlag('needs_stock_review');
      }

      let description = '';
      if (rawFull) {
        description = rawFull;
      } else if (rawShort && !isStockStatusText) {
        description = rawShort;
      } else {
        description = `Description coming soon — ${name} from Ennys.`;
        needsReview.push('missing_description');
        bumpFlag('missing_description');
      }

      let price = parseFloat(row.Price);
      if (!Number.isFinite(price) || price <= 0) {
        price = Number.isFinite(price) ? price : 0;
        needsReview.push('missing_price');
        bumpFlag('missing_price');
      }

      // ── Classify loose tokens from Categories/ProductTags — corruption means either
      // field can hold a real category name, a misplaced tag, or a leaked image URL. ──
      const looseTokens = [...splitDelimited(row.Categories), ...splitDelimited(row.ProductTags)];
      const rowImageUrls = [];
      const resolvedCategoryNames = [];
      const resolvedTags = [];
      for (const token of looseTokens) {
        if (URL_RE.test(token)) {
          rowImageUrls.push(token);
          continue;
        }
        const knownMatch = KNOWN_CATEGORIES.find(c => c.toLowerCase() === token.toLowerCase());
        if (knownMatch) {
          resolvedCategoryNames.push(knownMatch);
        } else {
          resolvedTags.push(token);
        }
      }
      // Also catch stray URLs sitting in the nominal Picture1/2/3 columns.
      for (const col of ['Picture1', 'Picture2', 'Picture3']) {
        const v = row[col];
        if (typeof v === 'string' && URL_RE.test(v.trim())) rowImageUrls.push(v.trim());
      }

      let categoryIds = [...new Set(resolvedCategoryNames)]
        .map(n => categoryIdByName.get(n))
        .filter(Boolean);
      if (categoryIds.length === 0) {
        categoryIds = [uncategorisedId];
        needsReview.push('missing_category');
        bumpFlag('missing_category');
      }

      // Resolve product image: prefer a URL found directly on this row; else fall
      // back to the global slug pool built in Pass 1.
      let imageUrls = [...new Set(rowImageUrls)];
      if (imageUrls.length === 0) {
        const poolMatch = imagePool.get(slugify(name));
        if (poolMatch) imageUrls = [poolMatch];
      }
      if (imageUrls.length === 0) {
        needsReview.push('missing_image');
        bumpFlag('missing_image');
      }

      const isNewArrival = toBool(row.MarkAsNew) ? 1 : 0;
      const isFeatured = toBool(row.ShowOnHomepage) ? 1 : 0;
      const primaryCategoryName = resolvedCategoryNames[0] || 'Uncategorised';
      const emoji = CATEGORY_EMOJI[primaryCategoryName] || '📦';
      const status = (price <= 0) ? 'inactive' : 'active';
      if (status === 'inactive') bumpFlag('inactive_missing_price');

      const info = insertProduct.run({
        legacy_product_id: row.ProductId != null && row.ProductId !== '' ? parseInt(row.ProductId, 10) : null,
        name,
        slug,
        sku: null,
        price,
        stock_quantity: stockQuantity,
        needs_stock_review: needsStockReview,
        emoji,
        short_description: isStockStatusText ? null : (rawShort || null),
        full_description: description,
        status,
        is_new_arrival: isNewArrival,
        is_featured: isFeatured,
        display_order: parseInt(row.DisplayOrder, 10) || 0,
        weight: row.Weight !== '' ? parseFloat(row.Weight) : null,
        is_ship_enabled: toBool(row.IsShipEnabled) ? 1 : 0,
        is_tax_exempt: toBool(row.IsTaxExempt) ? 1 : 0,
        needs_review: needsReview.length ? 1 : 0,
        review_notes: needsReview.length ? needsReview.join(';') + ';' : null
      });
      const productId = info.lastInsertRowid;

      categoryIds.forEach(cid => linkCategory.run(productId, cid));
      resolvedTags.forEach(tagName => {
        insertTag.run(tagName);
        const tag = findTag.get(tagName);
        linkTag.run(productId, tag.id);
      });
      imageUrls.forEach((url, i) => insertImage.run(productId, url, i));

      report.push({ id: productId, legacyProductId: row.ProductId, name, flags: needsReview });
    }
  });

  importAll(rows);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ importedAt: new Date().toISOString(), flagCounts, products: report }, null, 2));

  const totalImported = report.length;
  console.log(`\nImported ${totalImported} products.`);
  console.log('Flag counts:', flagCounts);
  console.log(`Full per-product report written to ${REPORT_PATH}`);
}

main();
