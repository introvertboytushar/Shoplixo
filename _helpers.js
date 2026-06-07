/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — Shared Helper Utilities v2
 *  নতুন: SMS notifications, Order status email, Stock alert email
 * ══════════════════════════════════════════════════════════════
 */

const nodemailer = require('nodemailer');
const jwt        = require('jsonwebtoken');

/* ================================================================
   CORS
================================================================ */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Key,X-Requested-With');
}
function handleCors(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

/* ================================================================
   ORDER ID GENERATOR — SL-XXXXXX format
================================================================ */
function generateOrderId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `SL-${suffix}`;
}

/* ================================================================
   JWT
================================================================ */
function verifyToken(req) {
  try {
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    if (!token) return null;
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch { return null; }
}

/* ================================================================
   ADMIN AUTH
================================================================ */
function isAdmin(req) {
  const key = req.headers['x-admin-key'] || req.query?.key || '';
  return key === process.env.ADMIN_PASSWORD || key === process.env.ADMIN_SECRET;
}

/* ================================================================
   SMS — BulkSMSBD / SSL Wireless (BD gateway)
   .env: SMS_API_KEY, SMS_SENDER_ID
================================================================ */
async function sendSMS(phone, message) {
  try {
    if (!process.env.SMS_API_KEY) return false;

    // Normalize BD phone number
    let num = String(phone).replace(/\D/g, '');
    if (num.startsWith('880')) num = num.slice(3);
    if (num.startsWith('0'))   num = num.slice(1);
    const bdNum = `880${num}`;

    const provider = process.env.SMS_PROVIDER || 'bulksmsbd';

    if (provider === 'bulksmsbd') {
      const url = `https://bulksmsbd.net/api/smsapi?api_key=${process.env.SMS_API_KEY}&type=text&number=${bdNum}&senderid=${encodeURIComponent(process.env.SMS_SENDER_ID || 'Shoplixo')}&message=${encodeURIComponent(message)}`;
      const r = await fetch(url);
      const d = await r.json();
      return d?.response_code === 202;
    }

    if (provider === 'sslwireless') {
      const r = await fetch('https://globalsms.com/sms-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_token: process.env.SMS_API_KEY,
          sid: process.env.SMS_SENDER_ID || 'Shoplixo',
          msisdn: bdNum,
          sms: message,
          csms_id: Date.now(),
        }),
      });
      const d = await r.json();
      return d?.status === 'SUBMIT';
    }

    return false;
  } catch (err) {
    console.error('SMS error:', err.message);
    return false;
  }
}

/* SMS Templates */
function orderConfirmSMS(orderId, name, total) {
  return `প্রিয় ${name}, আপনার Shoplixo অর্ডার (${orderId}) নিশ্চিত হয়েছে! মোট: ৳${total}। ট্র্যাক করুন: shoplixo.shop/track?id=${orderId}`;
}
function orderShippedSMS(orderId, courier, trackId) {
  return `আপনার অর্ডার ${orderId} পাঠানো হয়েছে! Courier: ${courier}, Tracking: ${trackId}। ধন্যবাদ Shoplixo`;
}
function orderDeliveredSMS(orderId, points) {
  return `অর্ডার ${orderId} ডেলিভারি সম্পন্ন! আপনি ${points} Loyalty Points অর্জন করেছেন। আবার কিনুন: shoplixo.shop`;
}

