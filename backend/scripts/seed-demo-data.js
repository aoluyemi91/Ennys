// One-off seeder: turns the admin mockup's hardcoded demo orders/customers/returns/
// promos into real rows, so Orders/Returns/Customers/Promotions aren't an empty shell
// on first boot. Order line items are linked to real imported products (picked at
// random from the actual catalogue) rather than fake modulo-indexing.
//
// Run this AFTER scripts/import-products.js.
// Usage: node scripts/seed-demo-data.js [--force]

const db = require('../db');

const CUSTOMERS = [
  { name: 'Adaeze Okonkwo', email: 'adaeze@email.com', location: 'Birmingham B19' },
  { name: 'Kofi Mensah', email: 'kofi@email.com', location: 'Birmingham B20' },
  { name: 'Josephine Akande', email: 'jo@email.com', location: 'Birmingham B42' },
  { name: 'Emmanuel Osei', email: 'eo@email.com', location: 'Wolverhampton WV1' },
  { name: 'Fatima Diallo', email: 'fd@email.com', location: 'Birmingham B23' },
  { name: 'Chukwudi Eze', email: 'ce@email.com', location: 'Birmingham B7' },
  { name: 'Abena Boateng', email: 'ab@email.com', location: 'Leicester LE1' },
  { name: 'Samuel Mensah', email: 'sm@email.com', location: 'Birmingham B19' },
  { name: 'Grace Okonkwo', email: 'go@email.com', location: 'Birmingham B8' },
  { name: 'David Asante', email: 'da@email.com', location: 'Birmingham B18' },
  { name: 'Ify Nwosu', email: 'in@email.com', location: 'Birmingham B6' },
  { name: 'Blessing Adesanya', email: 'ba@email.com', location: 'Coventry CV1' }
];

const ORDERS = [
  { num: 'ENY-10284', email: 'adaeze@email.com', items: 3, total: 32.97, daysAgo: 0, delivery: 'Next-Day', status: 'Processing', addr: '12 Lozells Rd, B19' },
  { num: 'ENY-10283', email: 'kofi@email.com', items: 5, total: 54.45, daysAgo: 0, delivery: 'Same-Day', status: 'Shipped', addr: '7 Handsworth, B20' },
  { num: 'ENY-10282', email: 'jo@email.com', items: 2, total: 18.98, daysAgo: 1, delivery: 'Standard', status: 'Delivered', addr: '3 Perry Barr, B42' },
  { num: 'ENY-10281', email: 'eo@email.com', items: 4, total: 41.96, daysAgo: 1, delivery: 'Next-Day', status: 'Delivered', addr: '22 Aston, B6' },
  { num: 'ENY-10280', email: 'fd@email.com', items: 1, total: 7.99, daysAgo: 2, delivery: 'Standard', status: 'Cancelled', addr: '8 Erdington, B23' },
  { num: 'ENY-10279', email: 'ce@email.com', items: 6, total: 67.90, daysAgo: 2, delivery: 'Next-Day', status: 'Delivered', addr: '15 Nechells, B7' },
  { num: 'ENY-10278', email: 'ab@email.com', items: 2, total: 21.48, daysAgo: 3, delivery: 'Weekend', status: 'Delivered', addr: '4 Handsworth, B21' },
  { num: 'ENY-10277', email: 'sm@email.com', items: 3, total: 28.47, daysAgo: 3, delivery: 'Same-Day', status: 'Delivered', addr: '19 Lozells, B19' },
  { num: 'ENY-10276', email: 'go@email.com', items: 7, total: 82.93, daysAgo: 4, delivery: 'Next-Day', status: 'Processing', addr: '6 Saltley, B8' },
  { num: 'ENY-10275', email: 'da@email.com', items: 2, total: 16.98, daysAgo: 4, delivery: 'Standard', status: 'Shipped', addr: '11 Winson Green, B18' },
  { num: 'ENY-10274', email: 'in@email.com', items: 4, total: 45.96, daysAgo: 5, delivery: 'Next-Day', status: 'Delivered', addr: '9 Newtown, B6' },
  { num: 'ENY-10273', email: 'ba@email.com', items: 1, total: 10.99, daysAgo: 5, delivery: 'Standard', status: 'Processing', addr: '2 Handsworth Wood, B20' }
];

const RETURN_REASONS = [
  { orderNum: 'ENY-10282', reason: 'Wrong item received', status: 'Pending' },
  { orderNum: 'ENY-10279', reason: 'Damaged in transit', status: 'Pending' },
  { orderNum: 'ENY-10274', reason: 'Quality not as expected', status: 'Pending' },
  { orderNum: 'ENY-10281', reason: 'Item missing from order', status: 'Processed' },
  { orderNum: 'ENY-10278', reason: 'Wrong size delivered', status: 'Processed' }
];

const PROMOS = [
  { code: 'WELCOME10', type: 'percentage', value: 10, min: 0, used: 47, expires: '2026-12-31', status: 'active' },
  { code: 'ENNYS20', type: 'percentage', value: 20, min: 30, used: 12, expires: '2026-08-18', status: 'active' },
  { code: 'FREESHIP', type: 'free_delivery', value: 0, min: 20, used: 89, expires: '2026-09-30', status: 'active' },
  { code: 'MEAT15', type: 'percentage', value: 15, min: 25, used: 34, expires: '2026-04-01', status: 'expired' }
];

