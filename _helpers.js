/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — Shared Helper Utilities
 *  সব API file এই helpers ব্যবহার করে
 * ══════════════════════════════════════════════════════════════
 */

const nodemailer = require('nodemailer');
const jwt        = require('jsonwebtoken');

/* ================================================================
   CORS — সব API response-এ এই headers লাগে
================================================================ */
function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Key,X-Requested-With');
}

function handleCors(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true; // caller should return
    }
    return false;
}

/* ================================================================
   ORDER ID GENERATOR — SL-XXXXXX format
================================================================ */
function generateOrderId() {
    const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    return `SL-${suffix}`;
}

/* ================================================================
   JWT — token verify করা
================================================================ */
function verifyToken(req) {
    try {
        const auth  = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
        if (!token) return null;
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return null;
    }
}

/* ================================================================
   ADMIN AUTH — x-admin-key header check করা
================================================================ */
function isAdmin(req) {
    const key = req.headers['x-admin-key'] || req.query?.key || '';
    return key === process.env.ADMIN_PASSWORD || key === process.env.ADMIN_SECRET;
}

/* ================================================================
   EMAIL — nodemailer transporter
================================================================ */
let _transporter = null;
function getMailer() {
    if (!_transporter && process.env.EMAIL_USER) {
        _transporter = nodemailer.createTransport({
            host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
            port:   parseInt(process.env.EMAIL_PORT || '587'),
            secure: process.env.EMAIL_SECURE === 'true',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
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
    } catch (err) {
        console.error('Email error:', err.message);
        return false;
    }
}

/* ================================================================
   EMAIL TEMPLATES
================================================================ */
function orderConfirmationEmail(order) {
    const itemsHTML = (order.items || []).map(i => `
        <tr>
            <td style="padding:10px;border-bottom:1px solid #f0f0f0">${i.name}</td>
            <td style="padding:10px;border-bottom:1px solid #f0f0f0;text-align:center">${i.qty}</td>
            <td style="padding:10px;border-bottom:1px solid #f0f0f0;text-align:right;color:#E41E26;font-weight:700">
                ৳${Number(i.price * i.qty).toLocaleString()}
            </td>
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
      <div style="color:#666;margin-top:4px">অর্ডার সফলভাবে গ্রহণ করা হয়েছে</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:8px 0;color:#888;font-size:13px">Order ID</td>
          <td style="padding:8px 0;font-weight:700;color:#E41E26;font-size:15px">${order.orderId}</td></tr>
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
        <tr style="background:#fff8e6">
          <td colspan="2" style="padding:12px;font-weight:700;font-size:16px">মোট</td>
          <td style="padding:12px;font-weight:800;color:#E41E26;font-size:18px;text-align:right">
            ৳${Number(order.pricing?.total || 0).toLocaleString()}
          </td>
        </tr>
      </tfoot>
    </table>
    <div style="margin-top:24px;background:#fff0f0;border-radius:8px;padding:16px;font-size:13px;color:#666">
      <strong style="color:#E41E26">📦 ডেলিভারি তথ্য:</strong><br>
      ঢাকার মধ্যে ২৪ ঘণ্টা, সারাদেশে ২-৩ কর্মদিবস।
      কোনো সমস্যায় WhatsApp করুন।
    </div>
  </div>
  <div style="background:#f7f7fc;padding:20px;text-align:center;font-size:12px;color:#aaa">
    © ${new Date().getFullYear()} Shoplixo. All rights reserved. | shoplixo.shop
  </div>
</body></html>`;
}

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
    <p style="color:#666">আপনার Shoplixo account সফলভাবে তৈরি হয়েছে।</p>
    <p style="color:#666;margin-top:8px">এখন থেকে সহজেই order track করুন এবং wishlist manage করুন।</p>
    <a href="${process.env.SITE_URL || 'https://shoplixo.shop'}"
       style="display:inline-block;margin-top:24px;background:#E41E26;color:#fff;padding:12px 32px;border-radius:999px;font-weight:700;text-decoration:none">
      Shopping শুরু করুন →
    </a>
  </div>
</body></html>`;
}

/* ================================================================
   RATE LIMIT — Simple in-memory (per serverless instance)
================================================================ */
const _rateMap = new Map();
function checkRateLimit(ip, max = 20, windowMs = 60000) {
    const now  = Date.now();
    const data = _rateMap.get(ip) || { count: 0, start: now };
    if (now - data.start > windowMs) {
        _rateMap.set(ip, { count: 1, start: now });
        return true;
    }
    data.count++;
    _rateMap.set(ip, data);
    return data.count <= max;
}

/* ================================================================
   VALIDATION HELPERS
================================================================ */
function isValidBDPhone(phone) {
    return /^(?:\+?88)?01[3-9]\d{8}$/.test(String(phone).trim());
}
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}
function sanitize(str, maxLen = 500) {
    return String(str || '').trim().slice(0, maxLen).replace(/[<>]/g, '');
}

/* ================================================================
   EXPORT
================================================================ */
module.exports = {
    handleCors,
    setCors,
    generateOrderId,
    verifyToken,
    isAdmin,
    sendEmail,
    orderConfirmationEmail,
    welcomeEmail,
    checkRateLimit,
    isValidBDPhone,
    isValidEmail,
    sanitize,
};
