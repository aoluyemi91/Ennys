// Must be mounted with express.raw({type:'application/json'}) and BEFORE the
// global express.json() body parser, since Stripe signature verification needs
// the untouched raw request body. See server.js.
const { getStripe, fulfillOrderPayment } = require('../lib/orderFulfillment');
const db = require('../db');

async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    const stripe = getStripe();
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      : JSON.parse(req.body.toString('utf8')); // no secret configured — trust locally, dev-only fallback
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  const intent = event.data && event.data.object;
  if (intent && intent.id && (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed')) {
    const order = db.prepare('SELECT id FROM orders WHERE stripe_payment_intent_id = ?').get(intent.id);
    if (order) {
      try {
        await fulfillOrderPayment(order.id);
      } catch (e) {
        console.error('Webhook fulfillment error:', e.message);
      }
    }
  }

  res.json({ received: true });
}

module.exports = stripeWebhookHandler;
