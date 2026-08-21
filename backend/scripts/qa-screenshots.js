// Responsive QA: screenshots every storefront page at 3 breakpoints and flags
// any horizontal overflow. Run with the server already running on port 4000.
// Usage: node scripts/qa-screenshots.js
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const BASE = 'http://localhost:4000';
const OUT_DIR = path.join(__dirname, '..', '.tmp', 'qa-screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 }
];

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'shop', path: '/store/shop.html' },
  { name: 'product', path: '/store/product.html?id=230' },
  { name: 'cart', path: '/store/cart.html' },
  { name: 'checkout', path: '/store/checkout.html' },
  { name: 'login', path: '/store/login.html' },
  { name: 'register', path: '/store/register.html' },
  { name: 'account', path: '/store/account.html' },
  { name: 'order-confirmation', path: '/store/order-confirmation.html?orderId=1' }
];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const issues = [];

  // Log in (or register) a throwaway QA customer so account/checkout pages
  // render their real authenticated layout instead of bouncing to /login.
  await page.goto(BASE + '/store/login.html', { waitUntil: 'networkidle0' });
  const authResult = await page.evaluate(async () => {
    const email = 'qa-screenshot-test@ennys.local';
    const password = 'qa-test-pass-123';
    let res = await fetch('/api/account/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      res = await fetch('/api/account/register', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'QA Screenshot Bot', email, password })
      });
    }
    return res.status;
  });
  console.log(`QA customer auth status: ${authResult}`);

  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    for (const p of PAGES) {
      try {
        await page.goto(BASE + p.path, { waitUntil: 'networkidle0', timeout: 20000 });
        await new Promise(r => setTimeout(r, 400));
        const check = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth
        }));
        if (check.scrollWidth > check.innerWidth + 2) {
          issues.push(`${p.name}@${vp.name}: horizontal overflow (scrollWidth ${check.scrollWidth} > innerWidth ${check.innerWidth})`);
        }
        const file = path.join(OUT_DIR, `${p.name}-${vp.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`✓ ${p.name}@${vp.name}`);
      } catch (e) {
        issues.push(`${p.name}@${vp.name}: FAILED TO LOAD — ${e.message}`);
        console.log(`✗ ${p.name}@${vp.name} — ${e.message}`);
      }
    }
  }

  await browser.close();
  console.log('\n--- Summary ---');
  if (issues.length === 0) {
    console.log('No horizontal overflow or load failures detected.');
  } else {
    issues.forEach(i => console.log('ISSUE: ' + i));
  }
  console.log(`Screenshots saved to ${OUT_DIR}`);
})();
