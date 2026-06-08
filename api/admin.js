/* ═══════════════════════════════════════════════════════════════
   SHOPLIXO ADMIN PANEL — FIXED & ULTRA PRO v4
   All bugs fixed. All API actions aligned with backend.
═══════════════════════════════════════════════════════════════ */

/* ─── CONFIG ─── */
const ADMIN_KEY_STORAGE = 'slx_admin_key';
let adminKey = '';
let currentPage = 1;
let searchTimer = null;
let revenueChart = null;
let statusChart = null;

/* ─── HELPERS ─── */
const $ = id => document.getElementById(id);
const fmt = n => '৳' + Number(n || 0).toLocaleString('en-IN');
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

async function adminFetch(path, opts = {}) {
  const r = await fetch(`/api/admin?${path}`, {
    ...opts,
    headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return r.json();
}

function toast(msg, type = 'default') {
  const t = document.createElement('div');
  t.className = `adm-t ${type}`;
  t.innerHTML = `<i class="fa-solid fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>${msg}`;
  $('adm-toast').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3500);
}

/* ─── AUTH ─── */
function adminLogin() {
  const pass = $('la-pass').value;
  const user = $('la-user').value.trim();
  if (!pass) { $('lc-err').style.display = 'block'; $('lc-err').textContent = 'Password দিন!'; return; }

  const btn = document.querySelector('.lc-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> যাচাই করা হচ্ছে...'; }

  fetch('/api/admin?action=stats', { headers: { 'x-admin-key': pass } })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        adminKey = pass;
        localStorage.setItem(ADMIN_KEY_STORAGE, pass);
        $('login-screen').style.display = 'none';
        $('app').style.display = 'block';
        initDashboard();
        startClock();
        $('lc-err').style.display = 'none';
      } else {
        $('lc-err').textContent = 'ভুল Admin Key!';
        $('lc-err').style.display = 'block';
      }
    })
    .catch(() => {
      $('lc-err').textContent = 'Server এর সাথে connect হচ্ছে না';
      $('lc-err').style.display = 'block';
    })
    .finally(() => {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Login'; }
    });
}

function adminLogout() {
  localStorage.removeItem(ADMIN_KEY_STORAGE);
  adminKey = '';
  $('login-screen').style.display = 'flex';
  $('app').style.display = 'none';
}

/* Auto-login */
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(ADMIN_KEY_STORAGE);
  if (saved) {
    adminKey = saved;
    fetch('/api/admin?action=stats', { headers: { 'x-admin-key': saved } })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          $('login-screen').style.display = 'none';
          $('app').style.display = 'block';
          initDashboard();
          startClock();
        }
      });
  }
  if ($('la-pass')) $('la-pass').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
  if ($('la-user')) $('la-user').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
  renderScheduledFlashSales();
  loadSmsConfig();
  checkPendingProducts();
});

/* ─── NAV ─── */
const sectionTitles = {
  dashboard: 'Dashboard', orders: 'Orders', customers: 'Customers',
  newsletter: 'Newsletter', settings: 'Settings', products: 'Products',
  reviews: 'Reviews & Comments', coupons: 'Coupons', flashsale: 'Flash Sales',
  bundles: 'Bundle Offers', loyalty: 'Loyalty Points', referral: 'Referral Program',
};

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  const sec = $(`sec-${id}`);
  if (sec) sec.classList.add('active');
  document.querySelectorAll('.sb-item').forEach(i => {
    if (i.getAttribute('onclick') && i.getAttribute('onclick').includes(`'${id}'`)) i.classList.add('active');
  });
  $('tb-title').textContent = sectionTitles[id] || id;
  loadCurrentSection(id);
}

function loadCurrentSection(id) {
  const active = id || document.querySelector('.section.active')?.id?.replace('sec-', '');
  if (active === 'dashboard')  loadDashboard();
  else if (active === 'orders')     loadOrders(currentPage);
  else if (active === 'customers')  loadCustomers();
  else if (active === 'newsletter') loadNewsletter();
  else if (active === 'products')   loadAdminProducts();
  else if (active === 'reviews')    loadReviews();
  else if (active === 'coupons')    loadCoupons();
  else if (active === 'flashsale')  loadFlashSales();
  else if (active === 'bundles')    loadBundles();
  else if (active === 'loyalty')    loadLoyaltyData();
  else if (active === 'referral')   loadReferralData();
}

/* ─── CLOCK ─── */
function startClock() {
  const tick = () => { if ($('tb-time')) $('tb-time').textContent = new Date().toLocaleTimeString('en-BD'); };
  tick(); setInterval(tick, 1000);
}

/* ═══════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════ */
async function initDashboard() { await loadDashboard(); }

async function loadDashboard() {
  try {
    const data = await adminFetch('action=stats');
    if (!data.ok) { toast('Stats লোড হয়নি', 'warning'); return; }
    const s = data.stats;

    // FIX: backend sends monthRev not monthRevenue
    $('s-total').textContent = (s.totalOrders || 0).toLocaleString();
    $('s-rev').textContent = fmt(s.monthRev);
    $('s-pending').textContent = (s.pendingOrders || 0).toLocaleString();
    $('s-today').textContent = (s.todayOrders || 0).toLocaleString();
    $('s-users').textContent = (s.totalUsers || 0).toLocaleString();
    const avg = s.totalOrders > 0 ? Math.round((s.totalRev || 0) / s.totalOrders) : 0;
    $('s-avg').textContent = fmt(avg);
    if ($('pending-badge')) $('pending-badge').textContent = s.pendingOrders || 0;

    // Revenue chart — FIX: backend sends date/revenue/orders not _id/revenue
    const days = data.revenueByDay || [];
    renderRevenueChart(days);

    // Status chart — FIX: backend sends status/count not _id/count
    const statuses = data.statusBreakdown || [];
    renderStatusChart(statuses);

    // Top products — FIX: backend sends name/qty/revenue/img not _id fields
    const tp = data.topProducts || [];
    $('top-products-body').innerHTML = tp.length
      ? tp.map((p, i) => `<tr>
          <td><strong>${i + 1}</strong></td>
          <td><div style="display:flex;align-items:center;gap:10px">
            <img src="${esc(p.img || '')}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;background:var(--bg)" onerror="this.style.display='none'">
            <span style="font-weight:600">${esc(p.name || 'Product')}</span>
          </div></td>
          <td><strong>${p.qty || 0}</strong> pcs</td>
          <td style="font-family:'Syne',sans-serif;font-weight:700;color:var(--green)">${fmt(p.revenue)}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text3)">কোনো data নেই</td></tr>';

    // Update product analytics
    if ($('pa-total')) $('pa-total').textContent = s.totalProducts || 0;
    if ($('pa-flash')) $('pa-flash').textContent = '—';
    if ($('pa-low')) { $('pa-low').textContent = s.lowStockProducts || 0; }

  } catch (e) { console.error(e); toast('Dashboard লোড এ সমস্যা', 'warning'); }
}

function renderRevenueChart(days) {
  const ctx = $('revenue-chart')?.getContext('2d');
  if (!ctx) return;
  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days.map(d => d.date || d._id),
      datasets: [{
        label: 'Revenue (৳)', data: days.map(d => d.revenue),
        backgroundColor: 'rgba(228,30,38,0.15)',
        borderColor: '#E41E26', borderWidth: 2, borderRadius: 6,
      }],
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.05)' } }, x: { grid: { display: false } } } },
  });
}

function renderStatusChart(statuses) {
  const ctx = $('status-chart')?.getContext('2d');
  if (!ctx) return;
  if (statusChart) statusChart.destroy();
  const colors = { pending: '#FFB800', confirmed: '#0066FF', processing: '#7C3AED', shipped: '#E41E26', delivered: '#00C58A', cancelled: '#888', returned: '#ccc' };
  // FIX: backend sends {status, count} not {_id, count}
  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: statuses.map(s => s.status || s._id),
      datasets: [{ data: statuses.map(s => s.count), backgroundColor: statuses.map(s => colors[s.status || s._id] || '#ccc'), borderWidth: 0 }],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 } } } }, cutout: '65%' },
  });
}

/* ═══════════════════════════════════════════
   ORDERS
═══════════════════════════════════════════ */
async function loadOrders(page = 1) {
  currentPage = page;
  const search = $('order-search')?.value || '';
  const status = $('order-status-filter')?.value || '';
  const payment = $('order-payment-filter')?.value || '';
  const params = `action=orders&page=${page}&limit=20${search ? '&search=' + encodeURIComponent(search) : ''}${status ? '&status=' + status : ''}${payment ? '&payment=' + payment : ''}`;
  $('orders-body').innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>`;
  try {
    const data = await adminFetch(params);
    if (!data.ok) { $('orders-body').innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--brand)">${data.error}</td></tr>`; return; }
    const { orders, pagination } = data;
    if (!orders?.length) {
      $('orders-body').innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)"><i class="fa-solid fa-inbox" style="font-size:32px;display:block;margin-bottom:8px;opacity:.3"></i>কোনো order নেই</td></tr>`;
      $('pg-info').textContent = ''; $('pg-btns').innerHTML = ''; return;
    }
    $('orders-body').innerHTML = orders.map(o => `
      <tr>
        <td><span class="order-id">${esc(o.orderId)}</span></td>
        <td><div class="cust-name">${esc(o.name)}</div><div class="cust-phone">${esc(o.phone)}</div></td>
        <td>${esc(o.district || '—')}</td>
        <td style="font-weight:600">${(o.items || []).reduce((s, i) => s + (i.qty || 0), 0)} pcs</td>
        <td class="total-cell">${fmt(o.total)}</td>
        <td><span class="pay-badge pb-${o.payment}">${(o.payment || '').toUpperCase()}</span></td>
        <td><span class="status-badge sb-${o.status}">${statusLabel(o.status)}</span></td>
        <td style="font-size:11px;color:var(--text3)">${fmtDate(o.createdAt)}</td>
        <td><div class="action-btns">
          <button class="ab-btn ab-view" onclick="viewOrder('${o.orderId}')" title="View"><i class="fa-solid fa-eye"></i></button>
          <button class="ab-btn ab-edit" onclick="quickStatus('${o.orderId}','${o.status}')" title="Quick Update"><i class="fa-solid fa-pen"></i></button>
          <button class="ab-btn ab-del" onclick="cancelOrder('${o.orderId}')" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
        </div></td>
      </tr>`).join('');

    const { total, pages } = pagination;
    $('pg-info').textContent = `Showing ${Math.min((page - 1) * 20 + 1, total)}–${Math.min(page * 20, total)} of ${total} orders`;
    const pgHTML = [];
    if (page > 1) pgHTML.push(`<button class="pg-btn" onclick="loadOrders(${page - 1})"><i class="fa-solid fa-chevron-left"></i></button>`);
    for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) pgHTML.push(`<button class="pg-btn ${i === page ? 'active' : ''}" onclick="loadOrders(${i})">${i}</button>`);
    if (page < pages) pgHTML.push(`<button class="pg-btn" onclick="loadOrders(${page + 1})"><i class="fa-solid fa-chevron-right"></i></button>`);
    $('pg-btns').innerHTML = pgHTML.join('');
  } catch (e) { $('orders-body').innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--brand);padding:30px">Server error: ${e.message}</td></tr>`; }
}

