const db = require('../db');

function money(n) {
  return `£${Number(n || 0).toFixed(2)}`;
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'there';
}

function getStoreSettings() {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('store');
  return row ? JSON.parse(row.value_json) : { store_name: 'Ennys', contact_email: 'hello@ennys.co.uk' };
}

// One row per status: how it introduces itself in the subject line, heading,
// accent colour and body copy. Keeping all four together makes it obvious
// at a glance what's covered and makes adding a fifth status a one-line diff.
const STATUS_CONTENT = {
  Processing: {
    emoji: '✅',
    heading: 'Order Confirmed',
    accent: '#2e7d32',
    subject: o => `Order Confirmed — ${o.order_number}`,
    message: o => `Hi ${firstName(o.customer_name)}, thanks for shopping with Ennys! We've received your order and it's now being prepared.`
  },
  Shipped: {
    emoji: '🚚',
    heading: 'Order Shipped',
    accent: '#0d47a1',
    subject: o => `Your order is on its way — ${o.order_number}`,
    message: o => `Hi ${firstName(o.customer_name)}, great news — your order has been dispatched${o.delivery_type ? ` (${o.delivery_type} delivery)` : ''} and is on its way to you.`
  },
  Delivered: {
    emoji: '📦',
    heading: 'Order Delivered',
    accent: '#b84500',
    subject: o => `Delivered! — ${o.order_number}`,
    message: o => `Hi ${firstName(o.customer_name)}, your order has been delivered. We hope you enjoy it — thanks for shopping with us!`
  },
  Cancelled: {
    emoji: '✕',
    heading: 'Order Cancelled',
    accent: '#c62828',
    subject: o => `Order Cancelled — ${o.order_number}`,
    message: o => `Hi ${firstName(o.customer_name)}, your order has been cancelled. If a payment was taken, it'll be refunded to your original payment method within 5–7 working days.`
  }
};

function itemsTableHtml(items) {
  const rows = items.map(it => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333">
        ${it.product_emoji || ''} ${it.product_name}${it.variation_summary ? `<div style="font-size:11px;color:#999">${it.variation_summary}</div>` : ''}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#666;text-align:center">×${it.quantity}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;text-align:right;font-weight:600">${money(it.line_total)}</td>
    </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}</table>`;
}

function baseLayout({ storeName, accent, emoji, heading, message, bodyHtml, contactEmail }) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <table style="width:100%;background:#f5f5f5;padding:24px 0">
    <tr><td align="center">
      <table style="width:100%;max-width:560px;background:#fff;border-radius:10px;overflow:hidden">
        <tr><td style="background:#1a1a1a;padding:20px 28px">
          <span style="color:#fff;font-size:20px;font-weight:800;font-style:italic">${storeName}.</span>
        </td></tr>
        <tr><td style="padding:28px">
          <div style="font-size:32px;margin-bottom:8px">${emoji}</div>
          <h1 style="font-size:20px;margin:0 0 12px;color:${accent}">${heading}</h1>
          <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 20px">${message}</p>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 28px;background:#fafafa;border-top:1px solid #eee">
          <p style="font-size:12px;color:#999;margin:0">Questions about your order? Reply to this email or contact us at <a href="mailto:${contactEmail}" style="color:${accent}">${contactEmail}</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Builds the {to, subject, html} for a given order's current status, or null
// if that status has no customer-facing email (e.g. unrecognised status).
function buildOrderStatusEmail(orderId, status) {
  const content = STATUS_CONTENT[status];
  if (!content) return null;

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !order.customer_email) return null;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const store = getStoreSettings();

  const summaryHtml = `
    <div style="background:#fafafa;border-radius:8px;padding:16px 20px;margin-bottom:16px">
      <div style="font-size:12px;color:#999;text-transform:uppercase;font-weight:700;margin-bottom:4px">Order</div>
      <div style="font-size:15px;font-weight:700;color:#222">${order.order_number}</div>
    </div>
    ${itemsTableHtml(items)}
    <table style="width:100%;margin-top:8px">
      <tr><td style="font-size:13px;color:#666;padding:2px 0">Subtotal</td><td style="text-align:right;font-size:13px;color:#333;padding:2px 0">${money(order.subtotal)}</td></tr>
      <tr><td style="font-size:13px;color:#666;padding:2px 0">Delivery</td><td style="text-align:right;font-size:13px;color:#333;padding:2px 0">${order.delivery_fee ? money(order.delivery_fee) : 'Free'}</td></tr>
      ${order.discount_amount ? `<tr><td style="font-size:13px;color:#666;padding:2px 0">Discount</td><td style="text-align:right;font-size:13px;color:#2e7d32;padding:2px 0">-${money(order.discount_amount)}</td></tr>` : ''}
      <tr><td style="font-size:14px;font-weight:800;color:#222;padding-top:8px;border-top:1px solid #eee">Total</td><td style="text-align:right;font-size:14px;font-weight:800;color:#222;padding-top:8px;border-top:1px solid #eee">${money(order.total)}</td></tr>
    </table>
    ${order.delivery_address ? `
    <div style="margin-top:20px">
      <div style="font-size:12px;color:#999;text-transform:uppercase;font-weight:700;margin-bottom:4px">Delivery Address</div>
      <div style="font-size:13px;color:#444">${order.delivery_address}</div>
    </div>` : ''}
  `;

  const html = baseLayout({
    storeName: store.store_name || 'Ennys',
    accent: content.accent,
    emoji: content.emoji,
    heading: content.heading,
    message: content.message(order),
    bodyHtml: summaryHtml,
    contactEmail: store.contact_email || 'hello@ennys.co.uk'
  });

  return { to: order.customer_email, subject: content.subject(order), html };
}

module.exports = { buildOrderStatusEmail, STATUS_CONTENT };
