/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/coupon
 *
 *  POST /api/coupon          → Coupon validate করুন
 *  GET  /api/coupon?code=xxx → Coupon check করুন
 * ══════════════════════════════════════════════════════════════
 */

const { connectDB, Coupon } = require('../_db');
const { handleCors, sanitize, checkRateLimit } = require('../_helpers');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || '';
    if (!checkRateLimit(`coupon_${ip}`, 15, 60000)) {
        return res.status(429).json({ ok: false, error: 'অনেক request!' });
    }

    /* Both GET and POST supported */
    const code     = sanitize(
        (req.method === 'POST' ? req.body?.code : req.query?.code) || '', 50
    ).toUpperCase();
    const subtotal = parseFloat(
        (req.method === 'POST' ? req.body?.subtotal : req.query?.subtotal) || 0
    );

    if (!code) return res.status(400).json({ ok: false, error: 'Coupon code দিন!' });

    try {
        await connectDB();

        const coupon = await Coupon.findOne({ code, isActive: true });

        if (!coupon) {
            return res.status(404).json({ ok: false, error: `"${code}" একটি valid coupon code নয়!` });
        }

        /* Check expiry */
        if (coupon.expiresAt && coupon.expiresAt < new Date()) {
            return res.status(400).json({ ok: false, error: 'এই coupon-এর মেয়াদ শেষ হয়ে গেছে!' });
        }

        /* Check usage limit */
        if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
            return res.status(400).json({ ok: false, error: 'এই coupon ইতিমধ্যে সর্বোচ্চ ব্যবহার হয়ে গেছে!' });
        }

        /* Check minimum order */
        if (subtotal > 0 && coupon.minOrder > 0 && subtotal < coupon.minOrder) {
            return res.status(400).json({
                ok:    false,
                error: `এই coupon-এর জন্য কমপক্ষে ৳${coupon.minOrder.toLocaleString()} এর অর্ডার করতে হবে!`,
            });
        }

        /* Calculate discount */
        const discountAmt = subtotal > 0
            ? (coupon.type === 'percent'
                ? Math.round(subtotal * coupon.discount / 100)
                : Math.min(coupon.discount, subtotal))
            : coupon.discount;

        return res.json({
            ok:          true,
            code:        coupon.code,
            type:        coupon.type,
            discount:    coupon.discount,
            discountAmt: discountAmt,
            minOrder:    coupon.minOrder,
            description: coupon.description,
            message:     coupon.type === 'percent'
                ? `🎉 ${coupon.discount}% ছাড় পেয়েছেন! (৳${discountAmt.toLocaleString()})`
                : `🎉 ৳${coupon.discount} ছাড় পেয়েছেন!`,
        });

    } catch (err) {
        console.error('Coupon error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
};
