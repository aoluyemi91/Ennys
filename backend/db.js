const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const slugify = require('./lib/slugify');

// DATA_DIR lets a host with ephemeral container storage (e.g. Render) point
// this at a mounted persistent disk instead of the default in-repo folder.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'ennys.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH, { enableForeignKeyConstraints: true });
db.exec('PRAGMA journal_mode = WAL');

// better-sqlite3-style transaction helper: db.transaction(fn) returns a function
// that runs fn(...args) wrapped in BEGIN/COMMIT, rolling back on error.
db.transaction = function (fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

const migration = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');
db.exec(migration);

// SQLite's ALTER TABLE ADD COLUMN isn't naturally re-runnable like CREATE TABLE IF NOT
// EXISTS, so guard it — lets us add columns to existing tables without a migration runner.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('customers', 'password_hash', 'TEXT');
ensureColumn('customers', 'phone', 'TEXT');
ensureColumn('customers', 'address_line1', 'TEXT');
ensureColumn('customers', 'address_line2', 'TEXT');
ensureColumn('customers', 'city', 'TEXT');
ensureColumn('customers', 'postcode', 'TEXT');

ensureColumn('orders', 'stripe_payment_intent_id', 'TEXT');
ensureColumn('orders', 'payment_status', `TEXT NOT NULL DEFAULT 'unpaid'`);
ensureColumn('orders', 'customer_phone', 'TEXT');

ensureColumn('order_items', 'variation_id', 'INTEGER REFERENCES product_variations(id) ON DELETE SET NULL');
ensureColumn('order_items', 'variation_summary', 'TEXT');

db.exec('CREATE INDEX IF NOT EXISTS idx_order_items_variation ON order_items(variation_id)');

const DEFAULT_CMS = {
  homepage_hero: {
    eyebrow: "🌍 Birmingham's Afro-Caribbean Superstore",
    background_color: '#b84500',
    headline: 'Taste of Home,\nDelivered Fast',
    subheadline: '500+ authentic products. Next-day delivery UK-wide.',
    primary_cta_text: 'Shop All Products',
    secondary_cta_text: 'Track Your Order',
    trust_bar: [
      { icon: '🚚', title: 'Next-Day Delivery', subtitle: 'Order before 12pm' },
      { icon: '❄️', title: 'Frozen Guarantee', subtitle: 'Temperature-controlled' },
      { icon: '✅', title: 'Halal Certified', subtitle: 'All meat products' },
      { icon: '💬', title: 'WhatsApp Support', subtitle: '+44 121 359 2779' }
    ],
    promo_cards: [
      { title: 'Fresh Meat Week', body: 'Up to 20% off goat, beef & chicken' },
      { title: 'Pantry Essentials Bundle', body: 'Garri, semolina, poundo yam & more — save!' }
    ]
  },
  announcement_bar: {
    text: '🚚 FREE next-day delivery over £50 | Same-day delivery across Birmingham | 500+ authentic Afro-Caribbean products',
    background_color: '#1a1a1a',
    highlight_color: '#f47c2f'
  },
  footer: {
    address: 'Birmingham, West Midlands',
    phone: '+44 121 359 2779',
    email: 'hello@ennys.co.uk',
    description: "Birmingham's premier Afro-Caribbean online superstore. Delivering authentic flavours across the UK.",
    delivery_line1: 'Next-day: order before 12pm Mon–Thu',
    delivery_line2: 'Same-day: Birmingham only, before 11am',
    delivery_line3: 'Weekend delivery available',
    delivery_highlight: 'FREE delivery over £50',
    help_links: [
      { label: 'FAQ', url: '/store/faq.html' },
      { label: 'Delivery & Returns', url: '/store/delivery-returns.html' },
      { label: 'Contact Us', url: '#' }
    ],
    business_links: [
      { label: 'About Us', url: '/store/about-us.html' },
      { label: 'Careers', url: '#' },
      { label: 'Become a Trader', url: '#' }
    ]
  },
  seo_homepage: {
    title: 'Ennys — Afro-Caribbean Groceries UK | Next-Day Delivery',
    description: 'Buy authentic Afro-Caribbean groceries online. 500+ products including plantain, goat meat, egusi & more. Next-day UK delivery. Birmingham’s #1 African food store.',
    keywords: 'Afro-Caribbean groceries UK, Nigerian food online, buy plantain online UK, goat meat delivery Birmingham, egusi soup ingredients'
  },
  help_support_page: {
    intro: "Answers to the questions we get asked most. Can't find what you need? Reach out and we'll sort it."
  },
  faq_page: {
    intro: 'Answers to the questions we get asked most about ordering, delivery and payments.',
    items: [
      { question: 'How fast is delivery?', answer: 'Order before 12pm Monday–Thursday for next-day delivery UK-wide. Birmingham customers can get same-day delivery on orders placed before 11am. Weekend delivery is also available.' },
      { question: 'Is your meat halal certified?', answer: 'Yes — all meat products sold on Ennys are halal certified.' },
      { question: 'How do I track my order?', answer: 'Sign in to My Account to see the status of your recent orders. You\'ll also receive email updates as your order is processed and dispatched.' },
      { question: 'What payment methods do you accept?', answer: 'We accept all major debit and credit cards via Stripe. Payments are processed securely at checkout.' },
      { question: 'What if an item is out of stock or damaged?', answer: 'Get in touch using the contact details on our Help & Support page and we\'ll arrange a replacement or refund — see our Delivery & Returns page for more.' }
    ]
  },
  about_us_page: {
    intro: "Birmingham's premier Afro-Caribbean online superstore. Delivering authentic flavours across the UK.",
    story_paragraphs: [
      "Ennys started with a simple idea: make it easy for anyone in the UK to get the authentic Afro-Caribbean ingredients they grew up with, without a long drive across the city. From spices and seasoning to frozen meat, fish and fresh tubers, we stock 500+ products sourced with the same care you'd expect walking the aisles of a Birmingham market.",
      "Today we serve customers across the UK with fast, reliable delivery — but we're still, at heart, a Birmingham business that knows this food and this community."
    ],
    values: [
      { icon: '🌍', title: 'Authenticity', body: 'Real ingredients, sourced properly — no substitutes or shortcuts.' },
      { icon: '🚚', title: 'Reliability', body: 'Next-day and same-day delivery, so your kitchen is never left waiting.' },
      { icon: '✅', title: 'Trust', body: 'Halal certified meat and clear, honest information on every product.' }
    ]
  },
  delivery_returns_page: {
    intro: "Everything you need to know about getting your order — and what to do if something's not right.",
    returns_paragraphs: [
      "We want you to be happy with every order. If an item arrives damaged, missing or not as described, let us know within 48 hours of delivery and we'll arrange a replacement or full refund — no need to send anything back for perishable or frozen goods.",
      "For non-perishable items, unopened products can be returned within 14 days of delivery for a refund. Please contact us before sending anything back so we can advise on the best way to arrange it."
    ],
    returns_bullets: [
      'Refunds are issued to your original payment method within 5–7 working days of approval.',
      'Contact us with your order number and a photo of the item where relevant — this speeds things up considerably.'
    ]
  }
};

const DEFAULT_SETTINGS = {
  store: {
    store_name: 'Ennys',
    store_url: 'https://ennys.co.uk',
    contact_email: 'hello@ennys.co.uk',
    whatsapp_support: '+44 121 359 2779',
    currency: 'GBP'
  },
  delivery: {
    free_delivery_threshold: 50,
    standard_fee: 4.99,
    express_fee: 14.99,
    weekend_fee: 9.99,
    next_day_cutoff: '12:00'
  },
  notifications: {
    new_order_email: true,
    low_stock_alert: true,
    return_request_alert: true,
    daily_sales_summary: true
  },
  payments: {
    stripe_connected: true,
    paypal_connected: true,
    klarna_connected: false
  }
};

const insertCms = db.prepare('INSERT OR IGNORE INTO cms_content (key, value_json) VALUES (?, ?)');
const selectCms = db.prepare('SELECT value_json FROM cms_content WHERE key = ?');
const updateCms = db.prepare('UPDATE cms_content SET value_json = ? WHERE key = ?');
for (const [key, value] of Object.entries(DEFAULT_CMS)) {
  insertCms.run(key, JSON.stringify(value));
  // Backfill keys added to a default after this row was first seeded (e.g. footer
  // link sections) without clobbering values already edited via the CMS.
  const originalJson = selectCms.get(key).value_json;
  const existing = JSON.parse(originalJson);
  if (key === 'footer') {
    // Footer links moved from plain free-text strings back to {label,url} objects
    // (so they can point at real pages). Known labels keep their default URL;
    // anything custom the admin typed in falls back to '#'.
    for (const field of ['help_links', 'business_links']) {
      if (Array.isArray(existing[field])) {
        existing[field] = existing[field].map(item => {
          if (typeof item !== 'string') return item;
          const match = value[field].find(d => d.label === item);
          return { label: item, url: match ? match.url : '#' };
        });
      }
    }
  }
  const merged = { ...value, ...existing };
  const mergedJson = JSON.stringify(merged);
  if (mergedJson !== originalJson) {
    updateCms.run(mergedJson, key);
  }
}

const insertSettings = db.prepare('INSERT OR IGNORE INTO settings (key, value_json) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertSettings.run(key, JSON.stringify(value));
}

const DEFAULT_CATEGORIES = [
  { name: 'Spices, Seasoning & Condiments', emoji: '🧂' },
  { name: 'Frozen Beef, Chicken & Seafoods', emoji: '🥩' },
  { name: 'Dried Vegetable, Fish & Seeds', emoji: '🌿' },
  { name: 'Flours & Grains', emoji: '🌾' },
  { name: 'Snacks', emoji: '🍘' },
  { name: 'Tea & Beverages', emoji: '☕' },
  { name: 'Canned Foods', emoji: '🥫' },
  { name: 'Beans and Pulses', emoji: '🫘' },
  { name: 'Household Items', emoji: '🧴' },
  { name: 'Rice, Noodles & Pasta', emoji: '🍚' },
  { name: 'Cereal & Baby Foods', emoji: '🥣' },
  { name: 'Drinks', emoji: '🥤' },
  { name: 'Frozen Vegetable & Dough', emoji: '🥦' },
  { name: 'Tubers & Vegetables', emoji: '🍠' },
  { name: 'Oils', emoji: '🛢️' },
  { name: 'Soups', emoji: '🍲' },
  { name: 'Bread & Buns', emoji: '🍞' },
  { name: 'Uncategorised', emoji: '📦' }
];

const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, slug, emoji, display_order) VALUES (?, ?, ?, ?)');
DEFAULT_CATEGORIES.forEach((cat, i) => {
  insertCategory.run(cat.name, slugify(cat.name), cat.emoji, i);
});

module.exports = db;
module.exports.slugify = slugify;