const BANNERS = [
  { title: 'Fresh Meat Week', subtitle: 'Up to 20% off goat, beef & chicken', background_color: '#b84500', cta_text: 'Shop All Products', cta_link: '/shop' },
  { title: 'Pantry Essentials Bundle', subtitle: 'Garri, semolina, poundo yam & more — save!', background_color: '#1b5e20', cta_text: 'Shop Fish & Seafood', cta_link: '/fish' }
];

function main() {
  const existingOrders = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const force = process.argv.includes('--force');
  if (existingOrders > 0 && !force) {
    console.error(`orders table already has ${existingOrders} rows. Re-run with --force to wipe and re-seed.`);
    process.exit(1);
  }
  if (existingOrders > 0 && force) {
    db.prepare('DELETE FROM orders').run(); // cascades order_items, and returns.order_id becomes dangling-safe via nullable FK
    db.prepare('DELETE FROM returns').run();
    db.prepare('DELETE FROM promo_codes').run();
    db.prepare('DELETE FROM promo_banners').run();
    db.prepare('DELETE FROM flash_sales').run();
    db.prepare('DELETE FROM customers').run();
    console.log('--force: wiped existing demo orders/returns/promos/customers.');
  }

  const products = db.prepare('SELECT id, name, emoji, price FROM products').all();
  if (products.length === 0) {
    console.error('No products found. Run scripts/import-products.js first.');
    process.exit(1);
  }

  function randomProducts(n) {
    const pool = [...products];
    const picked = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    return picked;
  }

  const insertCustomer = db.prepare('INSERT OR IGNORE INTO customers (name, email, location) VALUES (?, ?, ?)');
  const getCustomer = db.prepare('SELECT id FROM customers WHERE email = ?');
  const customerIdByEmail = new Map();

  const insertOrder = db.prepare(
    `INSERT INTO orders (order_number, customer_id, customer_name, customer_email, delivery_address,
      delivery_type, status, subtotal, total, created_at)
     VALUES (@order_number, @customer_id, @customer_name, @customer_email, @delivery_address,
      @delivery_type, @status, @subtotal, @total, datetime('now', @created_offset))`
  );
  const insertOrderItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, product_name, product_emoji, unit_price, quantity, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const seedAll = db.transaction(() => {
    for (const c of CUSTOMERS) {
      insertCustomer.run(c.name, c.email, c.location);
      const row = getCustomer.get(c.email);
      customerIdByEmail.set(c.email, row.id);
    }

    const orderIdByNum = new Map();
    for (const o of ORDERS) {
      const customer = CUSTOMERS.find(c => c.email === o.email);
      const customerId = customerIdByEmail.get(o.email);
      const info = insertOrder.run({
        order_number: o.num,
        customer_id: customerId,
        customer_name: customer.name,
        customer_email: o.email,
        delivery_address: o.addr,
        delivery_type: o.delivery,
        status: o.status,
        subtotal: o.total,
        total: o.total,
        created_offset: `-${o.daysAgo} days`
      });
      const orderId = info.lastInsertRowid;
      orderIdByNum.set(o.num, orderId);

      const picked = randomProducts(Math.min(o.items, products.length));
      const unitPrice = Math.round((o.total / Math.max(picked.length, 1)) * 100) / 100;
      picked.forEach(p => {
        insertOrderItem.run(orderId, p.id, p.name, p.emoji, unitPrice, 1, unitPrice);
      });
    }

    const insertReturn = db.prepare(
      `INSERT INTO returns (return_number, order_id, customer_name, item_name, reason, refund_amount, status, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    RETURN_REASONS.forEach((r, i) => {
      const orderId = orderIdByNum.get(r.orderNum);
      const item = db.prepare('SELECT * FROM order_items WHERE order_id = ? LIMIT 1').get(orderId);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      insertReturn.run(
        `RET-00${41 - i}`,
        orderId,
        order.customer_name,
        item ? item.product_name : 'Unknown item',
        r.reason,
        item ? item.unit_price : 0,
        r.status,
        r.status === 'Processed' ? new Date().toISOString() : null
      );
    });

    const insertPromo = db.prepare(
      `INSERT INTO promo_codes (code, type, value, min_order_value, used_count, expires_at, status)
       VALUES (@code, @type, @value, @min, @used, @expires, @status)`
    );
    PROMOS.forEach(p => insertPromo.run({
      code: p.code, type: p.type, value: p.value, min: p.min, used: p.used, expires: p.expires, status: p.status
    }));

    const insertBanner = db.prepare(
      `INSERT INTO promo_banners (title, subtitle, background_color, cta_text, cta_link, active, sort_order)
       VALUES (@title, @subtitle, @background_color, @cta_text, @cta_link, 1, @sort_order)`
    );
    BANNERS.forEach((b, i) => insertBanner.run({ ...b, sort_order: i }));

    const flashProducts = randomProducts(3);
    if (flashProducts.length) {
      const insertFlash = db.prepare(
        `INSERT INTO flash_sales (title, discount_percent, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?)`
      );
      const linkFlash = db.prepare('INSERT INTO flash_sale_products (flash_sale_id, product_id) VALUES (?, ?)');
      const now = Date.now();
      const startsAt = new Date(now - 2 * 86400000).toISOString();
      const endsAt = new Date(now + 5 * 86400000).toISOString();
      const info = insertFlash.run('Fresh Meat Week — 20% Off', 20, startsAt, endsAt, 'live');
      flashProducts.forEach(p => linkFlash.run(info.lastInsertRowid, p.id));
    }
  });

  seedAll();
  console.log(`Seeded ${CUSTOMERS.length} customers, ${ORDERS.length} orders, ${RETURN_REASONS.length} returns, ${PROMOS.length} promo codes, ${BANNERS.length} banners.`);
}

main();