function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadOrders(1), 400);
}

async function viewOrder(id) {
  $('om-id').textContent = id;
  $('om-body').innerHTML = `<div style="text-align:center;padding:30px"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>`;
  $('order-modal').classList.add('open');
  const data = await adminFetch(`action=order&id=${id}`);
  if (!data.ok) { $('om-body').innerHTML = `<p style="color:var(--brand);padding:20px">${data.error}</p>`; return; }
  const o = data.order;
  $('om-body').innerHTML = `
    <div class="om-row">
      <div class="om-field"><label>Customer</label><span>${esc(o.customer?.name || o.name)}</span></div>
      <div class="om-field"><label>Phone</label><span>${esc(o.customer?.phone || o.phone)}</span></div>
      <div class="om-field"><label>Address</label><span>${esc(o.customer?.address || o.address)}</span></div>
      <div class="om-field"><label>District</label><span>${esc(o.customer?.district || o.district)}</span></div>
      <div class="om-field"><label>Payment</label><span class="pay-badge pb-${o.payment?.method || o.payment}">${(o.payment?.method || o.payment || '').toUpperCase()}</span></div>
      <div class="om-field"><label>Status</label><span class="status-badge sb-${o.status}">${statusLabel(o.status)}</span></div>
      ${o.payment?.transactionId ? `<div class="om-field"><label>Trx ID</label><span>${esc(o.payment.transactionId)}</span></div>` : ''}
      ${o.customer?.note ? `<div class="om-field"><label>Note</label><span>${esc(o.customer.note)}</span></div>` : ''}
    </div>
    <div class="om-items">
      ${(o.items || []).map(i => `<div class="om-item">
        <img class="omi-img" src="${esc(i.img || '')}" onerror="this.src=''">
        <div style="flex:1"><div class="omi-name">${esc(i.name)}</div><div class="omi-meta">Qty: ${i.qty}${i.size ? ' | Size: ' + i.size : ''}${i.color ? ' | Color: ' + i.color : ''}</div></div>
        <div class="omi-price">${fmt(i.price * i.qty)}</div>
      </div>`).join('')}
    </div>
    <div style="background:var(--bg);border-radius:var(--r);padding:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:5px"><span>Subtotal</span><span>${fmt(o.pricing?.subtotal || o.subtotal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:5px"><span>Shipping</span><span>${(o.pricing?.shipping || o.shipping) === 0 ? '<span style="color:var(--green)">Free</span>' : fmt(o.pricing?.shipping || o.shipping)}</span></div>
      ${(o.pricing?.discount || o.discount) > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--green);margin-bottom:5px"><span>Discount</span><span>-${fmt(o.pricing?.discount || o.discount)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-family:'Syne',sans-serif;font-size:17px;font-weight:700;border-top:1px solid var(--border);padding-top:9px;margin-top:5px"><span>Total</span><span style="color:var(--brand)">${fmt(o.pricing?.total || o.total)}</span></div>
    </div>
    <div class="status-update">
      <div class="su-title"><i class="fa-solid fa-pen-to-square" style="color:var(--brand)"></i> Order Status আপডেট করুন</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div><label style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:5px">Status</label>
          <select id="su-status" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--r);font-size:13px;outline:none;background:#fff">
            ${['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'].map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
          </select></div>
        <div><label style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:5px">Courier</label>
          <input type="text" id="su-courier" placeholder="Pathao / RedX / SA Paribahan" value="${esc(o.tracking?.courier || '')}" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--r);font-size:13px;outline:none"></div>
        <div><label style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:5px">Tracking ID</label>
          <input type="text" id="su-tracking" placeholder="Tracking number" value="${esc(o.tracking?.trackingId || '')}" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--r);font-size:13px;outline:none"></div>
        <div><label style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;display:block;margin-bottom:5px">Admin Note</label>
          <input type="text" id="su-note" placeholder="Internal note (optional)" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--r);font-size:13px;outline:none"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-update" onclick="updateOrderStatus('${o.orderId}')"><i class="fa-solid fa-floppy-disk"></i> Status Save</button>
        <button class="btn-update" style="background:var(--blue)" onclick="verifyPayment('${o.orderId}')"><i class="fa-solid fa-circle-check"></i> Payment Verify</button>
        <button class="btn-update" style="background:var(--brand)" onclick="cancelOrder('${o.orderId}')"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>
    </div>`;
}

async function updateOrderStatus(orderId) {
  const status = $('su-status')?.value;
  const tracking = $('su-tracking')?.value || '';
  const courier = $('su-courier')?.value || '';
  const note = $('su-note')?.value || '';
  if (!status) { toast('Status দিন!', 'warning'); return; }
  try {
    const resp = await fetch('/api/admin?action=status', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, id: orderId, status, trackId: tracking, courier, note }),
    });
    const data = await resp.json();
    if (data.ok) { toast('✅ Status আপডেট হয়েছে!', 'success'); closeOrderModal(); loadOrders(currentPage); }
    else toast(data.error || 'Update হয়নি', 'warning');
  } catch (e) { toast('Server error: ' + e.message, 'warning'); }
}

async function quickStatus(orderId, currentStatus) {
  const next = { pending: 'confirmed', confirmed: 'processing', processing: 'shipped', shipped: 'out_for_delivery', out_for_delivery: 'delivered' };
  const newStatus = next[currentStatus] || 'confirmed';
  if (!confirm(`"${orderId}" — Status "${statusLabel(currentStatus)}" থেকে "${statusLabel(newStatus)}" করবেন?`)) return;
  try {
    const resp = await fetch('/api/admin?action=status', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, id: orderId, status: newStatus }),
    });
    const data = await resp.json();
    if (data.ok) { toast('✅ Status → ' + statusLabel(newStatus), 'success'); loadOrders(currentPage); }
    else toast(data.error || 'Update হয়নি', 'warning');
  } catch (e) { toast('Server error: ' + e.message, 'warning'); }
}

