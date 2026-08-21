const db = require('../db');

// Validates a promo code against a given subtotal. Returns either
// { valid: true, promo, discountAmount, freeDelivery } or { valid: false, error }.
function validatePromoCode(code, subtotal) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return { valid: false, error: 'Enter a promo code' };

  const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(normalized);
  if (!promo) return { valid: false, error: 'Promo code not found' };
  if (promo.status !== 'active') return { valid: false, error: 'This promo code is no longer active' };
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return { valid: false, error: 'This promo code has expired' };
  }
  if (promo.max_uses != null && promo.used_count >= promo.max_uses) {
    return { valid: false, error: 'This promo code has reached its usage limit' };
  }
  if (subtotal < promo.min_order_value) {
    return { valid: false, error: `Minimum order of £${promo.min_order_value.toFixed(2)} required for this code` };
  }

  let discountAmount = 0;
  let freeDelivery = false;
  if (promo.type === 'percentage') {
    discountAmount = Math.round(subtotal * (promo.value / 100) * 100) / 100;
  } else if (promo.type === 'fixed') {
    discountAmount = Math.min(promo.value, subtotal);
  } else if (promo.type === 'free_delivery') {
    freeDelivery = true;
  }

  return { valid: true, promo, discountAmount, freeDelivery };
}

module.exports = { validatePromoCode };
