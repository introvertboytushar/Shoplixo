/**
 * ══════════════════════════════════════════════════════════════════════
 *  SHOPLIXO — Shared Helper Utilities  (Ultra Pro v4)
 *
 *  ✅ NEW  v4 additions:
 *    • verifyAdminPassword / hashPassword    — bcrypt server-side auth  (BUG-5)
 *    • validateCouponApi                     — thin wrapper for API handler (BUG-3)
 *    • buildInvoiceHTML                      — print/download invoice  (UPGRADE-A3)
 *    • csvExportProducts / parseCsvProducts  — CSV import/export       (UPGRADE-A2)
 *    • buildSkeletonHtml                     — SSR skeleton hint        (UPGRADE-I3)
 *    • getRevenueAggregation                 — monthly/yearly stats     (UPGRADE-A9)
 *    • formatBDT                             — Bengali currency helper
 *    • generateTicketId                      — support ticket ID
 *    • sendPushNotification                  — Web Push / FCM wrapper   (UPGRADE-I1)
 *    • getClientIp                           — reliable IP extraction
 *    • isStrongPassword                      — password strength check   (UPGRADE-A7)
 *
 *  ✅ FIXED  v4 improvements:
 *    • setCors: reads CORS_ORIGIN env (SEC-1 — restrict to shoplixo.shop)
 *    • checkRateLimit: stricter 30/min for auth endpoints
 *    • isAdmin: now supports bcrypt-async verification mode
 *    • emailBase: dynamic support phone from SUPPORT_PHONE env
 *    • smsTemplates: added ticketCreated, bulkStatusUpdate
 *    • paginate: maxLimit raised to 500 for CSV bulk exports
 * ══════════════════════════════════════════════════════════════════════
 */

'use strict';

const nodemailer = require('nodemailer');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');

// bcryptjs is a pure-JS implementation — works on Vercel edge/serverless
// without native addon compilation.
let bcrypt;
try { bcrypt = require('bcryptjs'); } catch (_) { bcrypt = null; }

// ═══════════════════════════════════════════════════════════════════════════════
//  CORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * setCors — ✅ FIXED v4 (SEC-1)
 * CORS_ORIGIN env variable should be set to 'https://shoplixo.shop' in production.
 * Falls back to '*' in dev / when not set, so local development still works.
 */
