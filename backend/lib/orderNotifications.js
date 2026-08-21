const { sendMail } = require('./mailer');
const { buildOrderStatusEmail } = require('./orderEmailTemplates');

// Best-effort: an email failure (bad SMTP creds, network blip) should never
// block the order status change or checkout flow that triggered it.
async function sendOrderStatusEmail(orderId, status) {
  try {
    const email = buildOrderStatusEmail(orderId, status);
    if (!email) return;
    await sendMail(email);
  } catch (err) {
    console.error(`[orderNotifications] failed to send "${status}" email for order ${orderId}:`, err.message);
  }
}

module.exports = { sendOrderStatusEmail };