async function cancelOrder(orderId) {
  if (!confirm(`"${orderId}" cancel করবেন? এই action undo হবে না।`)) return;
  try {
    const resp = await fetch('/api/admin?action=status', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, id: orderId, status: 'cancelled', note: 'Admin কর্তৃক বাতিল' }),
    });
    const data = await resp.json();
    if (data.ok) { toast('✅ Order cancelled', 'success'); closeOrderModal(); loadOrders(currentPage); }
    else toast(data.error || 'Cancel হয়নি', 'warning');
  } catch (e) { toast('Server error: ' + e.message, 'warning'); }
}

async function verifyPayment(orderId) {
  if (!confirm(`"${orderId}" এর payment verify করবেন?`)) return;
  try {
    const resp = await fetch('/api/admin?action=payment-verify', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, payStatus: 'verified' }),
    });
    const data = await resp.json();
    if (data.ok) { toast('✅ Payment verified!', 'success'); closeOrderModal(); loadOrders(currentPage); }
    else toast(data.error || 'Verify হয়নি', 'warning');
  } catch (e) { toast('Server error: ' + e.message, 'warning'); }
}

function closeOrderModal() { $('order-modal').classList.remove('open'); }

function statusLabel(s) {
  const m = { pending: '⏳ Pending', confirmed: '✅ Confirmed', processing: '⚙️ Processing', shipped: '🚚 Shipped', out_for_delivery: '🛵 Out for Delivery', delivered: '📦 Delivered', cancelled: '❌ Cancelled', refunded: '↩ Refunded', returned: '↩ Returned' };
  return m[s] || s;
}

/* ═══════════════════════════════════════════
   CUSTOMERS
═══════════════════════════════════════════ */
async function loadCustomers() {
  if ($('cust-grid')) $('cust-grid').innerHTML = `<div style="text-align:center;padding:40px;grid-column:1/-1"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>`;
  const data = await adminFetch('action=customers');
  if (!data.ok) { if($('cust-grid')) $('cust-grid').innerHTML = `<p style="color:var(--brand);padding:20px">${data.error}</p>`; return; }
  const users = data.users || [];
  $('cust-grid').innerHTML = users.length
    ? users.map(u => `<div class="cust-card">
        <div class="cc-ava">${(u.name || '?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div class="cc-name">${esc(u.name)}</div>
          <div class="cc-phone">${esc(u.phone || u.email || '—')}</div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
            <span style="background:var(--bg);border-radius:4px;padding:2px 6px;font-size:10px;font-weight:600">Orders: ${u.totalOrders || 0}</span>
            <span style="background:var(--bg);border-radius:4px;padding:2px 6px;font-size:10px;font-weight:600">Pts: ${u.loyaltyPoints || 0}</span>
            <button onclick="banCustomer('${u._id}',${u.isActive !== false})" style="background:${u.isActive !== false ? '#fdf0f0' : '#e6faf4'};color:${u.isActive !== false ? 'var(--brand)' : 'var(--green)'};border:none;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer">${u.isActive !== false ? 'Ban' : 'Unban'}</button>
          </div>
        </div>
      </div>`).join('')
    : '<div style="text-align:center;padding:40px;color:var(--text3);grid-column:1/-1">কোনো customer নেই</div>';
}

async function banCustomer(userId, currentActive) {
  if (!confirm(currentActive ? 'User ban করবেন?' : 'User unban করবেন?')) return;
  const data = await fetch('/api/admin?action=customer-ban', {
    method: 'POST',
    headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ban: currentActive }),
  }).then(r => r.json());
  if (data.ok) { toast('✅ ' + data.message, 'success'); loadCustomers(); }
  else toast(data.error || 'Error', 'warning');
}

/* ═══════════════════════════════════════════
   NEWSLETTER
═══════════════════════════════════════════ */
async function loadNewsletter() {
  const data = await adminFetch('action=newsletter');
  if (!data.ok) return;
  const subs = data.subscribers || [];
  $('nl-body').innerHTML = subs.length
    ? subs.map((s, i) => `<tr>
        <td>${i + 1}</td>
        <td><a href="mailto:${esc(s.email)}" style="color:var(--blue)">${esc(s.email)}</a></td>
        <td>${esc(s.name || '—')}</td>
        <td style="font-size:12px;color:var(--text3)">${fmtDate(s.createdAt)}</td>
        <td><span style="padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;background:${s.isActive ? '#e6faf4' : '#f5f5f5'};color:${s.isActive ? 'var(--green)' : 'var(--text3)'}">${s.isActive ? 'Active' : 'Unsubscribed'}</span></td>
        <td><button onclick="deleteSubscriber('${esc(s.email)}')" style="background:#fdf0f0;color:var(--brand);border:none;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text3)">কোনো subscriber নেই</td></tr>';
}

async function deleteSubscriber(email) {
  if (!confirm(`"${email}" remove করবেন?`)) return;
  const data = await fetch('/api/admin?action=newsletter-del', {
    method: 'POST',
    headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }).then(r => r.json());
  if (data.ok) { toast('✅ Removed!', 'success'); loadNewsletter(); }
  else toast(data.error || 'Error', 'warning');
}

/* ─── CSV EXPORTS ─── */
async function exportOrders() {
  toast('Exporting...', 'default');
  const data = await adminFetch('action=orders&limit=500');
  if (!data.ok) return;
  const rows = [['Order ID', 'Name', 'Phone', 'District', 'Items', 'Total', 'Payment', 'Status', 'Date']];
  (data.orders || []).forEach(o => rows.push([o.orderId, o.name, o.phone, o.district, (o.items || []).reduce((s, i) => s + i.qty, 0), o.total, o.payment, o.status, new Date(o.createdAt).toLocaleDateString()]));
  downloadCSV(rows, 'shoplixo_orders.csv');
  toast('Export done! ✅', 'success');
}

async function exportNewsletter() {
  const data = await adminFetch('action=newsletter');
  if (!data.ok) return;
  const rows = [['Email', 'Name', 'Date']];
  (data.subscribers || []).forEach(s => rows.push([s.email, s.name || '', new Date(s.createdAt).toLocaleDateString()]));
  downloadCSV(rows, 'shoplixo_newsletter.csv');
  toast('Export done! ✅', 'success');
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

function changePassword() {
  const pw = $('new-pw')?.value;
  if (!pw || pw.length < 8) { toast('Password কমপক্ষে ৮ অক্ষর দিন', 'warning'); return; }
  localStorage.setItem(ADMIN_KEY_STORAGE, pw);
  adminKey = pw;
  toast('✅ Password updated! এখন নতুন password দিয়ে login করতে পারবেন।', 'success');
}

/* ═══════════════════════════════════════════
   PRODUCTS MANAGEMENT
═══════════════════════════════════════════ */
let allAdminProds = [];
let prodPage = 1;
const PROD_PER_PAGE = 15;

async function loadAdminProducts() {
  $('prod-body').innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>`;
  try {
    const data = await adminFetch('action=products&limit=200');
    if (data.ok) {
      allAdminProds = data.products || [];
      // Update analytics from stats
      if ($('pa-total')) $('pa-total').textContent = data.total || allAdminProds.length;
      if ($('pa-flash')) $('pa-flash').textContent = allAdminProds.filter(p => p.isFlash).length;
      if ($('pa-low')) $('pa-low').textContent = allAdminProds.filter(p => (p.stock || 0) <= 5).length;
      renderAdminProducts();
    } else {
      $('prod-body').innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:30px">${data.error || 'Products API unavailable'}</td></tr>`;
    }
  } catch (e) {
    $('prod-body').innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--brand);padding:30px">Server error: ${e.message}</td></tr>`;
  }
}

function filterAdminProducts() { prodPage = 1; renderAdminProducts(); }