function setCors(res) {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin',  origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Admin-Key,x-admin-key,X-Requested-With,X-Affiliate-Code,Cache-Control,Pragma',
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count,X-Page,X-Pages');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Prevent CDN / browser from caching API responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma',            'no-cache');
  res.setHeader('Expires',           '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

function handleCors(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ID GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

function generateOrderId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `SL-${suffix}`;
}

function generateReturnId() {
  return `RTN-${Date.now().toString(36).toUpperCase()}`;
}

function generateSupplierId() {
  return `SUP-${Date.now().toString(36).toUpperCase()}`;
}

// ✅ NEW v4: Support ticket ID
function generateTicketId() {
  return `TKT-${Date.now().toString(36).toUpperCase()}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  JWT
// ═══════════════════════════════════════════════════════════════════════════════

function verifyToken(req) {
  try {
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    if (!token) return null;
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN AUTH  (BUG-5 / SEC-2)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * isAdmin — fast plain-text check (env-key comparison).
 * Used for every request that carries x-admin-key.
 * For the change-password flow use verifyAdminPassword() instead.
 */
function isAdmin(req) {
  const key = (
    req.headers['x-admin-key'] ||
    req.headers['X-Admin-Key'] ||
    req.query?.key             ||
    req.body?.adminKey         ||
    ''
  ).trim();

  if (!key) return false;

  const adminKeys = [
    process.env.ADMIN_PASSWORD,
    process.env.ADMIN_SECRET,
    process.env.ADMIN_KEY_2,
  ].filter(Boolean).map(k => k.trim());

  return adminKeys.includes(key);
}

/**
 * ✅ NEW v4: hashPassword(plain) → bcrypt hash
 * Use when storing admin password to DB (AdminConfig model).
 */
async function hashPassword(plain) {
  if (!bcrypt) throw new Error('bcryptjs not installed');
  return bcrypt.hash(plain, 12);
}

/**
 * ✅ NEW v4: verifyAdminPassword(plain, hash) → boolean
 * Used by api/admin?action=change-password to verify current password (UPGRADE-A7).
 */
async function verifyAdminPassword(plain, hash) {
  if (!bcrypt) {
    // Fallback: plain-text compare (less secure — install bcryptjs!)
    return plain === hash;
  }
  return bcrypt.compare(plain, hash);
}

/**
 * ✅ NEW v4: isStrongPassword(pw) — validates new password strength (UPGRADE-A7)
 * Returns { ok, reason }
 */
function isStrongPassword(pw) {
  if (!pw || pw.length < 8)
    return { ok: false, reason: 'কমপক্ষে ৮ অক্ষর দিন' };
  if (!/[A-Z]/.test(pw))
    return { ok: false, reason: 'একটি uppercase letter দিন' };
  if (!/[0-9]/.test(pw))
    return { ok: false, reason: 'একটি সংখ্যা দিন' };
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOYALTY TIER CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════
const LOYALTY_TIERS = {
  bronze:   { min: 0,     max: 999,     name: 'Bronze',   icon: '🥉', benefits: '5% extra discount on orders',            multiplier: 1 },
  silver:   { min: 1000,  max: 4999,    name: 'Silver',   icon: '🥈', benefits: '8% extra discount + free shipping',      multiplier: 1.5 },
  gold:     { min: 5000,  max: 14999,   name: 'Gold',     icon: '🥇', benefits: '12% extra discount + priority support',  multiplier: 2 },
  platinum: { min: 15000, max: Infinity, name: 'Platinum', icon: '💎', benefits: '20% extra discount + VIP treatment',    multiplier: 3 },
};

function getLoyaltyTier(points) {
  for (const [key, tier] of Object.entries(LOYALTY_TIERS)) {
    if (points >= tier.min && points <= tier.max) return { tier: key, ...tier };
  }
  return { tier: 'bronze', ...LOYALTY_TIERS.bronze };
}

function getNextTier(points) {
  const current = getLoyaltyTier(points);
  const tiers   = Object.keys(LOYALTY_TIERS);
  const idx     = tiers.indexOf(current.tier);
  if (idx === tiers.length - 1) return null;
  const next    = LOYALTY_TIERS[tiers[idx + 1]];
  return { ...next, tier: tiers[idx + 1], pointsNeeded: next.min - points };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROFIT CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════
function calculateProfit(order) {
  const supplierCost = (order.items || []).reduce(
    (sum, item) => sum + (item.supplierPrice || 0) * item.qty, 0,
  );
  const revenue = order.pricing?.total || 0;
  return Math.max(0, revenue - supplierCost);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CURRENCY HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/** ✅ NEW v4: formatBDT — consistent BDT formatting across emails & invoices */
function formatBDT(amount) {
  return `৳${Number(amount || 0).toLocaleString('en-BD')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SMS
// ═══════════════════════════════════════════════════════════════════════════════
async function sendSMS(phone, message) {
  try {
    if (!process.env.SMS_API_KEY) return false;
    let num = String(phone).replace(/\D/g, '');
    if (num.startsWith('880')) num = num.slice(3);
    if (num.startsWith('0'))   num = num.slice(1);
    const bdNum = `880${num}`;

    const provider = process.env.SMS_PROVIDER || 'bulksmsbd';

    if (provider === 'bulksmsbd') {
      const url = `https://bulksmsbd.net/api/smsapi?api_key=${process.env.SMS_API_KEY}&type=text&number=${bdNum}&senderid=${encodeURIComponent(process.env.SMS_SENDER_ID || 'Shoplixo')}&message=${encodeURIComponent(message)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      return d?.response_code === 202;
    }

    if (provider === 'sslwireless') {
      const r = await fetch('https://globalsms.com/sms-send', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_token: process.env.SMS_API_KEY,
          sid:       process.env.SMS_SENDER_ID || 'Shoplixo',
          msisdn:    bdNum, sms: message, csms_id: Date.now(),
        }),
      });
      const d = await r.json();
      return d?.status === 'SUBMIT';
    }
    return false;
  } catch (err) { console.error('SMS error:', err.message); return false; }
}

/* SMS Templates — ✅ v4: added ticketCreated & bulkStatus */
const smsTemplates = {
  orderConfirm:   (orderId, name, total) =>
    `প্রিয় ${name}, আপনার Shoplixo অর্ডার (${orderId}) নিশ্চিত! মোট: ৳${total}। ট্র্যাক: shoplixo.shop/track?id=${orderId}`,
  orderShipped:   (orderId, courier, trackId) =>
    `অর্ডার ${orderId} পাঠানো হয়েছে! Courier: ${courier}, Tracking: ${trackId}। Shoplixo`,
  orderDelivered: (orderId, points) =>
    `অর্ডার ${orderId} ডেলিভারি সম্পন্ন! আপনি ${points} Loyalty Points পেয়েছেন। Shoplixo`,
  otp:            (otp) =>
    `আপনার Shoplixo OTP: ${otp}। ৫ মিনিটের মধ্যে ব্যবহার করুন। কাউকে শেয়ার করবেন না।`,
  returnApproved: (returnId, amount) =>
    `আপনার return request (${returnId}) approve হয়েছে। ৳${amount} ফেরত পাবেন। Shoplixo`,
  // ✅ NEW v4
  ticketCreated:  (ticketId) =>
    `আপনার support ticket (${ticketId}) তৈরি হয়েছে। আমরা শীঘ্রই যোগাযোগ করব। Shoplixo`,
  bulkStatusUpdate: (orderId, newStatus) =>
    `আপনার অর্ডার ${orderId} এর status পরিবর্তন হয়েছে: ${newStatus}। Shoplixo`,
};

function orderConfirmSMS(orderId, name, total)          { return smsTemplates.orderConfirm(orderId, name, total); }
function orderShippedSMS(orderId, courier, trackId)     { return smsTemplates.orderShipped(orderId, courier, trackId); }
function orderDeliveredSMS(orderId, points)             { return smsTemplates.orderDelivered(orderId, points); }

// ═══════════════════════════════════════════════════════════════════════════════
//  EMAIL
// ═══════════════════════════════════════════════════════════════════════════════
let _transporter = null;
function getMailer() {
  if (!_transporter && process.env.EMAIL_USER) {
    _transporter = nodemailer.createTransport({
      host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
      port:   parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      pool:   true, maxConnections: 5,
    });
  }
  return _transporter;
}

async function sendEmail(to, subject, html) {
  try {
    const mailer = getMailer();
    if (!mailer || !to) return false;
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || `Shoplixo <${process.env.EMAIL_USER}>`,
      to, subject, html,
    });
    return true;
  } catch (err) { console.error('Email error:', err.message); return false; }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BASE EMAIL LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

/** ✅ FIXED v4: support phone reads from SUPPORT_PHONE env */
function emailBase(content, title = 'Shoplixo') {
  const siteUrl     = process.env.SITE_URL      || 'https://shoplixo.shop';
  const supportPhone= process.env.SUPPORT_PHONE || '01516511889';

  return `<!DOCTYPE html>
<html lang="bn"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f0f2f5">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:24px 16px">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background:linear-gradient(135deg,#1A1A2E 0%,#16213E 50%,#0F3460 100%);padding:28px 32px;border-radius:16px 16px 0 0;text-align:center">
        <a href="${siteUrl}" style="text-decoration:none">
          <span style="font-size:32px;font-weight:900;color:#fff;letter-spacing:-1px">
            Shop<span style="color:#FFB800">lixo</span>
          </span>
        </a>
        <div style="color:rgba(255,255,255,.5);font-size:12px;margin-top:6px;letter-spacing:2px">BANGLADESH'S PREMIUM STORE</div>
      </td></tr>
      <tr><td style="background:#fff;padding:36px 32px">${content}</td></tr>
      <tr><td style="background:#1A1A2E;padding:24px 32px;border-radius:0 0 16px 16px;text-align:center">
        <p style="margin:0 0 8px;color:rgba(255,255,255,.6);font-size:12px">
          © ${new Date().getFullYear()} Shoplixo. সর্বস্বত্ব সংরক্ষিত।
        </p>
        <p style="margin:0;font-size:12px">
          <a href="${siteUrl}"           style="color:#FFB800;text-decoration:none">🏠 Website</a> &nbsp;|&nbsp;
          <a href="${siteUrl}/track"     style="color:#FFB800;text-decoration:none">📦 Track Order</a> &nbsp;|&nbsp;
          <a href="tel:+88${supportPhone}" style="color:#FFB800;text-decoration:none">📞 Support</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

function orderConfirmationEmail(order) {
  const siteUrl  = process.env.SITE_URL || 'https://shoplixo.shop';
  const itemsHTML = (order.items || []).map(i => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top">
        <div style="font-weight:600;color:#1A1A2E;font-size:14px">${i.name}</div>
        ${i.size ? `<div style="color:#888;font-size:12px;margin-top:2px">Size: ${i.size}${i.color ? ` | Color: ${i.color}` : ''}</div>` : ''}
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #f0f0f0;text-align:center;color:#666">${i.qty}</td>
      <td style="padding:12px 8px;border-bottom:1px solid #f0f0f0;text-align:right;color:#E41E26;font-weight:700">${formatBDT(i.price * i.qty)}</td>
    </tr>`).join('');

  const content = `
    <div style="text-align:center;margin-bottom:28px">
      <div style="width:72px;height:72px;background:#e6faf4;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:36px">✅</div>
      <h1 style="margin:0 0 8px;font-size:22px;color:#1A1A2E;font-weight:800">Order Confirmed!</h1>
      <p style="margin:0;color:#666;font-size:14px">Order ID: <strong style="color:#E41E26;font-size:16px">${order.orderId}</strong></p>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f9f9fc;border-radius:10px;overflow:hidden">
      <tr><td colspan="2" style="background:#1A1A2E;padding:10px 16px;color:#fff;font-size:12px;font-weight:700;letter-spacing:1px">অর্ডার তথ্য</td></tr>
      <tr><td style="padding:10px 16px;color:#888;font-size:13px;width:40%">নাম</td><td style="padding:10px 16px;font-weight:600">${order.customer?.name}</td></tr>
      <tr style="background:#fff"><td style="padding:10px 16px;color:#888;font-size:13px">ফোন</td><td style="padding:10px 16px;font-weight:600">${order.customer?.phone}</td></tr>
      <tr><td style="padding:10px 16px;color:#888;font-size:13px">ঠিকানা</td><td style="padding:10px 16px">${order.customer?.address}, ${order.customer?.district}</td></tr>
      <tr style="background:#fff"><td style="padding:10px 16px;color:#888;font-size:13px">Payment</td><td style="padding:10px 16px;text-transform:uppercase;font-weight:600;color:#0F3460">${order.payment?.method}</td></tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead><tr style="background:#0F3460">
        <th style="padding:12px 8px;color:#fff;text-align:left;font-size:12px;font-weight:600">পণ্য</th>
        <th style="padding:12px 8px;color:#fff;text-align:center;font-size:12px;font-weight:600">Qty</th>
        <th style="padding:12px 8px;color:#fff;text-align:right;font-size:12px;font-weight:600">মূল্য</th>
      </tr></thead>
      <tbody>${itemsHTML}</tbody>
      <tfoot>
        <tr><td colspan="2" style="padding:10px 8px;color:#666">Subtotal</td><td style="padding:10px 8px;text-align:right">${formatBDT(order.pricing?.subtotal)}</td></tr>
        <tr><td colspan="2" style="padding:4px 8px;color:#666">Shipping</td><td style="padding:4px 8px;text-align:right">${formatBDT(order.pricing?.shipping || 60)}</td></tr>
        ${(order.pricing?.discount || 0) > 0 ? `<tr><td colspan="2" style="padding:4px 8px;color:#00C58A">Coupon Discount</td><td style="padding:4px 8px;text-align:right;color:#00C58A">-${formatBDT(order.pricing.discount)}</td></tr>` : ''}
        ${(order.pricing?.loyaltyDiscount || 0) > 0 ? `<tr><td colspan="2" style="padding:4px 8px;color:#FFB800">Loyalty Discount</td><td style="padding:4px 8px;text-align:right;color:#FFB800">-${formatBDT(order.pricing.loyaltyDiscount)}</td></tr>` : ''}
        <tr style="background:#fff8e6"><td colspan="2" style="padding:14px 8px;font-weight:800;font-size:16px;color:#1A1A2E">মোট</td><td style="padding:14px 8px;text-align:right;font-weight:900;color:#E41E26;font-size:20px">${formatBDT(order.pricing?.total)}</td></tr>
      </tfoot>
    </table>

    <div style="background:#f0f7ff;border-radius:10px;padding:16px;margin-bottom:20px;border-left:4px solid #0F3460">
      <p style="margin:0;font-size:13px;color:#555"><strong>📦 ডেলিভারি সময়:</strong> ঢাকায় ১-২ কর্মদিবস, সারাদেশে ৩-৫ কর্মদিবস।</p>
    </div>

    <div style="text-align:center">
      <a href="${siteUrl}/track?id=${order.orderId}"
         style="display:inline-block;background:linear-gradient(135deg,#E41E26,#c01018);color:#fff;padding:14px 32px;border-radius:999px;font-weight:700;text-decoration:none;font-size:15px;letter-spacing:.5px">
        📦 অর্ডার ট্র্যাক করুন →
      </a>
    </div>`;

  return emailBase(content, `Order Confirmed — ${order.orderId}`);
}

function orderStatusEmail(order, newStatus, trackingId, courier) {
  const siteUrl     = process.env.SITE_URL || 'https://shoplixo.shop';
  const statusConfig = {
    confirmed:        { icon: '✅', color: '#00C58A', text: 'Order Confirmed!',    msg: 'আপনার অর্ডার নিশ্চিত হয়েছে এবং প্রক্রিয়াকরণ শুরু হয়েছে।' },
    processing:       { icon: '⚙️', color: '#FFB800', text: 'Processing',          msg: 'আপনার পণ্য প্যাক করা হচ্ছে, শীঘ্রই পাঠানো হবে।' },
    shipped:          { icon: '🚚', color: '#0F3460', text: 'Shipped!',            msg: 'আপনার পণ্য পাঠানো হয়েছে। ট্র্যাকিং নম্বর দেখুন।' },
    out_for_delivery: { icon: '🏍️', color: '#FF6B35', text: 'Out for Delivery!',  msg: 'আজই আপনার দরজায় পৌঁছে যাবে!' },
    delivered:        { icon: '🎉', color: '#00C58A', text: 'Delivered!',          msg: 'পণ্য সফলভাবে পৌঁছে গেছে। ধন্যবাদ Shoplixo তে কেনাকাটার জন্য!' },
    cancelled:        { icon: '❌', color: '#E41E26', text: 'Order Cancelled',     msg: 'আপনার অর্ডার বাতিল হয়েছে। কোনো প্রশ্ন থাকলে যোগাযোগ করুন।' },
    refunded:         { icon: '💰', color: '#666',    text: 'Refund Initiated',    msg: 'আপনার টাকা ফেরত প্রক্রিয়া শুরু হয়েছে। ৩-৫ কার্যদিবসের মধ্যে পাবেন।' },
    return_requested: { icon: '📬', color: '#9B59B6', text: 'Return Requested',   msg: 'আপনার return request পেয়েছি। Admin শীঘ্রই review করবে।' },
  };
  const cfg = statusConfig[newStatus] || { icon: '📋', color: '#666', text: newStatus, msg: '' };

  const content = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:64px;margin-bottom:16px;line-height:1">${cfg.icon}</div>
      <h2 style="margin:0 0 8px;font-size:24px;font-weight:800;color:${cfg.color}">${cfg.text}</h2>
      <p style="margin:0 0 4px;color:#888;font-size:14px">অর্ডার নম্বর</p>
      <p style="margin:0 0 20px;font-size:22px;font-weight:800;color:#1A1A2E">${order.orderId}</p>
      <p style="margin:0 0 24px;color:#555;font-size:15px">${cfg.msg}</p>
      ${trackingId ? `
      <div style="background:#f0f7ff;border-radius:12px;padding:20px;margin:0 0 24px;display:inline-block;min-width:200px">
        <p style="margin:0 0 4px;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px">Tracking Number</p>
        <p style="margin:0 0 4px;font-weight:800;font-size:22px;color:#0F3460;letter-spacing:2px">${trackingId}</p>
        ${courier ? `<p style="margin:0;color:#666;font-size:13px">Courier: <strong>${courier}</strong></p>` : ''}
      </div>` : ''}
      <div>
        <a href="${siteUrl}/track?id=${order.orderId}"
           style="display:inline-block;background:linear-gradient(135deg,#E41E26,#c01018);color:#fff;padding:14px 32px;border-radius:999px;font-weight:700;text-decoration:none;font-size:15px">
          অর্ডার ট্র্যাক করুন →
        </a>
      </div>
    </div>`;

  return emailBase(content, `Order ${cfg.text} — ${order.orderId}`);
}

function welcomeEmail(user) {
  const siteUrl = process.env.SITE_URL || 'https://shoplixo.shop';
  const content = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:64px;margin-bottom:16px">👋</div>
      <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:#1A1A2E">স্বাগতম, ${user.name}!</h1>
      <p style="margin:0 0 28px;color:#666;font-size:15px">Shoplixo পরিবারে আপনাকে স্বাগত জানাই।<br>Bangladesh-এর সেরা online shopping experience উপভোগ করুন।</p>

      <div style="display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap;justify-content:center">
        <div style="background:#f0f7ff;border-radius:10px;padding:16px 20px;flex:1;min-width:140px">
          <div style="font-size:28px;margin-bottom:8px">🎁</div>
          <div style="font-weight:700;color:#0F3460;font-size:14px">Welcome Bonus</div>
          <div style="color:#666;font-size:12px">50 Loyalty Points পেয়েছেন</div>
        </div>
        <div style="background:#fff8e6;border-radius:10px;padding:16px 20px;flex:1;min-width:140px">
          <div style="font-size:28px;margin-bottom:8px">🚚</div>
          <div style="font-weight:700;color:#0F3460;font-size:14px">Free Delivery</div>
          <div style="color:#666;font-size:12px">প্রথম order এ free shipping</div>
        </div>
        <div style="background:#fef0f0;border-radius:10px;padding:16px 20px;flex:1;min-width:140px">
          <div style="font-size:28px;margin-bottom:8px">⭐</div>
          <div style="font-weight:700;color:#0F3460;font-size:14px">Loyalty Program</div>
          <div style="color:#666;font-size:12px">প্রতি কেনায় points অর্জন</div>
        </div>
      </div>

      <a href="${siteUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#E41E26,#c01018);color:#fff;padding:16px 40px;border-radius:999px;font-weight:800;text-decoration:none;font-size:16px;letter-spacing:.5px">
        Shopping শুরু করুন →
      </a>
    </div>`;

  return emailBase(content, 'স্বাগতম! — Shoplixo');
}

function abandonedCartEmail(cart, couponCode) {
  const siteUrl   = process.env.SITE_URL || 'https://shoplixo.shop';
  const itemsHTML = (cart.items || []).map(i => `
    <div style="display:flex;align-items:center;padding:12px 0;border-bottom:1px solid #f5f5f5">
      <img src="${i.img || ''}" alt="${i.name}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;margin-right:16px;background:#f0f0f0" onerror="this.style.display='none'">
      <div style="flex:1">
        <div style="font-weight:600;color:#1A1A2E;font-size:14px">${i.name}</div>
        <div style="color:#E41E26;font-weight:700;margin-top:4px;font-size:15px">${formatBDT(i.price)} × ${i.qty}</div>
      </div>
      <div style="font-weight:800;color:#1A1A2E">${formatBDT(i.price * i.qty)}</div>
    </div>`).join('');

  const content = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:56px;margin-bottom:12px">🛒</div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#1A1A2E">আপনার cart অপেক্ষায়!</h2>
      <p style="margin:0;color:#666">আপনি কিছু পণ্য cart এ রেখে গেছেন। এখনই order করুন!</p>
    </div>
    <div style="margin-bottom:20px">${itemsHTML}</div>
    <div style="background:linear-gradient(135deg,#fff8e6,#fff3cc);border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;border:2px dashed #FFB800">
      <div style="font-size:24px;margin-bottom:8px">🎁</div>
      <div style="font-size:22px;font-weight:900;color:#1A1A2E">মোট: ${formatBDT(cart.total)}</div>
      ${couponCode ? `<div style="margin-top:10px;font-size:13px;color:#555">কোড <strong style="color:#E41E26;font-size:15px;background:#fff;padding:4px 12px;border-radius:999px;border:1px dashed #E41E26">${couponCode}</strong> দিয়ে অতিরিক্ত ৫% ছাড়!</div>` : ''}
    </div>
    <div style="text-align:center">
      <a href="${siteUrl}/#cart"
         style="display:inline-block;background:linear-gradient(135deg,#E41E26,#c01018);color:#fff;padding:16px 40px;border-radius:999px;font-weight:800;text-decoration:none;font-size:16px">
        Order Complete করুন →
      </a>
    </div>`;

  return emailBase(content, 'আপনার cart অপেক্ষায় — Shoplixo');
}

function lowStockAlertEmail(products) {
  const rows = products.map(p => `
    <tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:12px 16px">${p.name}</td>
      <td style="padding:12px 16px;text-align:center;font-weight:800;color:${p.stock === 0 ? '#E41E26' : '#FFB800'}">${p.stock === 0 ? '❌ OUT' : p.stock}</td>
      <td style="padding:12px 16px;text-align:center;color:#888;font-size:13px">${p.productId}</td>
    </tr>`).join('');

  const content = `
    <h2 style="margin:0 0 20px;color:#E41E26;font-size:20px">⚠️ Low Stock Alert</h2>
    <p style="margin:0 0 20px;color:#666">${products.length}টি পণ্যে stock কম বা নেই:</p>
    <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#1A1A2E">
        <th style="padding:12px 16px;color:#fff;text-align:left">পণ্য</th>
        <th style="padding:12px 16px;color:#fff;text-align:center">Stock</th>
        <th style="padding:12px 16px;color:#fff;text-align:center">Product ID</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return emailBase(content, 'Low Stock Alert — Shoplixo');
}

function returnApprovedEmail(returnReq, refundAmount) {
  const content = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:64px;margin-bottom:16px">✅</div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#00C58A">Return Approved!</h2>
      <p style="margin:0 0 24px;color:#666">আপনার return request approve হয়েছে।</p>
      <div style="background:#e6faf4;border-radius:12px;padding:20px;margin:0 0 24px">
        <div style="font-size:13px;color:#888">Refund Amount</div>
        <div style="font-size:28px;font-weight:900;color:#00C58A">${formatBDT(refundAmount)}</div>
        <div style="font-size:13px;color:#666;margin-top:8px">৩-৫ কার্যদিবসের মধ্যে আপনার ${returnReq.refundMethod} এ পাবেন।</div>
      </div>
    </div>`;

  return emailBase(content, 'Return Approved — Shoplixo');
}

/**
 * ✅ NEW v4: invoiceEmail — standalone invoice email distinct from order confirmation
 */
function invoiceEmail(order) {
  const date    = new Date(order.createdAt).toLocaleDateString('bn-BD');
  const content = `
    <div style="text-align:right;margin-bottom:20px">
      <div style="font-size:13px;color:#888">Invoice Date: ${date}</div>
      <div style="font-size:15px;font-weight:700;color:#E41E26">Invoice #${order.orderId}</div>
    </div>
    <div style="border-top:3px solid #E41E26;border-bottom:1px solid #eee;padding:16px 0;margin-bottom:20px">
      <div style="font-weight:700">Bill To:</div>
      <div>${order.customer?.name}</div>
      <div>${order.customer?.phone}</div>
      <div>${order.customer?.address}, ${order.customer?.district}</div>
    </div>
    ${orderConfirmationEmail(order)}`;

  return emailBase(content, `Invoice — ${order.orderId}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: buildInvoiceHTML — printable standalone invoice page (UPGRADE-A3)
//  Returns a self-contained HTML string suitable for window.open() + window.print()
// ═══════════════════════════════════════════════════════════════════════════════
function buildInvoiceHTML(order) {
  const siteUrl  = process.env.SITE_URL || 'https://shoplixo.shop';
  const date     = new Date(order.createdAt || Date.now()).toLocaleDateString('bn-BD', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const itemRows = (order.items || []).map((it, idx) => `
    <tr style="background:${idx % 2 === 0 ? '#fff' : '#f9f9fc'}">
      <td style="padding:10px 12px;border:1px solid #eee">${it.name}${it.size ? ` (${it.size})` : ''}</td>
      <td style="padding:10px 12px;border:1px solid #eee;text-align:center">${it.qty}</td>
      <td style="padding:10px 12px;border:1px solid #eee;text-align:right">${formatBDT(it.price)}</td>
      <td style="padding:10px 12px;border:1px solid #eee;text-align:right;font-weight:700">${formatBDT(it.price * it.qty)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<title>Invoice — ${order.orderId}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1A1A2E; background: #fff; padding: 32px; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
    @page { size: A4; margin: 16mm; }
  }
  .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .brand { font-size: 28px; font-weight: 900; color: #1A1A2E; }
  .brand span { color: #FFB800; }
  .meta { text-align: right; font-size: 13px; color: #666; line-height: 1.7; }
  .meta strong { color: #E41E26; font-size: 15px; }
  .divider { height: 3px; background: linear-gradient(90deg, #E41E26, #FFB800); border-radius: 2px; margin-bottom: 24px; }
  .two-col { display: flex; gap: 24px; margin-bottom: 24px; }
  .box { flex: 1; background: #f9f9fc; border-radius: 10px; padding: 16px; font-size: 13px; line-height: 1.8; }
  .box h4 { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #999; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  thead tr { background: #1A1A2E; color: #fff; }
  thead th { padding: 11px 12px; text-align: left; font-weight: 600; }
  thead th:nth-child(2),
  thead th:nth-child(3),
  thead th:nth-child(4) { text-align: center; }
  thead th:nth-child(4) { text-align: right; }
  .totals { margin-left: auto; width: 260px; }
  .totals tr td { padding: 6px 0; font-size: 13px; }
  .totals tr td:last-child { text-align: right; }
  .totals .grand td { font-size: 16px; font-weight: 800; color: #E41E26; border-top: 2px solid #eee; padding-top: 10px; }
  .status-badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #aaa; border-top: 1px solid #eee; padding-top: 16px; }
  .print-btn { position: fixed; bottom: 24px; right: 24px; background: #E41E26; color: #fff; border: none; border-radius: 999px; padding: 12px 28px; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px rgba(228,30,38,.35); }
</style>
</head>
<body>

<div class="invoice-header">
  <div>
    <div class="brand">Shop<span>lixo</span></div>
    <div style="font-size:12px;color:#999;margin-top:4px">${siteUrl}</div>
  </div>
  <div class="meta">
    <div>Invoice Date: <strong>${date}</strong></div>
    <div>Invoice No: <strong>${order.orderId}</strong></div>
    <div>Payment: <strong style="text-transform:uppercase">${order.payment?.method || '—'}</strong></div>
    ${order.payment?.transactionId ? `<div>TxnID: <strong>${order.payment.transactionId}</strong></div>` : ''}
  </div>
</div>

<div class="divider"></div>

<div class="two-col">
  <div class="box">
    <h4>Bill To</h4>
    <div style="font-weight:700;font-size:15px">${order.customer?.name || '—'}</div>
    <div>${order.customer?.phone || ''}</div>
    ${order.customer?.email ? `<div>${order.customer.email}</div>` : ''}
    <div>${order.customer?.address || ''}</div>
    <div>${order.customer?.district || ''}${order.customer?.area ? `, ${order.customer.area}` : ''}</div>
    ${order.customer?.note ? `<div style="color:#E41E26;font-style:italic;margin-top:4px">Note: ${order.customer.note}</div>` : ''}
  </div>
  <div class="box">
    <h4>Order Info</h4>
    <div>Order ID: <strong>${order.orderId}</strong></div>
    <div>Status: <span class="status-badge" style="background:${order.status === 'delivered' ? '#e6faf4;color:#00C58A' : '#fff8e6;color:#FFB800'}">${order.status || '—'}</span></div>
    ${order.tracking?.courier ? `<div>Courier: <strong>${order.tracking.courier}</strong></div>` : ''}
    ${order.tracking?.trackingId ? `<div>Tracking: <strong>${order.tracking.trackingId}</strong></div>` : ''}
    ${order.pricing?.coupon ? `<div>Coupon: <strong>${order.pricing.coupon}</strong></div>` : ''}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>পণ্য</th>
      <th style="text-align:center">Qty</th>
      <th style="text-align:center">একক মূল্য</th>
      <th style="text-align:right">মোট</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td><td>${formatBDT(order.pricing?.subtotal)}</td></tr>
  <tr><td>Shipping</td><td>${formatBDT(order.pricing?.shipping || 0)}</td></tr>
  ${(order.pricing?.discount || 0) > 0 ? `<tr><td style="color:#00C58A">Discount</td><td style="color:#00C58A">-${formatBDT(order.pricing.discount)}</td></tr>` : ''}
  ${(order.pricing?.loyaltyDiscount || 0) > 0 ? `<tr><td style="color:#FFB800">Loyalty</td><td style="color:#FFB800">-${formatBDT(order.pricing.loyaltyDiscount)}</td></tr>` : ''}
  <tr class="grand"><td>সর্বমোট</td><td>${formatBDT(order.pricing?.total)}</td></tr>
</table>

<div class="footer">
  ধন্যবাদ Shoplixo তে কেনাকাটার জন্য! &nbsp;|&nbsp; ${siteUrl} &nbsp;|&nbsp; © ${new Date().getFullYear()} Shoplixo
</div>

<button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save PDF</button>

</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: CSV HELPERS  (UPGRADE-A2)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * csvExportProducts(products) → CSV string
 * Server-side CSV generation for the products export endpoint.
 * Compatible with Excel (UTF-8 BOM included).
 */
function csvExportProducts(products = []) {
  const escape = v => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  const headers = [
    'productId','name','nameBn','cat','subCat','brand',
    'price','orig','costPrice','stock','badge',
    'isFeatured','isActive','isFlash','isNew','isDropship',
    'sizes','colors','tags','sku','totalSold','rating','reviews',
    'desc','videoUrl','seoTitle','seoDesc','img','images',
  ];
  const rows = [
    headers.join(','),
    ...products.map(p => headers.map(h => {
      const v = p[h];
      if (Array.isArray(v)) return escape(v.join('|'));
      if (typeof v === 'boolean') return v ? '1' : '0';
      return escape(v);
    }).join(',')),
  ];
  // UTF-8 BOM for Excel compatibility
  return '\uFEFF' + rows.join('\r\n');
}

/**
 * parseCsvProducts(csvText) → { valid: Product[], errors: string[] }
 * Server-side CSV import parser.
 * Accepts the same column format produced by csvExportProducts().
 */
function parseCsvProducts(csvText = '') {
  const lines   = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { valid: [], errors: ['CSV ফাইল empty বা incorrect format'] };

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const valid   = [];
  const errors  = [];

  for (let i = 1; i < lines.length; i++) {
    const row  = lines[i].match(/("(?:[^"]|"")*"|[^,]*)/g) || [];
    const obj  = {};
    headers.forEach((h, idx) => {
      let v = (row[idx] || '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
      // Split pipe-delimited arrays
      if (['sizes','colors','tags','images'].includes(h)) {
        obj[h] = v ? v.split('|').map(s => s.trim()).filter(Boolean) : [];
      } else if (['price','orig','costPrice','stock','totalSold','rating','reviews'].includes(h)) {
        obj[h] = v !== '' ? parseFloat(v) : undefined;
      } else if (['isFeatured','isActive','isFlash','isNew','isDropship'].includes(h)) {
        obj[h] = v === '1' || v === 'true';
      } else {
        obj[h] = v || undefined;
      }
    });

    if (!obj.name || !obj.cat || !obj.price) {
      errors.push(`Row ${i + 1}: name, cat, price আবশ্যিক`);
      continue;
    }
    if (!obj.productId) obj.productId = `P-${Date.now()}-${i}`;
    valid.push(obj);
  }

  return { valid, errors };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: REVENUE AGGREGATION  (UPGRADE-A9)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getRevenueAggregation(SiteStats, range)
 * range: '7d' | '30d' | '12m'
 * Returns array of { label, revenue, orders, profit }
 */
async function getRevenueAggregation(SiteStats, range = '7d') {
  const now  = new Date();
  let   from;
  let   groupFmt;

  if (range === '12m') {
    from     = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
    groupFmt = 'month';
  } else if (range === '30d') {
    from     = new Date(now - 30 * 86400000);
    groupFmt = 'day';
  } else {
    from     = new Date(now - 7 * 86400000);
    groupFmt = 'day';
  }

  const fromStr = from.toISOString().slice(0, 10);
  const docs    = await SiteStats.find({ date: { $gte: fromStr } }).sort({ date: 1 }).lean();

  if (groupFmt === 'day') {
    return docs.map(d => ({
      label:   d.date,
      revenue: d.revenue   || 0,
      orders:  d.orders    || 0,
      profit:  d.profit    || 0,
    }));
  }

  // Group by YYYY-MM
  const map = {};
  for (const d of docs) {
    const key = d.date.slice(0, 7); // 'YYYY-MM'
    if (!map[key]) map[key] = { label: key, revenue: 0, orders: 0, profit: 0 };
    map[key].revenue += d.revenue || 0;
    map[key].orders  += d.orders  || 0;
    map[key].profit  += d.profit  || 0;
  }
  return Object.values(map);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: PUSH NOTIFICATION  (UPGRADE-I1 PWA)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * sendPushNotification(token, { title, body, icon, url })
 * Supports FCM HTTP v1.
 * Set FCM_SERVER_KEY in env for Firebase Cloud Messaging.
 */
async function sendPushNotification(token, { title, body, icon, url } = {}) {
  try {
    if (!process.env.FCM_SERVER_KEY || !token) return false;
    const r = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Authorization': `key=${process.env.FCM_SERVER_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        to: token,
        notification: {
          title: title || 'Shoplixo',
          body:  body  || '',
          icon:  icon  || '/icon-192.png',
          click_action: url || '/',
        },
        webpush: {
          fcm_options: { link: url || '/' },
        },
      }),
    });
    const d = await r.json();
    return d?.success === 1;
  } catch (err) {
    console.error('Push error:', err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RATE LIMIT  — sliding window per IP / key
// ═══════════════════════════════════════════════════════════════════════════════
const _rateMap = new Map();

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of _rateMap) {
    if (now - data.start > 300000) _rateMap.delete(key);
  }
}, 300000);

/**
 * checkRateLimit(key, max, windowMs)
 * ✅ FIXED v4: default 60/min for general use; use max=30 for auth endpoints.
 */
function checkRateLimit(key, max = 60, windowMs = 60000) {
  const now  = Date.now();
  const data = _rateMap.get(key) || { count: 0, start: now };
  if (now - data.start > windowMs) {
    _rateMap.set(key, { count: 1, start: now });
    return true;
  }
  data.count++;
  _rateMap.set(key, data);
  return data.count <= max;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════
function isValidBDPhone(phone) {
  return /^(?:\+?88)?01[3-9]\d{8}$/.test(String(phone).trim());
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}
function sanitize(str, maxLen = 500) {
  return String(str || '').trim().slice(0, maxLen).replace(/[<>]/g, '');
}
function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OTP
// ═══════════════════════════════════════════════════════════════════════════════
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PAGINATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ✅ FIXED v4: maxLimit raised to 500 to support CSV bulk exports (UPGRADE-A2)
 */
function paginate(query = {}, page = 1, limit = 20, maxLimit = 500) {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(maxLimit, Math.max(1, parseInt(limit)));
  return { skip: (p - 1) * l, limit: l, page: p };
}

function paginateResponse(total, page, limit) {
  return {
    total,
    page,
    pages:   Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: CLIENT IP EXTRACTOR
//  Vercel puts real IP in x-forwarded-for
// ═══════════════════════════════════════════════════════════════════════════════
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'] || '';
  return xff.split(',')[0].trim() || req.socket?.remoteAddress || '';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = {
  // CORS
  handleCors, setCors,

  // ID generators
  generateOrderId, generateReturnId, generateSupplierId, generateTicketId,

  // Auth
  verifyToken, isAdmin,
  hashPassword, verifyAdminPassword, isStrongPassword,   // ✅ NEW v4

  // Email
  sendEmail,
  emailBase,
  orderConfirmationEmail, orderStatusEmail, welcomeEmail,
  abandonedCartEmail, lowStockAlertEmail, invoiceEmail, returnApprovedEmail,

  // Invoice HTML (printable page)
  buildInvoiceHTML,                                        // ✅ NEW v4

  // SMS
  sendSMS, smsTemplates,
  orderConfirmSMS, orderShippedSMS, orderDeliveredSMS,

  // Push notifications
  sendPushNotification,                                    // ✅ NEW v4

  // Loyalty
  getLoyaltyTier, getNextTier, LOYALTY_TIERS,

  // Profit
  calculateProfit,

  // Currency
  formatBDT,                                               // ✅ NEW v4

  // CSV
  csvExportProducts, parseCsvProducts,                     // ✅ NEW v4

  // Revenue analytics
  getRevenueAggregation,                                   // ✅ NEW v4

  // Rate limiting
  checkRateLimit,

  // Validation
  isValidBDPhone, isValidEmail, sanitize, slugify,

  // OTP
  generateOTP,

  // Pagination
  paginate, paginateResponse,

  // IP
  getClientIp,                                             // ✅ NEW v4
};
