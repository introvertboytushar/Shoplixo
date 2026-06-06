/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/admin
 *  ⚠️  Protected by x-admin-key header
 *
 *  GET  ?action=stats       → Dashboard statistics
 *  GET  ?action=orders      → Orders list (paginated)
 *  GET  ?action=order&id=x  → Single order detail
 *  POST ?action=status      → Order status আপডেট
 *  POST ?action=order       → Order cancel / update
 *  GET  ?action=customers   → Users list
 *  GET  ?action=newsletter  → Newsletter subscribers
 *  POST ?action=coupon      → Coupon তৈরি / আপডেট
 *  GET  ?action=coupons     → Coupon list
 * ══════════════════════════════════════════════════════════════
 */

const { connectDB, Order, User, Newsletter, Coupon } = require('../_db');
const { handleCors, isAdmin, sanitize, sendEmail }   = require('../_helpers');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    /* ── Admin auth check ───────────────────────────────────── */
    if (!isAdmin(req)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized. Admin key লাগবে।' });
    }

    const action = req.query?.action || '';
    await connectDB();

    /* ══════════════════════════════════════════════════════════
       GET: DASHBOARD STATS
    ══════════════════════════════════════════════════════════ */
    if (action === 'stats' && req.method === 'GET') {
        try {
            const now        = new Date();
            const today      = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const thisMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastMonth  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastMonthE = new Date(now.getFullYear(), now.getMonth(), 0);

            const [
                totalOrders, totalRevObj, totalUsers, pendingOrders,
                todayOrders, monthOrders, lastMonthOrders,
                todayRevObj, monthRevObj, lastMonthRevObj,
                statusBreakdown, revenueByDayRaw, topProductsRaw,
            ] = await Promise.all([
                Order.countDocuments(),
                Order.aggregate([{ $match:{ status:{ $nin:['cancelled','refunded'] } } }, { $group:{ _id:null, total:{ $sum:'$pricing.total' } } }]),
                User.countDocuments(),
                Order.countDocuments({ status: 'pending' }),
                Order.countDocuments({ createdAt: { $gte: today } }),
                Order.countDocuments({ createdAt: { $gte: thisMonth } }),
                Order.countDocuments({ createdAt: { $gte: lastMonth, $lte: lastMonthE } }),
                Order.aggregate([{ $match:{ createdAt:{ $gte: today }, status:{ $nin:['cancelled'] } } }, { $group:{ _id:null, total:{ $sum:'$pricing.total' } } }]),
                Order.aggregate([{ $match:{ createdAt:{ $gte: thisMonth }, status:{ $nin:['cancelled'] } } }, { $group:{ _id:null, total:{ $sum:'$pricing.total' } } }]),
                Order.aggregate([{ $match:{ createdAt:{ $gte: lastMonth, $lte: lastMonthE }, status:{ $nin:['cancelled'] } } }, { $group:{ _id:null, total:{ $sum:'$pricing.total' } } }]),
                /* Status breakdown */
                Order.aggregate([{ $group:{ _id:'$status', count:{ $sum:1 } } }]),
                /* Revenue last 30 days */
                Order.aggregate([
                    { $match:{ createdAt:{ $gte: new Date(Date.now() - 30*86400000) }, status:{ $nin:['cancelled','refunded'] } } },
                    { $group:{ _id:{ $dateToString:{ format:'%Y-%m-%d', date:'$createdAt' } }, revenue:{ $sum:'$pricing.total' }, orders:{ $sum:1 } } },
                    { $sort:{ _id:1 } },
                ]),
                /* Top selling products */
                Order.aggregate([
                    { $match:{ status:{ $nin:['cancelled','refunded'] } } },
                    { $unwind:'$items' },
                    { $group:{ _id:'$items.name', totalQty:{ $sum:'$items.qty' }, totalRev:{ $sum:{ $multiply:['$items.price','$items.qty'] } }, img:{ $first:'$items.img' } } },
                    { $sort:{ totalQty:-1 } },
                    { $limit:5 },
                ]),
            ]);

            const totalRev     = totalRevObj[0]?.total     || 0;
            const todayRev     = todayRevObj[0]?.total     || 0;
            const monthRev     = monthRevObj[0]?.total     || 0;
            const lastMonthRev = lastMonthRevObj[0]?.total || 0;

            /* Revenue growth % */
            const revenueGrowth = lastMonthRev > 0
                ? Math.round(((monthRev - lastMonthRev) / lastMonthRev) * 100)
                : 0;
            const orderGrowth = lastMonthOrders > 0
                ? Math.round(((monthOrders - lastMonthOrders) / lastMonthOrders) * 100)
                : 0;

            return res.json({
                ok: true,
                stats: {
                    totalOrders, totalRev, totalUsers, pendingOrders,
                    todayOrders, todayRev, monthOrders, monthRev,
                    revenueGrowth, orderGrowth,
                },
                statusBreakdown: statusBreakdown.map(s => ({ status: s._id, count: s.count })),
                revenueByDay:    revenueByDayRaw.map(d => ({ date: d._id, revenue: d.revenue, orders: d.orders })),
                topProducts:     topProductsRaw.map(p => ({ name: p._id, qty: p.totalQty, revenue: p.totalRev, img: p.img })),
            });

        } catch (err) {
            console.error('Stats error:', err);
            return res.status(500).json({ ok: false, error: 'Stats লোড হয়নি' });
        }
    }

    /* ══════════════════════════════════════════════════════════
       GET: ORDERS LIST
    ══════════════════════════════════════════════════════════ */
    if (action === 'orders' && req.method === 'GET') {
        try {
            const page    = Math.max(1, parseInt(req.query?.page    || '1'));
            const limit   = Math.min(50, parseInt(req.query?.limit  || '20'));
            const search  = sanitize(req.query?.search   || '', 100);
            const status  = sanitize(req.query?.status   || '', 50);
            const payment = sanitize(req.query?.payment  || '', 50);
            const skip    = (page - 1) * limit;

            /* Build query */
            const query = {};
            if (status)  query.status             = status;
            if (payment) query['payment.method']  = payment;
            if (search) {
                query.$or = [
                    { orderId:           { $regex: search, $options: 'i' } },
                    { 'customer.name':   { $regex: search, $options: 'i' } },
                    { 'customer.phone':  { $regex: search, $options: 'i' } },
                    { 'customer.email':  { $regex: search, $options: 'i' } },
                ];
            }

            const [orders, total] = await Promise.all([
                Order.find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .select('-ip -userAgent -__v'),
                Order.countDocuments(query),
            ]);

            return res.json({
                ok: true,
                orders: orders.map(o => ({
                    orderId:   o.orderId,
                    name:      o.customer.name,
                    phone:     o.customer.phone,
                    district:  o.customer.district,
                    items:     o.items,
                    itemCount: o.items.reduce((s, i) => s + i.qty, 0),
                    total:     o.pricing.total,
                    payment:   o.payment.method,
                    payStatus: o.payment.status,
                    trxId:     o.payment.transactionId,
                    status:    o.status,
                    tracking:  o.tracking,
                    createdAt: o.createdAt,
                })),
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            });

        } catch (err) {
            console.error('Orders list error:', err);
            return res.status(500).json({ ok: false, error: 'Orders লোড হয়নি' });
        }
    }

    /* ══════════════════════════════════════════════════════════
       GET: SINGLE ORDER
    ══════════════════════════════════════════════════════════ */
    if (action === 'order' && req.method === 'GET') {
        const id = sanitize(req.query?.id || '', 20).toUpperCase();
        if (!id) return res.status(400).json({ ok: false, error: 'Order ID দিন' });

        try {
            const order = await Order.findOne({ orderId: id }).select('-__v');
            if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });
            return res.json({ ok: true, order });
        } catch (err) {
            return res.status(500).json({ ok: false, error: 'Error' });
        }
    }

    /* ══════════════════════════════════════════════════════════
       POST: UPDATE ORDER STATUS
    ══════════════════════════════════════════════════════════ */
    if (action === 'status' && req.method === 'POST') {
        const b       = req.body || {};
        const id      = sanitize(b.id      || b.orderId || '', 20).toUpperCase();
        const status  = sanitize(b.status  || '', 50);
        const note    = sanitize(b.note    || '', 300);
        const courier = sanitize(b.courier || '', 100);
        const trackId = sanitize(b.trackId || b.tracking || '', 100);

        const validStatuses = ['pending','confirmed','processing','shipped','delivered','cancelled','refunded'];
        if (!id || !validStatuses.includes(status)) {
            return res.status(400).json({ ok: false, error: 'Order ID এবং valid status দিন' });
        }

        try {
            const update = {
                status,
                $push: {
                    statusHistory: {
                        status,
                        note:      note || `Status updated to ${status}`,
                        updatedBy: 'admin',
                        updatedAt: new Date(),
                    },
                },
            };

            if (courier || trackId) {
                update['tracking.courier']    = courier;
                update['tracking.trackingId'] = trackId;
            }

            const order = await Order.findOneAndUpdate({ orderId: id }, update, { new: true });
            if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

            /* Update user stats if delivered */
            if (status === 'delivered') {
                User.findOneAndUpdate(
                    { phone: order.customer.phone },
                    { $inc: { totalOrders: 1, totalSpent: order.pricing.total, loyaltyPoints: Math.floor(order.pricing.total / 10) } }
                ).catch(() => {});
            }

            return res.json({ ok: true, message: `Status → ${status}`, orderId: id });

        } catch (err) {
            console.error('Status update error:', err);
            return res.status(500).json({ ok: false, error: 'Update হয়নি' });
        }
    }

    /* ══════════════════════════════════════════════════════════
       POST: CANCEL ORDER
    ══════════════════════════════════════════════════════════ */
    if (action === 'order' && req.method === 'POST') {
        const b      = req.body || {};
        const id     = sanitize(b.id || b.orderId || '', 20).toUpperCase();
        const reason = sanitize(b.reason || 'Cancelled by admin', 300);

        if (!id) return res.status(400).json({ ok: false, error: 'Order ID দিন' });

        try {
            const order = await Order.findOneAndUpdate(
                { orderId: id },
                {
                    status: 'cancelled',
                    $push: { statusHistory: { status: 'cancelled', note: reason, updatedBy: 'admin' } },
                },
                { new: true }
            );
            if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });
            return res.json({ ok: true, message: 'Order cancelled', orderId: id });
        } catch {
            return res.status(500).json({ ok: false, error: 'Error' });
        }
    }

    /* ══════════════════════════════════════════════════════════
       GET: CUSTOMERS LIST
    ══════════════════════════════════════════════════════════ */
    if (action === 'customers' && req.method === 'GET') {
        try {
            const page  = Math.max(1, parseInt(req.query?.page  || '1'));
            const limit = Math.min(50, parseInt(req.query?.limit || '20'));
            const search = sanitize(req.query?.search || '', 100);
            const skip  = (page - 1) * limit;

            const query = {};
            if (search) {
                query.$or = [
                    { name:  { $regex: search, $options: 'i' } },
                    { phone: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                ];
            }

            const [users, total] = await Promise.all([
                User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit)
                    .select('-password -otp -otpExpiry -__v'),
                User.countDocuments(query),
            ]);

            return res.json({
                ok: true,
                users,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            });
        } catch {
            return res.status(500).json({ ok: false, error: 'Error' });
        }
    }

    /* ══════════════════════════════════════════════════════════
       GET: NEWSLETTER SUBSCRIBERS
    ══════════════════════════════════════════════════════════ */
    if (action === 'newsletter' && req.method === 'GET') {
        try {
            const subscribers = await Newsletter.find({ isActive: true })
                .sort({ createdAt: -1 }).select('-__v');
            return res.json({ ok: true, subscribers, total: subscribers.length });
        } catch {
            return res.status(500).json({ ok: false, error: 'Error' });
        }
    }

    /* ══════════════════════════════════════════════════════════
       GET: COUPONS LIST
    ══════════════════════════════════════════════════════════ */
    if (action === 'coupons' && req.method === 'GET') {
        try {
            const coupons = await Coupon.find().sort({ createdAt: -1 }).select('-__v');
            return res.json({ ok: true, coupons });
        } catch {
            return res.status(500).json({ ok: false, error: 'Error' });
        }
    }

    /* ══════════════════════════════════════════════════════════
       POST: CREATE / UPDATE COUPON
    ══════════════════════════════════════════════════════════ */
    if (action === 'coupon' && req.method === 'POST') {
        const b = req.body || {};
        const code = sanitize(b.code || '', 30).toUpperCase();
        if (!code) return res.status(400).json({ ok: false, error: 'Coupon code দিন' });

        try {
            const data = {
                code,
                type:        b.type     || 'percent',
                discount:    parseFloat(b.discount || 10),
                minOrder:    parseFloat(b.minOrder  || 0),
                maxUses:     parseInt(b.maxUses     || 0),
                isActive:    b.isActive !== false,
                description: sanitize(b.description || '', 200),
            };
            if (b.expiresAt) data.expiresAt = new Date(b.expiresAt);

            const coupon = await Coupon.findOneAndUpdate(
                { code },
                { $set: data },
                { upsert: true, new: true }
            );
            return res.json({ ok: true, coupon, message: 'Coupon saved!' });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    /* ══════════════════════════════════════════════════════════
       POST: TOGGLE COUPON ACTIVE/INACTIVE
    ══════════════════════════════════════════════════════════ */
    if (action === 'toggle-coupon' && req.method === 'POST') {
        const code = sanitize(req.body?.code || '', 30).toUpperCase();
        if (!code) return res.status(400).json({ ok: false, error: 'Code দিন' });
        try {
            const c = await Coupon.findOne({ code });
            if (!c) return res.status(404).json({ ok: false, error: 'Coupon পাওয়া যায়নি' });
            c.isActive = !c.isActive;
            await c.save();
            return res.json({ ok: true, isActive: c.isActive });
        } catch {
            return res.status(500).json({ ok: false, error: 'Error' });
        }
    }

    return res.status(400).json({
        ok: false,
        error: 'Invalid action',
        available: ['stats','orders','order','status','customers','newsletter','coupons','coupon','toggle-coupon'],
    });
};