function renderAdminProducts() {
  const search = $('prod-search')?.value?.toLowerCase() || '';
  const cat = $('prod-cat-filter')?.value || '';
  let list = allAdminProds.filter(p =>
    (!search || (p.name || '').toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search) || (p.productId || '').toLowerCase().includes(search)) &&
    (!cat || p.cat === cat)
  );
  const total = list.length;
  const pages = Math.ceil(total / PROD_PER_PAGE) || 1;
  const slice = list.slice((prodPage - 1) * PROD_PER_PAGE, prodPage * PROD_PER_PAGE);

  $('prod-body').innerHTML = slice.length
    ? slice.map(p => `<tr>
        <td><div style="display:flex;align-items:center;gap:10px">
          <img src="${esc(p.img || '')}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;background:var(--bg)" onerror="this.style.display='none'">
          <div><div style="font-weight:600;font-size:13px">${esc(p.name)}</div><div style="font-size:11px;color:var(--text3)">${esc(p.sku || p.productId || '')}</div></div>
        </div></td>
        <td><span style="padding:3px 8px;background:var(--bg);border-radius:4px;font-size:11px;font-weight:600">${esc(p.cat || '—')}</span></td>
        <td><span style="font-family:'Syne',sans-serif;font-weight:700;color:var(--brand)">৳${Number(p.price || 0).toLocaleString()}</span>${(p.orig || 0) > (p.price || 0) ? `<br><span style="font-size:11px;color:var(--text3);text-decoration:line-through">৳${Number(p.orig).toLocaleString()}</span>` : ''}</td>
        <td><span style="font-weight:600;color:${(p.stock || 0) <= 5 ? 'var(--brand)' : (p.stock || 0) <= 20 ? 'var(--gold)' : 'var(--green)'}">${p.stock || 0}</span></td>
        <td>${p.badge ? `<span class="status-badge" style="background:${badgeBg(p.badge)};color:#fff">${p.badge.toUpperCase()}</span>` : '—'}</td>
        <td>
          ${p.isFeatured ? '<span style="font-size:10px;background:#e6f0ff;color:var(--blue);padding:2px 6px;border-radius:3px;margin:1px;display:inline-block">Featured</span>' : ''}
          ${p.isFlash ? '<span style="font-size:10px;background:#fff8e6;color:var(--gold);padding:2px 6px;border-radius:3px;margin:1px;display:inline-block">Flash</span>' : ''}
          ${p.isNew ? '<span style="font-size:10px;background:#e6faf4;color:var(--green);padding:2px 6px;border-radius:3px;margin:1px;display:inline-block">New</span>' : ''}
          ${!p.isActive ? '<span style="font-size:10px;background:#fdf0f0;color:var(--brand);padding:2px 6px;border-radius:3px;display:inline-block">Inactive</span>' : ''}
        </td>
        <td><div class="action-btns">
          <button class="ab-btn ab-view" onclick="viewProductDetail('${p.productId || p._id}')" title="View"><i class="fa-solid fa-eye"></i></button>
          <button class="ab-btn ab-edit" title="Toggle Flash" onclick="toggleProductFlag('${p.productId}','isFlash',${p.isFlash})"><i class="fa-solid fa-bolt" style="color:${p.isFlash ? 'var(--gold)' : ''}"></i></button>
          <button class="ab-btn ab-edit" title="Edit Product" onclick="editProduct('${p.productId}')"><i class="fa-solid fa-pen"></i></button>
          <button class="ab-btn ab-del" title="Delete Product" onclick="deleteProduct('${p.productId}','${(p.name || '').replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i></button>
          <button class="ab-btn" title="Toggle Active" onclick="toggleProductFlag('${p.productId}','isActive',${p.isActive !== false})" style="background:${p.isActive !== false ? 'rgba(0,197,138,.12)' : 'rgba(228,30,38,.1)'};color:${p.isActive !== false ? 'var(--green)' : 'var(--brand)'}"><i class="fa-solid fa-toggle-${p.isActive !== false ? 'on' : 'off'}"></i></button>
        </div></td>
      </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3)"><i class="fa-solid fa-box-open" style="font-size:32px;display:block;margin-bottom:10px;opacity:.3"></i>কোনো product নেই</td></tr>`;

  $('prod-pg-info').textContent = `Showing ${Math.min((prodPage - 1) * PROD_PER_PAGE + 1, total)}–${Math.min(prodPage * PROD_PER_PAGE, total)} of ${total}`;
  const pg = [];
  if (prodPage > 1) pg.push(`<button class="pg-btn" onclick="prodPage--;renderAdminProducts()"><i class="fa-solid fa-chevron-left"></i></button>`);
  for (let i = Math.max(1, prodPage - 2); i <= Math.min(pages, prodPage + 2); i++) pg.push(`<button class="pg-btn ${i === prodPage ? 'active' : ''}" onclick="prodPage=${i};renderAdminProducts()">${i}</button>`);
  if (prodPage < pages) pg.push(`<button class="pg-btn" onclick="prodPage++;renderAdminProducts()"><i class="fa-solid fa-chevron-right"></i></button>`);
  $('prod-pg-btns').innerHTML = pg.join('');
}

function badgeBg(b) { return { hot: '#FF4500', new: '#00C58A', sale: '#E41E26', best: '#FFB800' }[b] || '#888'; }

function editProduct(productId) {
  const p = allAdminProds.find(x => x.productId === productId || String(x._id) === String(productId));
  if (p) openProductModal(p);
  else toast('Product পাওয়া যায়নি', 'warning');
}

async function toggleProductFlag(productId, flag, currentVal) {
  const update = { productId };
  if (flag === 'isFlash') update.isFlash = !currentVal;
  else if (flag === 'isActive') update.isActive = !currentVal;
  else if (flag === 'isFeatured') update.isFeatured = !currentVal;
  else if (flag === 'isNew') update.isNew = !currentVal;
  try {
    const resp = await fetch('/api/admin?action=product-edit', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    const data = await resp.json();
    if (data.ok) { toast('✅ Updated!', 'success'); loadAdminProducts(); }
    else toast(data.error || 'Update হয়নি', 'warning');
  } catch (e) { toast('Server error: ' + e.message, 'warning'); }
}

async function deleteProduct(id, name) {
  if (!confirm(`"${name}" permanently delete করবেন? এই কাজ undo হবে না।`)) return;
  try {
    const resp = await fetch('/api/admin?action=product-delete', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: id }),
    });
    const data = await resp.json();
    if (data.ok) { toast('✅ Product delete হয়েছে!', 'success'); loadAdminProducts(); }
    else toast(data.error || 'Delete হয়নি', 'warning');
  } catch (e) { toast('Server error: ' + e.message, 'warning'); }
}

function viewProductDetail(id) {
  const p = allAdminProds.find(x => x.productId === id || String(x._id) === id);
  if (!p) return;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;cursor:pointer;overflow-y:auto';
  el.innerHTML = `<div style="background:#fff;border-radius:16px;padding:24px;max-width:480px;width:100%;box-shadow:var(--sh-lg);cursor:default" onclick="event.stopPropagation()">
    <img src="${esc(p.img || '')}" style="width:100%;max-height:200px;object-fit:cover;border-radius:12px;margin-bottom:16px" onerror="this.style.display='none'">
    <h3 style="font-family:'Syne',sans-serif;font-size:17px;margin-bottom:12px">${esc(p.name)}</h3>
    <table style="width:100%;font-size:13px;border-collapse:collapse">
      ${[['Category', p.cat], ['Price', '৳' + (p.price || 0)], ['Orig', '৳' + (p.orig || '—')], ['Stock', p.stock], ['Rating', (p.rating || 0) + ' ⭐'], ['Reviews', p.reviews || 0], ['Material', p.material || '—'], ['Warranty', p.warranty || '—'], ['SKU', p.sku || '—']].map(([k, v]) => `<tr><td style="padding:6px 0;color:var(--text3);font-weight:600;width:40%">${k}</td><td style="padding:6px 0">${v || '—'}</td></tr>`).join('')}
    </table>
    ${p.desc ? `<p style="font-size:13px;color:var(--text2);line-height:1.7;margin-top:12px;border-top:1px solid var(--border);padding-top:12px">${esc(p.desc)}</p>` : ''}
    <div style="text-align:center;margin-top:16px;display:flex;gap:8px;justify-content:center">
      <button onclick="editProduct('${p.productId || p._id}');this.closest('[style*=fixed]').remove()" style="background:var(--brand);color:#fff;padding:10px 20px;border-radius:999px;font-weight:700;border:none;cursor:pointer"><i class="fa-solid fa-pen"></i> Edit</button>
      <button onclick="this.closest('[style*=fixed]').remove()" style="background:var(--bg);color:var(--text2);padding:10px 20px;border-radius:999px;font-weight:700;border:none;cursor:pointer">Close</button>
    </div>
  </div>`;
  el.onclick = e => { if (e.target === el) el.remove(); };
  document.body.appendChild(el);
}

