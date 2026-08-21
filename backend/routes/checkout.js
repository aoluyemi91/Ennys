const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { requireCustomerAuthApi } = require('../middleware/requireCustomerAuth');
const { getVariationsFor } = require('../lib/variationHelpers');
const { validatePromoCode } = require('../lib/promoHelpers');
const { fulfillOrderPayment, getStripe } = require('../lib/orderFulfillment');

const router = express.Router();
router.use(requireCustomerAuthApi);

const DELIVERY_FEE_KEY = { Standard: 'standard_fee', 'Next-Day': 'express_fee', Weekend: 'weekend_fee' };

function getDeliverySettings() {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('delivery');
  return row ? JSON.parse(row.value_json) : {};
}

function buildAddressStr(addr) {
  return [addr.line1, addr.line2, addr.city, addr.postcode].filter(Boolean).join(', ');
}

function nextOrderNumber() {
  const rows = db.prepare(`SELECT order_number FROM orders WHERE order_number LIKE 'ENY-%'`).all();
  const maxNum = rows.reduce((max, r) => {
    const n = parseInt(r.order_number.replace('ENY-', ''), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 10000);
  return `ENY-${maxNum + 1}`;
}

// Prices and validates every cart line server-side. Throws {status, error} on any problem.
function priceCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { status: 400, error: 'Your cart is empty' };
  }
  return items.map(line => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(line.productId);
    if (!product || product.status !== 'active') {
      throw { status: 409, error: `A product in your cart is no longer available` };
    }
    const qty = parseInt(line.quantity, 10) || 1;
    const variations = getVariationsFor(product.id);

    if (variations.length > 0) {
      if (!line.variationId) throw { status: 409, error: `Please select options for "${product.name}"` };
      const variation = variations.find(v => v.id === line.variationId);
      if (!variation) throw { status: 409, error: `The selected option for "${product.name}" is no longer available` };
      if (variation.stock_quantity < qty) throw { status: 409, error: `"${product.name}" doesn't have enough stock left` };
      const summary = variation.attributes.map(a => `${a.name}: ${a.value}`).join(', ');
      return {
        productId: product.id, variationId: variation.id, quantity: qty,
        unitPrice: variation.price, lineTotal: Math.round(variation.price * qty * 100) / 100,
        productName: product.name, productEmoji: product.emoji, variationSummary: summary
      };
    }

    if (product.stock_quantity < qty) throw { status: 409, error: `"${product.name}" doesn't have enough stock left` };
    return {
      productId: product.id, variationId: null, quantity: qty,
      unitPrice: product.price, lineTotal: Math.round(product.price * qty * 100) / 100,
      productName: product.name, productEmoji: product.emoji, variationSummary: null
    };
  });
}

router.post('/create-intent', async (req, res) => {
  const b = req.body || {};
  let priced;
  try {
    priced = priceCartItems(b.items);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.error || 'Unable to process cart' });
  }

  const subtotal = Math.round(priced.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
  const delivery = getDeliverySettings();
  const deliveryType = DELIVERY_FEE_KEY[b.deliveryType] ? b.deliveryType : 'Standard';

  let deliveryFee = subtotal >= (delivery.free_delivery_threshold || Infinity)
    ? 0
    : (delivery[DELIVERY_FEE_KEY[deliveryType]] || 0);

  let discountAmount = 0;
  let appliedPromoCode = null;
  if (b.promoCode) {
    const result = validatePromoCode(b.promoCode, subtotal);
    if (!result.valid) return res.status(400).json({ error: result.error });
    discountAmount = result.discountAmount;
    if (result.freeDelivery) deliveryFee = 0;
    appliedPromoCode = result.promo.code;
  }

  const total = Math.max(0, Math.round((subtotal + deliveryFee - discountAmount) * 100) / 100);

  // With no Stripe keys configured, fall back to a mock payment intent so the
  // checkout journey can still be tested end-to-end without a real Stripe account.
  const mockPayments = !process.env.STRIPE_SECRET_KEY;
  let intent;
  if (mockPayments) {
    intent = { id: `mock_${crypto.randomBytes(12).toString('hex')}`, client_secret: null };
  } else {
    try {
      const stripe = getStripe();
      intent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100),
        currency: 'gbp',
        automatic_payment_methods: { enabled: true }
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Unable to start payment' });
    }
  }

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.session.customerId);
  const addressStr = buildAddressStr(b.deliveryAddress || {});
  const orderNumber = nextOrderNumber();

  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO orders (order_number, customer_id, customer_name, customer_email, customer_phone, delivery_address,
        delivery_type, status, subtotal, delivery_fee, discount_amount, total, promo_code,
        stripe_payment_intent_id, payment_status)
       VALUES (@order_number, @customer_id, @customer_name, @customer_email, @customer_phone, @delivery_address,
        @delivery_type, 'Processing', @subtotal, @delivery_fee, @discount_amount, @total, @promo_code,
        @stripe_payment_intent_id, 'unpaid')`
    ).run({
      order_number: orderNumber,
      customer_id: customer.id,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: b.phone || null,
      delivery_address: addressStr,
      delivery_type: deliveryType,
      subtotal, delivery_fee: deliveryFee, discount_amount: discountAmount, total,
      promo_code: appliedPromoCode,
      stripe_payment_intent_id: intent.id
    });
    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, variation_id, product_name, product_emoji,
        unit_price, quantity, line_total, variation_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    priced.forEach(i => insertItem.run(
      orderId, i.productId, i.variationId, i.productName, i.productEmoji, i.unitPrice, i.quantity, i.lineTotal, i.variationSummary
    ));
    return orderId;
  });

  const orderId = tx();
  res.json({
    clientSecret: intent.client_secret,
    mock: mockPayments,
    orderId, orderNumber,
    subtotal, deliveryFee, discountAmount, total
  });
});

router.post('/confirm', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.body.orderId, req.session.customerId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // The order/PaymentIntent is created as soon as the checkout page loads, which can be
  // before the customer has finished typing their address/phone — so re-apply what the
  // customer actually submitted here, at the moment they confirm payment.
  if (req.body.deliveryAddress) {
    const addressStr = buildAddressStr(req.body.deliveryAddress);
    if (addressStr) {
      db.prepare('UPDATE orders SET delivery_address = ? WHERE id = ?').run(addressStr, order.id);
    }
  }
  if (req.body.phone) {
    db.prepare('UPDATE orders SET customer_phone = ? WHERE id = ?').run(req.body.phone, order.id);
  }

  try {
    const updated = await fulfillOrderPayment(order.id);
    if (updated.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment was not successful', paymentStatus: updated.payment_status });
    }
    res.json({ ok: true, orderId: updated.id, orderNumber: updated.order_number });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Unable to confirm payment' });
  }
});

module.exports = router;
