// Client-side cart (localStorage only — never trusted for pricing; the server
// re-prices everything from the database at checkout time). Shape:
// [{ productId, variationId (nullable), quantity }]
const CART_KEY = 'ennys_cart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function findLine(cart, productId, variationId) {
  return cart.find(l => l.productId === productId && (l.variationId || null) === (variationId || null));
}

function addItem(productId, variationId, quantity = 1) {
  const cart = getCart();
  const line = findLine(cart, productId, variationId);
  if (line) {
    line.quantity += quantity;
  } else {
    cart.push({ productId, variationId: variationId || null, quantity });
  }
  saveCart(cart);
}

function updateQty(productId, variationId, quantity) {
  let cart = getCart();
  if (quantity <= 0) {
    cart = cart.filter(l => !(l.productId === productId && (l.variationId || null) === (variationId || null)));
  } else {
    const line = findLine(cart, productId, variationId);
    if (line) line.quantity = quantity;
  }
  saveCart(cart);
}

function removeItem(productId, variationId) {
  updateQty(productId, variationId, 0);
}

function clearCart() {
  saveCart([]);
}

function cartCount() {
  return getCart().reduce((n, l) => n + l.quantity, 0);
}

function updateCartBadge() {
  document.querySelectorAll('.cart-count').forEach(el => {
    const count = cartCount();
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', updateCartBadge);