/* ═══════════════════════════════════════════
   REVIEWS / COMMENTS — FIX: backend returns data.comments not data.reviews
═══════════════════════════════════════════ */
async function loadReviews() {
  const status = $('review-status-filter')?.value || '';
  const rating = $('review-rating-filter')?.value || '';
  $('reviews-body').innerHTML = `<div style="text-align:center;padding:40px"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>`;
  try {
    const filterVal = status === 'pending' ? 'pending' : status === 'approved' ? 'approved' : 'all';
    let url = `action=reviews&filter=${filterVal}${rating ? '&rating=' + rating : ''}`;
    const data = await adminFetch(url);
    if (!data.ok) throw new Error(data.error);
    // FIX: backend returns 'comments' not 'reviews'
    const reviews = data.comments || data.reviews || [];
    const total = reviews.length;
    const pending = reviews.filter(r => !r.isApproved && !r.isHidden).length;
    const verified = reviews.filter(r => r.isVerifiedPurchase).length;
    const avg = total ? (reviews.reduce((s, r) => s + (r.rating || 5), 0) / total).toFixed(1) : '—';
    if ($('rv-total')) $('rv-total').textContent = total;
    if ($('rv-pending')) $('rv-pending').textContent = pending;
    if ($('rv-avg')) $('rv-avg').textContent = avg + ' ⭐';
    if ($('rv-verified')) $('rv-verified').textContent = verified;
    if (!reviews.length) {
      $('reviews-body').innerHTML = `<div class="empty-state"><i class="fa-solid fa-star"></i><p>কোনো review নেই</p></div>`;
      if ($('review-badge')) $('review-badge').style.display = 'none';
      return;
    }
    $('reviews-body').innerHTML = reviews.map((r, i) => `
      <div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--dark2));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0;font-size:15px">${(r.customerName || '?')[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <strong style="font-size:14px">${esc(r.customerName)}</strong>
              ${r.isVerifiedPurchase ? '<span style="background:#e6faf4;color:var(--green);font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px">✅ Verified</span>' : ''}
              ${r.isApproved ? '<span style="background:#e6f0ff;color:var(--blue);font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px">✓ Approved</span>' : r.isHidden ? '<span style="background:#f5f5f5;color:var(--text3);font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px">Hidden</span>' : '<span style="background:#fff8e6;color:var(--gold);font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px">⏳ Pending</span>'}
              <span style="margin-left:auto;font-size:11px;color:var(--text3)">${r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</span>
            </div>
            <div style="color:var(--gold);font-size:13px;margin-bottom:6px">${'★'.repeat(r.rating || 5)}${'☆'.repeat(5 - (r.rating || 5))} <span style="color:var(--text3);font-size:12px">${r.rating || 5}.0</span></div>
            ${r.title ? `<div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(r.title)}</div>` : ''}
            <div style="font-size:13px;color:var(--text2);line-height:1.6">${esc(r.body)}</div>
            ${r.reply?.text ? `<div style="background:var(--bg);border-radius:8px;padding:10px;margin-top:8px;font-size:12px;border-left:3px solid var(--brand)"><strong style="color:var(--brand)"><i class="fa-solid fa-reply"></i> Admin Reply:</strong><br>${esc(r.reply.text)}</div>` : ''}
            <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
              ${!r.isApproved && !r.isHidden ? `<button class="cmr-btn" style="background:#e6faf4;color:var(--green)" onclick="reviewAction('${r._id}','approve')"><i class="fa-solid fa-check"></i> Approve</button>` : ''}
              ${r.isApproved ? `<button class="cmr-btn" style="background:#f5f5f5;color:var(--text3)" onclick="reviewAction('${r._id}','hide')"><i class="fa-solid fa-eye-slash"></i> Hide</button>` : ''}
              ${r.isHidden ? `<button class="cmr-btn" style="background:#e6f0ff;color:var(--blue)" onclick="reviewAction('${r._id}','approve')"><i class="fa-solid fa-eye"></i> Unhide</button>` : ''}
              <button class="cmr-btn" style="background:#e6f0ff;color:var(--blue)" onclick="showReplyBox('${r._id}')"><i class="fa-solid fa-reply"></i> Reply</button>
              <button class="cmr-btn" style="background:#fdf0f0;color:var(--brand)" onclick="reviewAction('${r._id}','delete')"><i class="fa-solid fa-trash"></i> Delete</button>
              <span style="font-size:11px;color:var(--text3);margin-left:auto;align-self:center">Product: ${r.productId || '—'}</span>
            </div>
            <div id="reply-box-${r._id}" style="display:none;margin-top:10px">
              <textarea id="reply-text-${r._id}" placeholder="Admin reply লিখুন..." rows="2" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;outline:none;resize:vertical"></textarea>
              <button onclick="submitReply('${r._id}')" style="background:var(--brand);color:#fff;padding:7px 16px;border-radius:999px;font-size:12px;font-weight:700;border:none;cursor:pointer;margin-top:6px"><i class="fa-solid fa-paper-plane"></i> Reply পাঠান</button>
            </div>
          </div>
        </div>
      </div>`).join('');
    if ($('review-badge')) {
      $('review-badge').style.display = pending > 0 ? 'flex' : 'none';
      $('review-badge').textContent = pending > 0 ? pending : '!';
    }
  } catch (e) {
    $('reviews-body').innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Review API unavailable<br><small>${e.message}</small></p></div>`;
  }
}

async function reviewAction(id, action) {
  if (action === 'delete' && !confirm('এই review permanently delete করবেন?')) return;
  let apiAction, body = { id };
  if (action === 'approve') { apiAction = 'review-approve'; body = { id, hide: false }; }
  else if (action === 'hide') { apiAction = 'review-approve'; body = { id, hide: true }; }
  else if (action === 'delete') { apiAction = 'review-delete'; body = { id }; }
  try {
    const resp = await fetch('/api/admin?action=' + apiAction, {
      method: 'POST', headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.ok) { toast('✅ Done!', 'success'); loadReviews(); }
    else toast(data.error || 'Error', 'warning');
  } catch (e) { toast('Server error: ' + e.message, 'warning'); }
}

function showReplyBox(id) {
  const box = document.getElementById(`reply-box-${id}`);
  if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function submitReply(id) {
  const text = document.getElementById(`reply-text-${id}`)?.value?.trim();
  if (!text) { toast('Reply লিখুন!', 'warning'); return; }
  try {
    const resp = await fetch('/api/admin?action=review-reply', {
      method: 'POST', headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, text }),
    });
    const data = await resp.json();
    if (data.ok) { toast('✅ Reply পাঠানো হয়েছে!', 'success'); loadReviews(); }
    else toast(data.error || 'Error', 'warning');
  } catch (e) { toast('Server error: ' + e.message, 'warning'); }
}

async function approveAllReviews() {
  if (!confirm('All pending reviews approve করবেন?')) return;
  try {
    // FIX: get pending, approve each one
    const data = await adminFetch('action=reviews&filter=pending&limit=100');
    if (!data.ok) throw new Error(data.error);
    const pending = (data.comments || data.reviews || []).filter(r => !r.isApproved && !r.isHidden);
    if (!pending.length) { toast('কোনো pending review নেই', 'default'); return; }
    let done = 0;
    for (const r of pending) {
      const resp = await fetch('/api/admin?action=review-approve', {
        method: 'POST', headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r._id, hide: false }),
      });
      const d = await resp.json();
      if (d.ok) done++;
    }
    toast(`✅ ${done}টি review approve হয়েছে!`, 'success'); loadReviews();
  } catch (e) { toast('Error: ' + e.message, 'warning'); }
}

/* ═══════════════════════════════════════════
   COUPONS — FIX: backend uses 'toggle-coupon' and 'coupon-delete' actions
═══════════════════════════════════════════ */
async function loadCoupons() {
  $('coupons-body').innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>`;
  try {
    const data = await adminFetch('action=coupons');
    if (!data.ok) throw new Error(data.error);
    const coupons = data.coupons || [];
    $('coupons-body').innerHTML = coupons.length
      ? coupons.map(c => `<tr>
          <td><code style="font-weight:700;font-size:13px;background:var(--bg);padding:3px 8px;border-radius:4px">${esc(c.code)}</code></td>
          <td><span style="padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;background:${c.type === 'percent' ? '#e6f0ff' : '#e6faf4'};color:${c.type === 'percent' ? 'var(--blue)' : 'var(--green)'}">${c.type === 'percent' ? '%' : '৳'}</span></td>
          <td><strong style="color:var(--brand)">${c.discount}${c.type === 'percent' ? '%' : '৳'}</strong></td>
          <td>৳${c.minOrder || 0}</td>
          <td>${c.usedCount || 0} / ${c.maxUses || '∞'}</td>
          <td style="font-size:11px;color:var(--text3)">${c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : 'Never'}</td>
          <td><span style="padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;background:${c.isActive ? '#e6faf4' : '#f5f5f5'};color:${c.isActive ? 'var(--green)' : 'var(--text3)'}">${c.isActive ? 'Active' : 'Inactive'}</span></td>
          <td><div class="action-btns">
            <button class="ab-btn ab-edit" onclick="toggleCoupon('${esc(c.code)}')" title="${c.isActive ? 'Deactivate' : 'Activate'}"><i class="fa-solid fa-toggle-${c.isActive ? 'on' : 'off'}"></i></button>
            <button class="ab-btn ab-del" onclick="deleteCoupon('${esc(c.code)}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div></td>
        </tr>`).join('')
      : `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text3)">কোনো coupon নেই। একটি create করুন!</td></tr>`;
  } catch (e) {
    $('coupons-body').innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:30px">Coupons API error: ${e.message}</td></tr>`;
  }
}

