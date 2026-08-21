const db = require('../db');
const { syncProductFromVariations } = require('./variationHelpers');
const logActivity = require('./activityLog');
const { sendOrderStatusEmail } = require('./orderNotifications');

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set — add it to backend/.env before checking out.');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Shared by POST /api/checkout/confirm and the Stripe webhook. Re-verifies the
// PaymentIntent directly against Stripe (never trusts a client's say-so), then
// — only if Stripe itself reports success — decrements stock and marks the
// order paid. Idempotent: safe to call more than once for the same order.
async function fulfillOrderPayment(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.payment_status === 'paid') return order; // already fulfilled

  // Mock payment intents (used when no Stripe keys are configured) are never
  // verified against Stripe — they're considered successful by construction.
  const isMock = order.stripe_payment_intent_id && order.stripe_payment_intent_id.startsWith('mock_');
  if (!isMock) {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);

    if (intent.status !== 'succeeded') {
      db.prepare(`UPDATE orders SET payment_status = 'failed' WHERE id = ?`).run(orderId);
      return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    }
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

  const tx = db.transaction(() => {
    for (const item of items) {
      if (item.variation_id) {
        db.prepare('UPDATE product_variations SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?')
          .run(item.quantity, item.variation_id);
        syncProductFromVariations(item.product_id);
      } else if (item.product_id) {
        db.prepare('UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?')
          .run(item.quantity, item.product_id);
      }
      db.prepare('UPDATE products SET sales_count = sales_count + ? WHERE id = ?').run(item.quantity, item.product_id);
    }
    if (order.promo_code) {
      db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').run(order.promo_code);
    }
    db.prepare(`UPDATE orders SET payment_status = 'paid' WHERE id = ?`).run(orderId);
  });
  tx();

  logActivity(`New order ${order.order_number} paid — £${Number(order.total).toFixed(2)}`, '#2e7d32');
  // Order status is already 'Processing' at creation, so this is the customer's
  // first status email — sent once payment (not just checkout submission) succeeds.
  sendOrderStatusEmail(orderId, order.status);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

module.exports = { fulfillOrderPayment, getStripe };
