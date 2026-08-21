// Shared header/footer, injected into every store page's #siteHeader/#siteFooter
// placeholders — avoids duplicating identical markup across 9 HTML files.
async function renderLayout() {
  const headerEl = document.getElementById('siteHeader');
  const footerEl = document.getElementById('siteFooter');
  if (headerEl) headerEl.innerHTML = headerHtml();
  if (footerEl) {
    let footer = {};
    try { footer = await apiFetch('/api/storefront/cms/footer'); } catch {}
    footerEl.innerHTML = footerHtml(footer);
  }
  wireHeaderInteractions();
  updateCartBadge();
}

function headerHtml() {
  return `
    <div class="announce-bar" id="announceBar"></div>
    <header class="site-header">
      <div class="container row">
        <button class="hamburger" id="menuToggle" aria-label="Open menu"><span></span><span></span><span></span></button>
        <a href="/" class="logo">Ennys<span>.</span></a>
        <nav class="desktop-nav">
          <a href="/store/shop.html">Shop</a>
          <a href="/store/shop.html?tag=new">New In</a>
          <a href="/store/shop.html?tag=best-sellers">Best Sellers</a>
          <a href="/store/shop.html?tag=featured">Featured</a>
        </nav>
        <div class="header-search-wrap header-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" id="headerSearch" placeholder="Search for products…">
        </div>
        <div class="header-actions">
          <a href="/store/account.html" class="btn-icon" aria-label="Account">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>
          </a>
          <a href="/store/cart.html" class="btn-icon cart-badge" aria-label="Cart">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M1 1h4l2.4 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 6H6"/></svg>
            <span class="cart-count" style="display:none">0</span>
          </a>
        </div>
      </div>
    </header>
    <div class="mobile-menu-backdrop" id="menuBackdrop"></div>
    <div class="mobile-menu" id="mobileMenu">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <span class="logo">Ennys<span>.</span></span>
        <button class="btn-icon" id="menuClose" aria-label="Close menu">✕</button>
      </div>
      <a href="/store/shop.html">Shop All</a>
      <a href="/store/shop.html?tag=new">New In</a>
      <a href="/store/shop.html?tag=best-sellers">Best Sellers</a>
      <a href="/store/shop.html?tag=featured">Featured</a>
      <a href="/store/account.html">My Account</a>
      <a href="/store/cart.html">Cart</a>
    </div>
  `;
}

function footerLinksHtml(links) {
  if (!links || !links.length) return '';
  return links.map(l => `<a href="${l.url || '#'}">${l.label || ''}</a>`).join('<br>');
}

function footerHtml(footer) {
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div>
            <h4>Ennys</h4>
            <p>${footer.description || ''}</p>
            <div class="footer-social">
              <a href="#" aria-label="Instagram">📷</a>
              <a href="#" aria-label="Facebook">📘</a>
              <a href="#" aria-label="WhatsApp">💬</a>
            </div>
          </div>
          <div>
            <h4>Help &amp; Support</h4>
            ${footerLinksHtml(footer.help_links)}
          </div>
          <div>
            <h4>Business</h4>
            ${footerLinksHtml(footer.business_links)}
          </div>
          <div>
            <h4>Contact</h4>
            <p>${footer.address || ''}</p>
            <p>${footer.email || ''}</p>
            <p>${footer.phone || ''}</p>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} Ennys. All rights reserved.</span>
          <div class="payment-badges"><span>VISA</span><span>MASTERCARD</span></div>
        </div>
      </div>
    </footer>
  `;
}

function wireHeaderInteractions() {
  const toggle = document.getElementById('menuToggle');
  const close = document.getElementById('menuClose');
  const menu = document.getElementById('mobileMenu');
  const backdrop = document.getElementById('menuBackdrop');
  const open = () => { menu.classList.add('open'); backdrop.classList.add('open'); };
  const shut = () => { menu.classList.remove('open'); backdrop.classList.remove('open'); };
  if (toggle) toggle.addEventListener('click', open);
  if (close) close.addEventListener('click', shut);
  if (backdrop) backdrop.addEventListener('click', shut);

  const search = document.getElementById('headerSearch');
  if (search) {
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && search.value.trim()) {
        location.href = `/store/shop.html?search=${encodeURIComponent(search.value.trim())}`;
      }
    });
  }

  apiFetch('/api/storefront/cms/announcement_bar').then(a => {
    const bar = document.getElementById('announceBar');
    if (bar && a) bar.innerHTML = a.text || '';
  }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', renderLayout);
