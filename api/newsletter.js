/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/newsletter
 *
 *  POST /api/newsletter → Subscribe করুন (welcome coupon পাবেন)
 * ══════════════════════════════════════════════════════════════
 */

const { connectDB, Newsletter } = require('../_db');
const { handleCors, isValidEmail, sanitize, checkRateLimit, sendEmail } = require('../_helpers');

/* Welcome coupon email */
function newsletterWelcomeEmail(email, name, couponCode) {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#1A1A2E,#2D1B6E);padding:32px;text-align:center">
    <div style="font-size:28px;font-weight:800;color:#fff">Shop<span style="color:#FFB800">lixo</span></div>
  </div>
  <div style="background:#fff;padding:32px;text-align:center">
    <div style="font-size:40px;margin-bottom:12px">🎁</div>
    <h2 style="color:#1A1A2E;margin-bottom:8px">ধন্যবাদ Subscribe করার জন্য!</h2>
    ${name ? `<p style="color:#666">স্বাগতম, ${name}!</p>` : ''}
    <p style="color:#666;margin-top:8px">আপনার জন্য একটি বিশেষ উপহার:</p>
    <div style="background:#fff0f0;border:2px dashed #E41E26;border-radius:12px;padding:24px;margin:24px 0">
      <div style="font-size:13px;color:#888;margin-bottom:8px">আপনার Exclusive Coupon Code</div>
      <div style="font-family:monospace;font-size:28px;font-weight:800;color:#E41E26;letter-spacing:4px">${couponCode}</div>
      <div style="font-size:13px;color:#888;margin-top:8px">প্রথম অর্ডারে 10% ছাড়</div>
    </div>
    <a href="${process.env.SITE_URL || 'https://shoplixo.shop'}"
       style="display:inline-block;background:#E41E26;color:#fff;padding:12px 32px;border-radius:999px;font-weight:700;text-decoration:none">
      এখনই Shop করুন →
    </a>
  </div>
</body></html>`;
}

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || '';
    if (!checkRateLimit(`nl_${ip}`, 5, 60000)) {
        return res.status(429).json({ ok: false, error: 'অনেক request!' });
    }

    const email = sanitize(req.body?.email || '', 150).toLowerCase();
    const name  = sanitize(req.body?.name  || '', 100);

    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ ok: false, error: 'সঠিক Email দিন!' });
    }

    try {
        await connectDB();

        const existing = await Newsletter.findOne({ email });
        if (existing) {
            if (!existing.isActive) {
                existing.isActive = true;
                await existing.save();
                return res.json({ ok: true, message: 'আপনি আবার subscribe হয়েছেন!' });
            }
            return res.json({ ok: true, message: 'আপনি ইতিমধ্যে subscriber!' });
        }

        /* Save subscriber */
        await Newsletter.create({ email, name, source: 'website' });

        /* Send welcome email with coupon */
        const couponCode = 'WELCOME10';
        sendEmail(email, '🎁 আপনার Welcome Gift — Shoplixo', newsletterWelcomeEmail(email, name, couponCode))
            .catch(() => {});

        return res.status(201).json({
            ok:      true,
            message: '🎉 Subscribe সফল! Email দেখুন — Welcome coupon পাঠানো হয়েছে!',
            coupon:  couponCode,
        });

    } catch (err) {
        console.error('Newsletter error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
};