/* ================================================================
   EMAIL — nodemailer
================================================================ */
let _transporter = null;
function getMailer() {
  if (!_transporter && process.env.EMAIL_USER) {
    _transporter = nodemailer.createTransport({
      host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
      port:   parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
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

/* ================================================================
   EMAIL TEMPLATES
================================================================ */

/* 1. Order Confirmation */
function orderConfirmationEmail(order) {
  const itemsHTML = (order.items || []).map(i => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #f0f0f0">${i.name}${i.size ? ` (${i.size})` : ''}${i.color ? ` - ${i.color}` : ''}</td>
      <td style="padding:10px;border-bottom:1px solid #f0f0f0;text-align:center">${i.qty}</td>
      <td style="padding:10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#E41E26;font-weight:700">৳${Number(i.price * i.qty).toLocaleString()}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f7fc">
  <div style="background:linear-gradient(135deg,#1A1A2E,#2D1B6E);padding:32px;text-align:center">
    <div style="font-size:28px;font-weight:800;color:#fff">Shop<span style="color:#FFB800">lixo</span></div>
    <div style="color:rgba(255,255,255,.6);font-size:13px;margin-top:4px">Bangladesh's #1 Online Store</div>
  </div>
  <div style="background:#fff;padding:32px">
    <div style="background:#e6faf4;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center">
      <div style="font-size:36px;margin-bottom:8px">🎉</div>
      <div style="font-size:20px;font-weight:700;color:#00C58A">Order Confirmed!</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:8px 0;color:#888;font-size:13px">Order ID</td>
          <td style="padding:8px 0;font-weight:700;color:#E41E26">${order.orderId}</td></tr>
      <tr><td style="padding:8px 0;color:#888;font-size:13px">নাম</td>
          <td style="padding:8px 0;font-weight:600">${order.customer?.name || ''}</td></tr>
      <tr><td style="padding:8px 0;color:#888;font-size:13px">ফোন</td>
          <td style="padding:8px 0;font-weight:600">${order.customer?.phone || ''}</td></tr>
      <tr><td style="padding:8px 0;color:#888;font-size:13px">ঠিকানা</td>
          <td style="padding:8px 0">${order.customer?.address || ''}, ${order.customer?.district || ''}</td></tr>
      <tr><td style="padding:8px 0;color:#888;font-size:13px">Payment</td>
          <td style="padding:8px 0;text-transform:uppercase;font-weight:600">${order.payment?.method || ''}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#1A1A2E">
        <th style="padding:12px;color:#fff;text-align:left;font-size:12px">পণ্য</th>
        <th style="padding:12px;color:#fff;text-align:center;font-size:12px">Qty</th>
        <th style="padding:12px;color:#fff;text-align:right;font-size:12px">মূল্য</th>
      </tr></thead>
      <tbody>${itemsHTML}</tbody>
      <tfoot>
        ${order.pricing?.discount > 0 ? `<tr><td colspan="2" style="padding:8px 12px;color:#00C58A">Coupon Discount</td><td style="padding:8px 12px;color:#00C58A;text-align:right">-৳${Number(order.pricing.discount).toLocaleString()}</td></tr>` : ''}
        <tr style="background:#fff8e6">
          <td colspan="2" style="padding:12px;font-weight:700;font-size:16px">মোট</td>
          <td style="padding:12px;font-weight:800;color:#E41E26;font-size:18px;text-align:right">৳${Number(order.pricing?.total || 0).toLocaleString()}</td>
        </tr>
      </tfoot>
    </table>
    <div style="margin-top:24px;background:#fff0f0;border-radius:8px;padding:16px;font-size:13px;color:#666">
      <strong style="color:#E41E26">📦 ডেলিভারি:</strong> ঢাকায় ২৪ ঘণ্টা, সারাদেশে ২-৩ কর্মদিবস।
    </div>
    <div style="margin-top:16px;text-align:center">
      <a href="${process.env.SITE_URL || 'https://shoplixo.shop'}/track?id=${order.orderId}"
         style="display:inline-block;background:#1A1A2E;color:#fff;padding:12px 28px;border-radius:999px;font-weight:700;text-decoration:none;font-size:14px">
        📦 অর্ডার ট্র্যাক করুন
      </a>
    </div>
  </div>
  <div style="background:#f7f7fc;padding:20px;text-align:center;font-size:12px;color:#aaa">
    © ${new Date().getFullYear()} Shoplixo. All rights reserved. | shoplixo.shop
  </div>
</body></html>`;
}

/* 2. Order Status Update Email */
function orderStatusEmail(order, newStatus, trackingId, courier) {
  const statusConfig = {
    confirmed:         { icon: '✅', color: '#00C58A', text: 'Order Confirmed',   msg: 'আপনার অর্ডার নিশ্চিত হয়েছে এবং প্রক্রিয়াকরণ শুরু হয়েছে।' },
    processing:        { icon: '⚙️', color: '#FFB800', text: 'Processing',        msg: 'আপনার পণ্য প্যাক করা হচ্ছে।' },
    shipped:           { icon: '🚚', color: '#1A1A2E', text: 'Shipped',           msg: 'আপনার পণ্য পাঠানো হয়েছে।' },
    out_for_delivery:  { icon: '📦', color: '#E41E26', text: 'Out for Delivery',  msg: 'আজ আপনার পণ্য পৌঁছে যাবে!' },
    delivered:         { icon: '🎉', color: '#00C58A', text: 'Delivered',         msg: 'পণ্য সফলভাবে পৌঁছে গেছে। ধন্যবাদ!' },
    cancelled:         { icon: '❌', color: '#E41E26', text: 'Cancelled',         msg: 'আপনার অর্ডার বাতিল হয়েছে।' },
    refunded:          { icon: '💰', color: '#666',    text: 'Refunded',          msg: 'আপনার টাকা ফেরত প্রক্রিয়া শুরু হয়েছে।' },
  };
  const cfg = statusConfig[newStatus] || { icon: '📋', color: '#666', text: newStatus, msg: '' };

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f7fc">
  <div style="background:linear-gradient(135deg,#1A1A2E,#2D1B6E);padding:32px;text-align:center">
    <div style="font-size:28px;font-weight:800;color:#fff">Shop<span style="color:#FFB800">lixo</span></div>
  </div>
  <div style="background:#fff;padding:32px;text-align:center">
    <div style="font-size:48px;margin-bottom:12px">${cfg.icon}</div>
    <h2 style="color:${cfg.color};margin-bottom:8px">${cfg.text}</h2>
    <p style="color:#555;font-size:15px">অর্ডার #<strong>${order.orderId}</strong></p>
    <p style="color:#666">${cfg.msg}</p>
    ${trackingId ? `
    <div style="background:#f0f7ff;border-radius:8px;padding:16px;margin:20px 0">
      <p style="margin:0 0 4px;color:#888;font-size:12px">Tracking Number</p>
      <p style="margin:0;font-weight:700;font-size:18px;color:#1A1A2E">${trackingId}</p>
      ${courier ? `<p style="margin:4px 0 0;color:#666;font-size:13px">Courier: ${courier}</p>` : ''}
    </div>` : ''}
    <a href="${process.env.SITE_URL || 'https://shoplixo.shop'}/track?id=${order.orderId}"
       style="display:inline-block;margin-top:20px;background:#E41E26;color:#fff;padding:12px 28px;border-radius:999px;font-weight:700;text-decoration:none">
      অর্ডার ট্র্যাক করুন →
    </a>
  </div>
</body></html>`;
}

/* 3. Welcome Email */
function welcomeEmail(user) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#1A1A2E,#2D1B6E);padding:32px;text-align:center">
    <div style="font-size:28px;font-weight:800;color:#fff">Shop<span style="color:#FFB800">lixo</span></div>
  </div>
  <div style="background:#fff;padding:32px;text-align:center">
    <div style="font-size:40px;margin-bottom:12px">👋</div>
    <h2 style="color:#1A1A2E;margin-bottom:8px">স্বাগতম, ${user.name}!</h2>
    <p style="color:#666">Shoplixo account সফলভাবে তৈরি হয়েছে।</p>
    <a href="${process.env.SITE_URL || 'https://shoplixo.shop'}"
       style="display:inline-block;margin-top:24px;background:#E41E26;color:#fff;padding:12px 32px;border-radius:999px;font-weight:700;text-decoration:none">
      Shopping শুরু করুন →
    </a>
  </div>
</body></html>`;
}

/* 4. Abandoned Cart Reminder Email */
function abandonedCartEmail(cart, couponCode) {
  const itemsHTML = (cart.items || []).map(i => `
    <div style="display:flex;align-items:center;padding:12px 0;border-bottom:1px solid #f0f0f0">
      <img src="${i.img || ''}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;margin-right:12px" onerror="this.style.display='none'">
      <div style="flex:1">
        <div style="font-weight:600;color:#1A1A2E">${i.name}</div>
        <div style="color:#E41E26;font-weight:700;margin-top:4px">৳${Number(i.price).toLocaleString()} × ${i.qty}</div>
      </div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f7fc">
  <div style="background:linear-gradient(135deg,#1A1A2E,#2D1B6E);padding:32px;text-align:center">
    <div style="font-size:28px;font-weight:800;color:#fff">Shop<span style="color:#FFB800">lixo</span></div>
  </div>
  <div style="background:#fff;padding:32px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px">🛒</div>
      <h2 style="color:#1A1A2E;margin:12px 0 8px">আপনার cart অপেক্ষায় আছে!</h2>
      <p style="color:#666">আপনি কিছু পণ্য cart এ রেখে গেছেন। এখনই complete করুন!</p>
    </div>
    <div>${itemsHTML}</div>
    <div style="background:#fff8e6;border-radius:8px;padding:16px;margin:20px 0;text-align:center">
      <p style="margin:0 0 8px;color:#666;font-size:13px">মোট: <strong style="color:#E41E26;font-size:18px">৳${Number(cart.total || 0).toLocaleString()}</strong></p>
      ${couponCode ? `<p style="margin:0;font-size:13px;color:#00C58A">🎁 বিশেষ অফার: কোড <strong>${couponCode}</strong> ব্যবহার করুন — অতিরিক্ত ৫% ছাড়!</p>` : ''}
    </div>
    <div style="text-align:center">
      <a href="${process.env.SITE_URL || 'https://shoplixo.shop'}/#cart"
         style="display:inline-block;background:#E41E26;color:#fff;padding:14px 36px;border-radius:999px;font-weight:700;text-decoration:none;font-size:16px">
        অর্ডার Complete করুন →
      </a>
    </div>
  </div>
</body></html>`;
}

/* 5. Low Stock Alert (for admin) */
function lowStockAlertEmail(products) {
  const rows = products.map(p => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #f0f0f0">${p.name}</td>
      <td style="padding:10px;border-bottom:1px solid #f0f0f0;text-align:center;color:${p.stock === 0 ? '#E41E26' : '#FFB800'};font-weight:700">${p.stock === 0 ? 'Out of Stock' : p.stock}</td>
      <td style="padding:10px;border-bottom:1px solid #f0f0f0;text-align:center;color:#888">${p.productId}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#E41E26;padding:24px;text-align:center">
    <div style="font-size:24px;font-weight:800;color:#fff">⚠️ Shoplixo — Stock Alert</div>
  </div>
  <div style="background:#fff;padding:24px">
    <p style="color:#666">নিচের পণ্যগুলো কম stock বা out of stock:</p>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:10px;text-align:left">পণ্য</th>
        <th style="padding:10px;text-align:center">Stock</th>
        <th style="padding:10px;text-align:center">ID</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body></html>`;
}

/* ================================================================
   RATE LIMIT
================================================================ */
const _rateMap = new Map();
function checkRateLimit(ip, max = 20, windowMs = 60000) {
  const now  = Date.now();
  const data = _rateMap.get(ip) || { count: 0, start: now };
  if (now - data.start > windowMs) { _rateMap.set(ip, { count: 1, start: now }); return true; }
  data.count++;
  _rateMap.set(ip, data);
  return data.count <= max;
}

/* ================================================================
   VALIDATION
================================================================ */
function isValidBDPhone(phone) { return /^(?:\+?88)?01[3-9]\d{8}$/.test(String(phone).trim()); }
function isValidEmail(email)   { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()); }
function sanitize(str, maxLen = 500) { return String(str || '').trim().slice(0, maxLen).replace(/[<>]/g, ''); }

/* ================================================================
   EXPORT
================================================================ */
module.exports = {
  handleCors, setCors,
  generateOrderId, verifyToken, isAdmin,
  sendEmail, sendSMS,
  orderConfirmationEmail, orderStatusEmail, welcomeEmail,
  abandonedCartEmail, lowStockAlertEmail,
  orderConfirmSMS, orderShippedSMS, orderDeliveredSMS,
  checkRateLimit, isValidBDPhone, isValidEmail, sanitize,
};