async function createCoupon() {
  const code = $('nc-code')?.value?.trim().toUpperCase();
  const type = $('nc-type')?.value;
  const discount = parseFloat($('nc-discount')?.value);
  const minOrder = parseFloat($('nc-min')?.value || '0');
  const maxUses = parseInt($('nc-max')?.value || '0');
  const expiresAt = $('nc-expiry')?.value;
  const description = $('nc-desc')?.value?.trim();
  if (!code || !discount) { toast('Code এবং Discount দিন!', 'warning'); return; }
  try {
    const data = await fetch('/api/admin?action=coupon', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, type, discount, minOrder, maxUses, expiresAt: expiresAt || null, description }),
    }).then(r => r.json());
    if (data.ok) {
      toast(`Coupon "${code}" created! ✅`, 'success');
      ['nc-code', 'nc-discount', 'nc-min', 'nc-max', 'nc-expiry', 'nc-desc'].forEach(id => { if ($(id)) $(id).value = ''; });
      loadCoupons();
    } else toast(data.error || 'Error', 'warning');
  } catch { toast('API error', 'warning'); }
}

// FIX: backend uses 'toggle-coupon' action with code (not couponId)
async function toggleCoupon(code) {
  try {
    const data = await fetch('/api/admin?action=toggle-coupon', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(r => r.json());
    if (data.ok) { toast('Updated! ✅', 'success'); loadCoupons(); }
    else toast(data.error || 'Error', 'warning');
  } catch { toast('API error', 'warning'); }
}

// FIX: backend uses 'coupon-delete' action with code
async function deleteCoupon(code) {
  if (!confirm(`Coupon "${code}" delete করবেন?`)) return;
  try {
    const data = await fetch('/api/admin?action=coupon-delete', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(r => r.json());
    if (data.ok) { toast('Deleted! ✅', 'success'); loadCoupons(); }
    else toast(data.error || 'Error', 'warning');
  } catch { toast('API error', 'warning'); }
}

/* ═══════════════════════════════════════════
   FLASH SALES — FIX: backend uses 'flash-sales', 'flash-sale-add', 'flash-sale-del'
═══════════════════════════════════════════ */
async function loadFlashSales() {
  $('flash-sales-body').innerHTML = `<div style="text-align:center;padding:30px"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>`;
  try {
    // FIX: correct action name is 'flash-sales' not 'flashsales'
    const data = await adminFetch('action=flash-sales');
    if (!data.ok) throw new Error(data.error);
    const sales = data.sales || [];
    $('flash-sales-body').innerHTML = sales.length
      ? sales.map(s => {
          const now = new Date(), start = new Date(s.startAt), end = new Date(s.endAt);
          const isLive = s.isActive && now >= start && now <= end;
          const isUpcoming = s.isActive && now < start;
          return `<div style="border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <div>
                <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700">${esc(s.title)}</div>
                <div style="font-size:12px;color:var(--text3);margin-top:2px">${start.toLocaleString()} → ${end.toLocaleString()}</div>
                ${s.extraDiscountPct ? `<div style="font-size:11px;color:var(--gold);margin-top:4px">+${s.extraDiscountPct}% extra discount</div>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;background:${isLive ? '#e6faf4' : isUpcoming ? '#fff8e6' : '#f5f5f5'};color:${isLive ? 'var(--green)' : isUpcoming ? 'var(--gold)' : 'var(--text3)'}">${isLive ? '🔴 LIVE' : isUpcoming ? '⏳ Upcoming' : 'Ended'}</span>
                <button class="ab-btn ab-del" onclick="deleteFlashSale('${s._id}')"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
          </div>`;
        }).join('')
      : `<div class="empty-state"><i class="fa-solid fa-bolt"></i><p>কোনো flash sale নেই</p></div>`;
  } catch (e) {
    $('flash-sales-body').innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Flash Sales API error: ${e.message}</p></div>`;
  }
}

async function createFlashSale() {
  const title = $('fs-title')?.value?.trim();
  const startAt = $('fs-start')?.value;
  const endAt = $('fs-end')?.value;
  const extraDiscountPct = parseFloat($('fs-disc')?.value || '0');
  const description = $('fs-desc')?.value?.trim();
  if (!title || !startAt || !endAt) { toast('Title, Start, End সব দিন!', 'warning'); return; }
  if (new Date(endAt) <= new Date(startAt)) { toast('End time must be after start time!', 'warning'); return; }
  try {
    // FIX: correct action name is 'flash-sale-add' not 'flashsale'
    const data = await fetch('/api/admin?action=flash-sale-add', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, startAt, endAt, extraDiscountPct, description, isActive: true }),
    }).then(r => r.json());
    if (data.ok) {
      toast('Flash Sale scheduled! ✅', 'success');
      ['fs-title', 'fs-start', 'fs-end', 'fs-disc', 'fs-desc'].forEach(id => { if ($(id)) $(id).value = ''; });
      loadFlashSales();
    } else toast(data.error || 'Error', 'warning');
  } catch { toast('API error', 'warning'); }
}

async function deleteFlashSale(id) {
  if (!confirm('এই flash sale delete করবেন?')) return;
  try {
    // FIX: correct action name is 'flash-sale-del'
    const data = await fetch('/api/admin?action=flash-sale-del', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(r => r.json());
    if (data.ok) { toast('Deleted! ✅', 'success'); loadFlashSales(); }
    else toast(data.error || 'Error', 'warning');
  } catch { toast('API error', 'warning'); }
}

/* ═══════════════════════════════════════════
   BUNDLES — FIX: backend uses 'bundle-add', 'bundle-edit', 'bundle-delete'
═══════════════════════════════════════════ */
async function loadBundles() {
  $('bundles-body').innerHTML = `<div style="text-align:center;padding:30px"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>`;
  try {
    const data = await adminFetch('action=bundles');
    if (!data.ok) throw new Error(data.error);
    const bundles = data.bundles || [];
    $('bundles-body').innerHTML = bundles.length
      ? bundles.map(b => `<div style="border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:10px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
            <div style="flex:1">
              <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:4px">${esc(b.title)}</div>
              <div style="font-size:13px;color:var(--text2);margin-bottom:6px">${esc(b.description || '')}</div>
              <div style="font-size:12px;color:var(--text3)">Products: ${(b.productIds || []).join(', ')}</div>
              <div style="font-size:12px;color:var(--brand);margin-top:4px;font-weight:700">Discount: ${b.discountValue}${b.discountType === 'percent' ? '%' : '৳'} — Sold: ${b.totalSold || 0}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <span style="padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${b.isActive ? '#e6faf4' : '#f5f5f5'};color:${b.isActive ? 'var(--green)' : 'var(--text3)'}">${b.isActive ? 'Active' : 'Inactive'}</span>
              <button class="ab-btn ab-del" onclick="deleteBundle('${b._id}')"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        </div>`).join('')
      : `<div class="empty-state"><i class="fa-solid fa-layer-group"></i><p>কোনো bundle নেই</p></div>`;
  } catch (e) {
    $('bundles-body').innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Bundles API error: ${e.message}</p></div>`;
  }
}

async function createBundle() {
  const title = $('nb-title')?.value?.trim();
  const description = $('nb-desc')?.value?.trim();
  const productIds = ($('nb-products')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const discountType = $('nb-disc-type')?.value;
  const discountValue = parseFloat($('nb-disc-val')?.value);
  if (!title || productIds.length < 2 || !discountValue) { toast('Title, Products (min 2), Discount সব দিন!', 'warning'); return; }
  try {
    // FIX: correct action name is 'bundle-add' not 'bundle'
    const data = await fetch('/api/admin?action=bundle-add', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, productIds, discountType, discountValue, isActive: true }),
    }).then(r => r.json());
    if (data.ok) {
      toast('Bundle created! ✅', 'success');
      ['nb-title', 'nb-desc', 'nb-products', 'nb-disc-val'].forEach(id => { if ($(id)) $(id).value = ''; });
      loadBundles();
    } else toast(data.error || 'Error', 'warning');
  } catch { toast('API error', 'warning'); }
}

async function deleteBundle(id) {
  if (!confirm('এই bundle delete করবেন?')) return;
  try {
    // FIX: correct action name is 'bundle-delete'
    const data = await fetch('/api/admin?action=bundle-delete', {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(r => r.json());
    if (data.ok) { toast('Deleted! ✅', 'success'); loadBundles(); }
    else toast(data.error || 'Error', 'warning');
  } catch { toast('API error', 'warning'); }
}

/* ═══════════════════════════════════════════
   LOYALTY & REFERRAL (stubs with real data)
═══════════════════════════════════════════ */
async function loadLoyaltyData() {
  try {
    const data = await adminFetch('action=customers&limit=100');
    if (!data.ok) return;
    const users = data.users || [];
    const withPoints = users.filter(u => (u.loyaltyPoints || 0) > 0);
    if ($('loy-members')) $('loy-members').textContent = withPoints.length;
    if ($('loy-issued')) $('loy-issued').textContent = withPoints.reduce((s, u) => s + (u.loyaltyPoints || 0), 0).toLocaleString();
    if ($('loy-gold-count')) {
      const gold = withPoints.filter(u => (u.loyaltyPoints || 0) >= 5000).length;
      $('loy-gold-count').textContent = gold + ' Gold';
    }
    const el = $('loyalty-members-list');
    if (el) {
      el.innerHTML = withPoints.length ? withPoints.map(u => {
        const pts = u.loyaltyPoints || 0;
        const tier = pts >= 20000 ? '💎 Platinum' : pts >= 5000 ? '🥇 Gold' : pts >= 1000 ? '🥈 Silver' : '🥉 Bronze';
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--border)">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--dark2));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">${(u.name || '?')[0].toUpperCase()}</div>
          <div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(u.name)}</div><div style="font-size:11px;color:var(--text3)">${tier}</div></div>
          <div style="font-family:'Syne',sans-serif;font-weight:700;color:var(--gold)">${pts.toLocaleString()} pts</div>
        </div>`;
      }).join('') : '<div style="text-align:center;padding:30px;color:var(--text3)">কোনো loyalty member নেই</div>';
    }
  } catch (e) { console.error(e); }
}

