// Shared fetch helper for the customer storefront. Mirrors admin.html's apiFetch
// but targets the customer session (/api/account, /api/checkout, /api/storefront)
// and redirects to the STORE login page on 401, not the admin one.
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (res.status === 401) {
    location.href = '/store/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    return null;
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || res.statusText);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

function toast(msg) {
  let el = document.getElementById('storeToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'storeToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function money(n) {
  return `£${Number(n || 0).toFixed(2)}`;
}
