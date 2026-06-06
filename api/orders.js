/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/orders
 *
 *  POST /api/orders         → নতুন order দিন
 *  GET  /api/orders?id=xxx  → order track করুন
 * ══════════════════════════════════════════════════════════════
 */

const { connectDB, Order, Coupon } = require('../_db');
const {
    handleCors, generateOrderId, checkRateLimit,
    isValidBDPhone, sanitize, sendEmail, orderConfirmationEmail,
} = require('../_helpers');

/* ── Districts list ─────────────────────────────────────────── */
const BD_DISTRICTS = [
    'ঢাকা','চট্টগ্রাম','রাজশাহী','সিলেট','খুলনা','বরিশাল','রংপুর','ময়মনসিংহ',
    'কুমিল্লা','নারায়ণগঞ্জ','গাজীপুর','ফেনী','নোয়াখালী','লক্ষ্মীপুর','চাঁদপুর',
    'ব্রাহ্মণবাড়িয়া','হবিগঞ্জ','মৌলভীবাজার','সুনামগঞ্জ','নেত্রকোণা','কিশোরগঞ্জ',
    'মানিকগঞ্জ','মুন্সিগঞ্জ','রাজবাড়ী','ফরিদপুর','মাদারীপুর','শরীয়তপুর','গোপালগঞ্জ',
    'টাঙ্গাইল','জামালপুর','শেরপুর','ময়মনসিংহ','নরসিংদী','পাবনা','সিরাজগঞ্জ','নাটোর',
    'চাঁপাইনবাবগঞ্জ','নওগাঁ','জয়পুরহাট','বগুড়া','দিনাজপুর','ঠাকুরগাঁও','পঞ্চগড়',
    'নীলফামারী','লালমনিরহাট','কুড়িগ্রাম','গাইবান্ধা','যশোর','ঝিনাইদহ','মাগুরা',
    'নড়াইল','কুষ্টিয়া','মেহেরপুর','চুয়াডাঙ্গা','সাতক্ষীরা','বাগেরহাট','পিরোজপুর',
    'ঝালকাঠি','বরগুনা','পটুয়াখালী','ভোলা','ব্রাহ্মণবাড়িয়া','কক্সবাজার','বান্দরবান',
    'রাঙামাটি','খাগড়াছড়ি',
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    /* ── GET: Track order ────────────────────────────────────── */
    if (req.method === 'GET') {
        const id = req.query?.id || '';
        if (!id) return res.status(400).json({ ok: false, error: 'Order ID দিন' });

        try {
            await connectDB();
            const order = await Order.findOne({ orderId: id.toUpperCase() })
                .select('-ip -userAgent -__v');
            if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

            return res.json({
                ok: true,
                order: {
                    orderId:   order.orderId,
                    status:    order.status,
                    customer:  { name: order.customer.name, phone: order.customer.phone.slice(0, -4) + '****' },
                    items:     order.items,
                    pricing:   order.pricing,
                    tracking:  order.tracking,
                    history:   order.statusHistory,
                    createdAt: order.createdAt,
                },
            });
        } catch (err) {
            console.error('Track order error:', err);
            return res.status(500).json({ ok: false, error: 'Server error' });
        }
    }

    /* ── POST: Place order ───────────────────────────────────── */
    if (req.method === 'POST') {
        /* Rate limit: max 5 orders/min per IP */
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '';
        if (!checkRateLimit(`order_${ip}`, 5, 60000)) {
            return res.status(429).json({ ok: false, error: 'অনেক request! ১ মিনিট পরে চেষ্টা করুন।' });
        }

        const b = req.body || {};

        /* ── Validation ─────────────────────────────────────── */
        const name    = sanitize(b.name, 100);
        const phone   = sanitize(b.phone, 20).replace(/\s+/g, '');
        const address = sanitize(b.address, 300);
        const district= sanitize(b.district, 50);
        const email   = sanitize(b.email || '', 150);
        const note    = sanitize(b.note   || '', 500);
        const payment = String(b.payment  || '').toLowerCase();
        const trxId   = sanitize(b.trxId  || '', 100);
        const couponCode = sanitize(b.couponCode || '', 50).toUpperCase();
        const items   = Array.isArray(b.items) ? b.items : [];

        if (!name)                       return res.status(400).json({ ok: false, error: 'নাম লিখুন!' });
        if (!isValidBDPhone(phone))      return res.status(400).json({ ok: false, error: 'সঠিক ফোন নম্বর দিন!' });
        if (!address)                    return res.status(400).json({ ok: false, error: 'ঠিকানা লিখুন!' });
        if (!district)                   return res.status(400).json({ ok: false, error: 'জেলা সিলেক্ট করুন!' });
        if (!['bkash','nagad','rocket','upay','cod'].includes(payment))
            return res.status(400).json({ ok: false, error: 'Payment method সিলেক্ট করুন!' });
        if (payment !== 'cod' && !trxId) return res.status(400).json({ ok: false, error: 'Transaction ID দিন!' });
        if (!items.length)               return res.status(400).json({ ok: false, error: 'Cart খালি!' });

        /* ── Validate & sanitize items ──────────────────────── */
        const cleanItems = items.slice(0, 30).map(i => ({
            productId: String(i.id   || i.productId || ''),
            name:      sanitize(i.name, 200),
            price:     Math.max(0, parseFloat(i.price) || 0),
            qty:       Math.min(99, Math.max(1, parseInt(i.qty) || 1)),
            img:       sanitize(i.img || '', 500),
            size:      sanitize(i.size  || '', 50),
            color:     sanitize(i.color || '', 50),
        })).filter(i => i.productId && i.name && i.price > 0);

        if (!cleanItems.length) return res.status(400).json({ ok: false, error: 'Valid items নেই!' });

        /* ── Calculate pricing ──────────────────────────────── */
        const freeMin  = parseInt(process.env.FREE_SHIPPING_MIN || '999');
        const shipCost = parseInt(process.env.SHIPPING_COST     || '60');
        const subtotal = cleanItems.reduce((s, i) => s + i.price * i.qty, 0);
        const shipping = subtotal >= freeMin ? 0 : shipCost;

        /* ── Apply coupon if any ────────────────────────────── */
        let discountAmt  = 0;
        let appliedCoupon = '';
        if (couponCode) {
            try {
                await connectDB();
                const coupon = await Coupon.findOne({ code: couponCode, isActive: true });
                if (coupon) {
                    const now = new Date();
                    const notExpired  = !coupon.expiresAt || coupon.expiresAt > now;
                    const hasUses     = !coupon.maxUses   || coupon.usedCount < coupon.maxUses;
                    const meetsMin    = subtotal >= (coupon.minOrder || 0);
                    if (notExpired && hasUses && meetsMin) {
                        discountAmt = coupon.type === 'percent'
                            ? Math.round(subtotal * coupon.discount / 100)
                            : Math.min(coupon.discount, subtotal);
                        appliedCoupon = couponCode;
                    }
                }
            } catch { /* coupon check failed silently — proceed without discount */ }
        }

        const total = Math.max(0, subtotal + shipping - discountAmt);

        /* ── Generate unique order ID with retry ────────────── */
        let orderId = generateOrderId();
        let attempt = 0;
        await connectDB();
        while (attempt < 5) {
            const exists = await Order.findOne({ orderId });
            if (!exists) break;
            orderId = generateOrderId();
            attempt++;
        }

        /* ── Save order ─────────────────────────────────────── */
        const order = new Order({
            orderId,
            customer: { name, phone, email, address, district, note },
            items:    cleanItems,
            payment:  { method: payment, transactionId: trxId, status: payment === 'cod' ? 'pending' : 'pending' },
            pricing:  { subtotal, shipping, discount: discountAmt, coupon: appliedCoupon, total },
            status:   'pending',
            statusHistory: [{ status: 'pending', note: 'Order placed', updatedBy: 'system' }],
            source:   sanitize(req.headers.referer || 'website', 100),
            ip,
            userAgent: sanitize(req.headers['user-agent'] || '', 300),
        });

        await order.save();

        /* ── Mark coupon as used ────────────────────────────── */
        if (appliedCoupon) {
            try {
                await Coupon.findOneAndUpdate(
                    { code: appliedCoupon },
                    { $inc: { usedCount: 1 }, $push: { usedBy: phone } }
                );
            } catch { /* non-fatal */ }
        }

        /* ── Send confirmation email (non-blocking) ─────────── */
        if (email) {
            sendEmail(email, `✅ Order Confirmed — ${orderId} | Shoplixo`, orderConfirmationEmail(order))
                .catch(e => console.error('Email failed:', e.message));
        }

        /* ── Success response ───────────────────────────────── */
        return res.status(201).json({
            ok:      true,
            orderId,
            total,
            subtotal,
            shipping,
            discount: discountAmt,
            message: `অর্ডার সফল! Order ID: ${orderId}`,
        });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