async function loadReferralData() {
  const el = $('referral-list');
  if (el) el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">Referral data: API integration needed</div>';
}

/* ═══════════════════════════════════════════
   PRODUCT MODAL
═══════════════════════════════════════════ */
let editingProductId = null;
let uploadedImages = [];

function openProductModal(prod = null) {
  editingProductId = prod ? (prod.productId || prod._id || null) : null;
  uploadedImages = [];
  const modal = $('product-modal');
  if (!modal) return;
  $('pm-modal-title').textContent = prod ? 'Product Edit করুন' : 'নতুন Product যোগ করুন';
  if (prod) {
    $('pm-name').value = prod.name || '';
    $('pm-cat').value = prod.cat || 'mens-shirts';
    $('pm-price').value = prod.price || '';
    $('pm-orig').value = prod.orig || '';
    $('pm-stock').value = prod.stock || '';
    $('pm-rating').value = prod.rating || '4.5';
    $('pm-reviews').value = prod.reviews || '';
    $('pm-badge').value = prod.badge || 'hot';
    $('pm-sizes').value = (prod.sizes || []).join(', ');
    $('pm-colors').value = (prod.colors || []).join(', ');
    $('pm-material').value = prod.material || '';
    $('pm-viewers').value = prod.viewers || '12';
    if ($('pm-warranty')) $('pm-warranty').value = prod.warranty || '';
    if ($('pm-sku')) $('pm-sku').value = prod.sku || '';
    if ($('pm-video')) $('pm-video').value = prod.videoUrl || '';
    $('pm-desc').value = prod.desc || '';
    $('pm-img').value = prod.img || '';
    $('pm-featured').checked = !!prod.isFeatured;
    $('pm-new').checked = !!prod.isNew;
    $('pm-flash').checked = !!prod.isFlash;
    if (prod.img) { uploadedImages = [prod.img]; showImgPreview(uploadedImages); }
  } else {
    ['pm-name', 'pm-price', 'pm-orig', 'pm-stock', 'pm-reviews', 'pm-sizes', 'pm-colors', 'pm-material', 'pm-desc', 'pm-img'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    if ($('pm-warranty')) $('pm-warranty').value = '';
    if ($('pm-sku')) $('pm-sku').value = '';
    if ($('pm-video')) $('pm-video').value = '';
    $('pm-rating').value = '4.5'; $('pm-viewers').value = '12';
    $('pm-featured').checked = false; $('pm-new').checked = true; $('pm-flash').checked = false;
    $('img-preview-grid').innerHTML = '';
  }
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeProductModal() {
  const modal = $('product-modal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function showImgPreview(urls) {
  const grid = $('img-preview-grid');
  if (!grid) return;
  grid.innerHTML = urls.map((url, i) => `
    <div class="img-preview-item ${i === 0 ? 'primary' : ''}">
      <img src="${url}" onerror="this.src=''">
      <button class="img-del" onclick="removePreviewImg(${i})"><i class="fa-solid fa-xmark"></i></button>
      ${i === 0 ? '<span class="img-primary-badge">Main</span>' : ''}
    </div>`).join('');
}

function removePreviewImg(i) { uploadedImages.splice(i, 1); showImgPreview(uploadedImages); }

function handleImgUpload(files) {
  const progress = $('upload-progress'), bar = $('upload-bar');
  if (progress) progress.style.display = 'block';
  let loaded = 0;
  [...files].forEach(file => {
    if (file.size > 5 * 1024 * 1024) { toast('Image 5MB এর বেশি হতে পারবে না!', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      uploadedImages.push(e.target.result);
      if (uploadedImages.length === 1) $('pm-img').value = 'uploaded';
      loaded++;
      if (bar) bar.style.width = (loaded / files.length * 100) + '%';
      if (loaded === files.length) {
        setTimeout(() => { if (progress) progress.style.display = 'none'; }, 600);
        showImgPreview(uploadedImages);
        toast(`${loaded}টি ছবি upload হয়েছে! ✅`, 'success');
      }
    };
    reader.readAsDataURL(file);
  });
}

function handleImgDrop(e) {
  e.preventDefault();
  $('img-upload-zone').classList.remove('drag-over');
  if (e.dataTransfer.files.length) handleImgUpload(e.dataTransfer.files);
}

function previewImgUrl(url) {
  const preview = $('pm-img-url-preview'), img = $('pm-img-url-img');
  if (!preview || !img) return;
  if (url && (url.startsWith('http') || url.startsWith('data:'))) { preview.style.display = 'block'; img.src = url; }
  else { preview.style.display = 'none'; }
}

async function saveProduct() {
  const name = $('pm-name')?.value?.trim();
  const cat = $('pm-cat')?.value;
  const price = parseFloat($('pm-price')?.value);
  const orig = parseFloat($('pm-orig')?.value) || price;
  const stock = parseInt($('pm-stock')?.value) || 50;
  const rating = parseFloat($('pm-rating')?.value) || 4.5;
  const reviews = parseInt($('pm-reviews')?.value) || 0;
  const badge = $('pm-badge')?.value || 'new';
  const sizes = ($('pm-sizes')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const colors = ($('pm-colors')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const material = $('pm-material')?.value?.trim() || '';
  const viewers = parseInt($('pm-viewers')?.value) || 12;
  const desc = $('pm-desc')?.value?.trim() || '';
  const warranty = $('pm-warranty')?.value?.trim() || '';
  const sku = $('pm-sku')?.value?.trim() || '';
  const videoUrl = $('pm-video')?.value?.trim() || '';
  const isFeatured = !!$('pm-featured')?.checked;
  const isNew = !!$('pm-new')?.checked;
  const isFlash = !!$('pm-flash')?.checked;
  let img = $('pm-img')?.value?.trim() || '';

  if (!name) { toast('Product নাম দিন!', 'warning'); return; }
  if (!cat) { toast('Category দিন!', 'warning'); return; }
  if (!price || isNaN(price) || price <= 0) { toast('সঠিক Price দিন!', 'warning'); return; }

  if (uploadedImages.length > 0 && (img === 'uploaded' || !img)) img = uploadedImages[0];
  if (!img) img = `https://source.unsplash.com/400x500/?${encodeURIComponent(cat.replace(/-/g, ','))}`;

  const productData = {
    name, cat, price, orig, stock, rating, reviews, badge,
    sizes, colors, material, viewers, desc, warranty, sku, videoUrl,
    img, images: uploadedImages.length > 0 ? uploadedImages : [img],
    isFeatured, isNew, isFlash, isActive: true,
  };

  // FIX: product-add for new, product-edit for existing (both use POST)
  const action = editingProductId ? 'product-edit' : 'product-add';
  if (editingProductId) productData.productId = editingProductId;

  const btn = document.querySelector('.btn-save-product');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> সংরক্ষণ হচ্ছে...'; }

  try {
    const resp = await fetch(`/api/admin?action=${action}`, {
      method: 'POST',
      headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(productData),
    });
    const data = await resp.json();
    if (data.ok) {
      toast(editingProductId ? '✅ Product আপডেট হয়েছে!' : '✅ Product যোগ হয়েছে!', 'success');
      closeProductModal(); loadAdminProducts(); uploadedImages = [];
    } else {
      toast(data.error || 'Product সংরক্ষণ হয়নি', 'warning');
    }
  } catch (err) {
    const localProds = JSON.parse(localStorage.getItem('slx_pending_products') || '[]');
    localProds.push({ ...productData, _pending: true, _time: Date.now() });
    localStorage.setItem('slx_pending_products', JSON.stringify(localProds));
    toast('Server offline — locally saved. Sync করুন।', 'warning');
    closeProductModal();
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Product Save করুন'; }
  }
}

/* ═══════════════════════════════════════════
   SETTINGS
═══════════════════════════════════════════ */
function loadSmsConfig() {
  const cfg = JSON.parse(localStorage.getItem('slx_sms_config') || '{}');
  if ($('sms-enabled')) $('sms-enabled').checked = cfg.enabled || false;
  if ($('sms-api-key')) $('sms-api-key').value = cfg.apiKey || '';
  if ($('sms-sender')) $('sms-sender').value = cfg.senderId || '';
  if ($('sms-order-template')) $('sms-order-template').value = cfg.templates?.orderConfirm || 'Shoplixo: আপনার Order {orderId} confirm হয়েছে। Total: ৳{total}। ধন্যবাদ!';
  if ($('sms-shipped-template')) $('sms-shipped-template').value = cfg.templates?.orderShipped || 'Shoplixo: আপনার Order {orderId} shipped হয়েছে। Track: shoplixo.shop/track';
}

function saveSmsConfig() {
  const config = {
    enabled: $('sms-enabled')?.checked,
    provider: $('sms-provider')?.value,
    apiKey: $('sms-api-key')?.value,
    senderId: $('sms-sender')?.value,
    templates: {
      orderConfirm: $('sms-order-template')?.value,
      orderShipped: $('sms-shipped-template')?.value,
    },
  };
  localStorage.setItem('slx_sms_config', JSON.stringify(config));
  toast('SMS settings saved! ✅', 'success');
}

async function testSms() {
  const phone = $('sms-test-phone')?.value;
  if (!phone) { toast('Phone number দিন!', 'warning'); return; }
  toast(`Test SMS পাঠানো হচ্ছে ${phone} এ...`);
  try {
    const r = await fetch('/api/orders?action=test-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ phone }),
    }).then(res => res.json());
    toast(r.ok ? 'SMS sent! ✅' : r.error || 'SMS failed', r.ok ? 'success' : 'warning');
  } catch {
    toast('SMS API unavailable', 'warning');
  }
}

async function syncPendingProducts() {
  const pending = JSON.parse(localStorage.getItem('slx_pending_products') || '[]');
  if (!pending.length) { toast('কোনো pending product নেই।', 'default'); return; }
  let synced = 0;
  for (const p of pending) {
    try {
      const r = await fetch('/api/admin?action=product-add', {
        method: 'POST',
        headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      }).then(res => res.json());
      if (r.ok) synced++;
    } catch (e) { }
  }
  if (synced > 0) {
    localStorage.removeItem('slx_pending_products');
    toast(`${synced}টি product sync হয়েছে! ✅`, 'success');
    loadAdminProducts();
  } else {
    toast('Sync failed — server offline', 'warning');
  }
}

function checkPendingProducts() {
  const pending = JSON.parse(localStorage.getItem('slx_pending_products') || '[]');
  if (pending.length > 0) toast(`${pending.length}টি pending product আছে। Settings এ Sync করুন।`, 'warning');
}

function bulkUpdateStock(category, amount) {
  toast(`${category || 'সব'} category তে +${amount} stock update হবে server এ`, 'default');
  fetch('/api/admin?action=product-bulk', {
    method: 'POST',
    headers: { 'x-admin-key': adminKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'activate', category, stockIncrease: amount }),
  }).then(r => r.json()).then(data => {
    toast(data.ok ? `✅ Stock updated!` : (data.error || 'Error'), data.ok ? 'success' : 'warning');
  }).catch(() => toast('API error', 'warning'));
}

/* Local Flash Sale Scheduler */
function renderScheduledFlashSales() {
  const scheduled = JSON.parse(localStorage.getItem('slx_flash_schedule') || '[]');
  const el = $('local-flash-list');
  if (!el) return;
  el.innerHTML = scheduled.length ? scheduled.map(s => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
      <div style="flex:1">
        <div style="font-weight:700;font-size:13px">${esc(s.title)}</div>
        <div style="font-size:11px;color:var(--text3)">${s.discount}% ছাড় · ${new Date(s.startTime).toLocaleString()}</div>
      </div>
      <button onclick="deleteLocalSale(${s.id})" style="background:var(--brand-l);color:var(--brand);border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px"><i class="fa-solid fa-trash"></i></button>
    </div>`).join('') : '<div style="text-align:center;padding:16px;color:var(--text3);font-size:12px">কোনো local sale নেই।</div>';
}

function deleteLocalSale(id) {
  let s = JSON.parse(localStorage.getItem('slx_flash_schedule') || '[]');
  s = s.filter(x => x.id !== id);
  localStorage.setItem('slx_flash_schedule', JSON.stringify(s));
  renderScheduledFlashSales();
}

function quickScheduleFlash() {
  const title = $('quick-flash-title')?.value?.trim();
  const discount = parseInt($('quick-flash-discount')?.value) || 20;
  const hours = parseInt($('quick-flash-hours')?.value) || 8;
  if (!title) { toast('Title দিন!', 'warning'); return; }
  const start = new Date(), end = new Date(start.getTime() + hours * 3600000);
  const scheduled = JSON.parse(localStorage.getItem('slx_flash_schedule') || '[]');
  scheduled.push({ id: Date.now(), title, discount, startTime: start.getTime(), endTime: end.getTime() });
  localStorage.setItem('slx_flash_schedule', JSON.stringify(scheduled));
  toast(`"${title}" locally scheduled! ✅`, 'success');
  renderScheduledFlashSales();
}

/* ─── UTILITY ─── */
function esc(s) { return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

/* ─── EXPOSE GLOBALS ─── */
window.adminLogin = adminLogin;
window.adminLogout = adminLogout;
window.showSection = showSection;
window.loadCurrentSection = loadCurrentSection;
window.loadDashboard = loadDashboard;
window.loadOrders = loadOrders;
window.debounceSearch = debounceSearch;
window.viewOrder = viewOrder;
window.updateOrderStatus = updateOrderStatus;
window.quickStatus = quickStatus;
window.cancelOrder = cancelOrder;
window.verifyPayment = verifyPayment;
window.closeOrderModal = closeOrderModal;
window.loadCustomers = loadCustomers;
window.banCustomer = banCustomer;
window.loadNewsletter = loadNewsletter;
window.deleteSubscriber = deleteSubscriber;
window.exportOrders = exportOrders;
window.exportNewsletter = exportNewsletter;
window.changePassword = changePassword;
window.loadAdminProducts = loadAdminProducts;
window.filterAdminProducts = filterAdminProducts;
window.renderAdminProducts = renderAdminProducts;
window.toggleProductFlag = toggleProductFlag;
window.deleteProduct = deleteProduct;
window.viewProductDetail = viewProductDetail;
window.editProduct = editProduct;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.handleImgUpload = handleImgUpload;
window.handleImgDrop = handleImgDrop;
window.previewImgUrl = previewImgUrl;
window.removePreviewImg = removePreviewImg;
window.saveProduct = saveProduct;
window.loadReviews = loadReviews;
window.reviewAction = reviewAction;
window.showReplyBox = showReplyBox;
window.submitReply = submitReply;
window.approveAllReviews = approveAllReviews;
window.loadCoupons = loadCoupons;
window.createCoupon = createCoupon;
window.toggleCoupon = toggleCoupon;
window.deleteCoupon = deleteCoupon;
window.loadFlashSales = loadFlashSales;
window.createFlashSale = createFlashSale;
window.deleteFlashSale = deleteFlashSale;
window.loadBundles = loadBundles;
window.createBundle = createBundle;
window.deleteBundle = deleteBundle;
window.loadLoyaltyData = loadLoyaltyData;
window.loadReferralData = loadReferralData;
window.saveSmsConfig = saveSmsConfig;
window.testSms = testSms;
window.syncPendingProducts = syncPendingProducts;
window.bulkUpdateStock = bulkUpdateStock;
window.renderScheduledFlashSales = renderScheduledFlashSales;
window.deleteLocalSale = deleteLocalSale;
window.quickScheduleFlash = quickScheduleFlash;
window.toast = toast;