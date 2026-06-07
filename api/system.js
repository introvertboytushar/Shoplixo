/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/system
 *  Merged: Stats · Returns · Notifications · Seed
 *
 *  ── STATS ────────────────────────────────────────────────────
 *  GET  /api/system?module=stats                  → Public stats
 *  GET  /api/system?module=stats&action=live      → Live counters
 *  GET  /api/system?module=stats&action=dashboard → Admin dashboard
 *  POST /api/system?module=stats&action=visit     → Track visitor
 *
 *  ── RETURNS ──────────────────────────────────────────────────
 *  POST /api/system?module=returns                → Submit return request
 *  GET  /api/system?module=returns&orderId=xxx    → My return status
 *  GET  /api/system?module=returns (admin)        → All returns
 *  PATCH /api/system?module=returns&id=xxx (admin)→ Update return
 *  POST /api/system?module=returns&action=approve → Approve + refund
 *  POST /api/system?module=returns&action=reject  → Reject request
 *
 *  ── NOTIFICATIONS ────────────────────────────────────────────
 *  GET  /api/system?module=notifications               → My notifications
 *  GET  /api/system?module=notifications&action=count  → Unread count
 *  GET  /api/system?module=notifications&action=all    → All (admin)
 *  POST /api/system?module=notifications&action=read   → Mark read
 *  POST /api/system?module=notifications&action=read-all → Mark all read
 *  POST /api/system?module=notifications&action=broadcast → Broadcast (admin)
 *  POST /api/system?module=notifications&action=send   → Send to user (admin)
 *  DELETE /api/system?module=notifications&id=xxx      → Delete (admin)
 *
 *  ── SEED ─────────────────────────────────────────────────────
 *  POST /api/system?module=seed&secret=xxx        → Seed products
 * ══════════════════════════════════════════════════════════════
 */

const {
  connectDB, Order, User, Product, SiteStats, Newsletter,
  ReturnRequest, InventoryLog, Notification, LoyaltyTxn,
} = require('../_db');
const {
  handleCors, isAdmin, verifyToken, sanitize, checkRateLimit,
  generateReturnId, sendEmail, sendSMS, returnApprovedEmail, smsTemplates,
} = require('../_helpers');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STATS CACHE (30 second TTL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let statsCache     = null;
let statsCacheTime = 0;
const CACHE_TTL    = 30 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  const module_ = req.query?.module || '';
  const action  = req.query?.action || '';
  const ip      = req.headers['x-forwarded-for']?.split(',')[0] || '';

  try {
    await connectDB();

    /* ══════════════════════════════════════════════════════════
       MODULE: STATS
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'stats') {

      /* POST: Track Visit */
      if (req.method === 'POST' && action === 'visit') {
        const today = todayKey();
        await SiteStats.findOneAndUpdate({ date: today }, { $inc: { visitors: 1 } }, { upsert: true, new: true });
        return res.json({ ok: true });
      }

      /* GET: Live Stats (public, cached) */
      if (req.method === 'GET' && action === 'live') {
        const now = Date.now();
        if (statsCache && now - statsCacheTime < CACHE_TTL) {
          return res.json({ ok: true, ...statsCache });
        }
        const today      = todayKey();
        const todayStart = new Date(today + 'T00:00:00.000Z');
        const [todayOrders, todayRevAgg, totalOrders, totalCustomers] = await Promise.all([
          Order.countDocuments({ createdAt: { $gte: todayStart } }),
          Order.aggregate([
            { $match: { createdAt: { $gte: todayStart }, status: { $nin: ['cancelled','refunded'] } } },
            { $group: { _id: null, total: { $sum: '$pricing.total' } } },
          ]),
          Order.countDocuments({ status: { $nin: ['cancelled'] } }),
          User.countDocuments({ isActive: true }),
        ]);
        const liveData = {
          todayOrders, todayRevenue: todayRevAgg[0]?.total || 0,
          totalOrders, totalCustomers,
          happyCustomers: Math.max(50000, totalCustomers * 5),
          onlineNow: Math.floor(Math.random() * 80 + 20),
          lastUpdated: new Date().toISOString(),
        };
        statsCache = liveData; statsCacheTime = now;
        return res.json({ ok: true, ...liveData });
      }

      /* GET: Full Admin Dashboard */
      if (req.method === 'GET' && action === 'dashboard') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const today     = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        const lastWeek  = new Date(today); lastWeek.setDate(lastWeek.getDate() - 7);
        const lastMonth = new Date(today); lastMonth.setMonth(lastMonth.getMonth() - 1);

        const [
          todayOrderCount, todayRevenueAgg, yestOrderCount, yestRevenueAgg,
          totalOrderCount, totalRevenueAgg, pendingOrders, shippedOrders, deliveredOrders,
          totalUsers, newUsersToday, totalProducts, lowStockProducts, outOfStock,
          newsletterCount, recentOrders, revenueByDay, topProducts, ordersByStatus, ordersByDistrict,
        ] = await Promise.all([
          Order.countDocuments({ createdAt: { $gte: today } }),
          Order.aggregate([{ $match: { createdAt: { $gte: today }, status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$pricing.total' }, count: { $sum: 1 } } }]),
          Order.countDocuments({ createdAt: { $gte: yesterday, $lt: today } }),
          Order.aggregate([{ $match: { createdAt: { $gte: yesterday, $lt: today }, status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$pricing.total' } } }]),
          Order.countDocuments({}),
          Order.aggregate([{ $match: { status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$pricing.total' }, avgOrder: { $avg: '$pricing.total' } } }]),
          Order.countDocuments({ status: 'pending' }),
          Order.countDocuments({ status: 'shipped' }),
          Order.countDocuments({ status: 'delivered' }),
          User.countDocuments({ isActive: true }),
          User.countDocuments({ createdAt: { $gte: today } }),
          Product.countDocuments({ isActive: true }),
          Product.countDocuments({ stock: { $gt: 0, $lte: 5 } }),
          Product.countDocuments({ stock: 0 }),
          Newsletter.countDocuments({ isActive: true }),
          Order.find({}).sort({ createdAt: -1 }).limit(10).select('orderId customer.name customer.phone pricing.total status createdAt').lean(),
          Order.aggregate([
            { $match: { createdAt: { $gte: lastWeek }, status: { $ne: 'cancelled' } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ]),
          Order.aggregate([
            { $unwind: '$items' },
            { $group: { _id: '$items.productId', name: { $first: '$items.name' }, totalSold: { $sum: '$items.qty' }, revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } } } },
            { $sort: { totalSold: -1 } }, { $limit: 5 },
          ]),
          Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
          Order.aggregate([
            { $match: { createdAt: { $gte: lastMonth } } },
            { $group: { _id: '$customer.district', count: { $sum: 1 }, revenue: { $sum: '$pricing.total' } } },
            { $sort: { count: -1 } }, { $limit: 10 },
          ]),
        ]);

        const todayRevenue = todayRevenueAgg[0]?.total || 0;
        const yestRevenue  = yestRevenueAgg[0]?.total  || 0;
        const totalRevenue = totalRevenueAgg[0]?.total  || 0;
        const avgOrder     = totalRevenueAgg[0]?.avgOrder || 0;

        return res.json({
          ok: true,
          today: {
            orders: todayOrderCount, revenue: todayRevenue,
            growth: yestRevenue > 0 ? Math.round((todayRevenue - yestRevenue) / yestRevenue * 100) : 0,
          },
          totals: {
            orders: totalOrderCount, revenue: totalRevenue, avgOrder: Math.round(avgOrder),
            pending: pendingOrders, shipped: shippedOrders, delivered: deliveredOrders,
          },
          users: { total: totalUsers, newToday: newUsersToday, newsletter: newsletterCount },
          products: { total: totalProducts, lowStock: lowStockProducts, outOfStock },
          recentOrders,
          charts: { revenueByDay, topProducts, ordersByStatus, ordersByDistrict },
        });
      }

      /* GET: Default public stats */
      if (req.method === 'GET') {
        const [totalOrders, totalUsers, totalProducts] = await Promise.all([
          Order.countDocuments({ status: { $nin: ['cancelled'] } }),
          User.countDocuments({ isActive: true }),
          Product.countDocuments({ isActive: true }),
        ]);
        return res.json({
          ok: true, totalOrders,
          totalCustomers: Math.max(50000, totalUsers * 5),
          totalProducts, districts: 64, rating: 4.8,
        });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: RETURNS
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'returns') {

      /* GET: Admin — all returns */
      if (req.method === 'GET' && isAdmin(req) && !req.query.orderId) {
        const { status, page = 1, search } = req.query;
        const skip  = (parseInt(page) - 1) * 20;
        const query = {};
        if (status) query.status = status;
        if (search) query.$or = [
          { returnId: { $regex: search, $options: 'i' } },
          { orderId:  { $regex: search, $options: 'i' } },
          { customerName:  { $regex: search, $options: 'i' } },
          { customerPhone: { $regex: search, $options: 'i' } },
        ];
        const [returns, total] = await Promise.all([
          ReturnRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(20).lean(),
          ReturnRequest.countDocuments(query),
        ]);
        const stats = await ReturnRequest.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$refundAmount' } } },
        ]);
        return res.json({ ok: true, returns, total, stats, page: parseInt(page) });
      }

      /* GET: Customer — my return status */
      if (req.method === 'GET') {
        const { orderId, returnId } = req.query;
        const decoded = verifyToken(req);
        if (returnId) {
          const ret = await ReturnRequest.findOne({ returnId }).lean();
          if (!ret) return res.status(404).json({ ok: false, error: 'Return পাওয়া যায়নি' });
          return res.json({ ok: true, return: ret });
        }
        if (orderId) {
          const returns = await ReturnRequest.find({ orderId }).lean();
          return res.json({ ok: true, returns });
        }
        if (decoded) {
          const returns = await ReturnRequest.find({ customerId: decoded.id })
            .sort({ createdAt: -1 }).limit(20).lean();
          return res.json({ ok: true, returns });
        }
        return res.status(400).json({ ok: false, error: 'orderId বা login করুন' });
      }

      /* POST: Submit Return Request */
      if (req.method === 'POST' && !action) {
        if (!checkRateLimit(`return_${ip}`, 3, 3600000)) {
          return res.status(429).json({ ok: false, error: 'অনেক return request! পরে চেষ্টা করুন।' });
        }
        const decoded = verifyToken(req);
        const b       = req.body || {};
        const orderId       = sanitize(b.orderId || '', 20).toUpperCase();
        const reason        = sanitize(b.reason || '', 200);
        const description   = sanitize(b.description || '', 1000);
        const refundMethod  = b.refundMethod || 'bkash';
        const images        = Array.isArray(b.images) ? b.images.slice(0, 5).map(i => sanitize(i, 500)) : [];

        if (!orderId) return res.status(400).json({ ok: false, error: 'Order ID দিন' });
        if (!reason)  return res.status(400).json({ ok: false, error: 'কারণ লিখুন' });

        const order = await Order.findOne({ orderId });
        if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });
        if (!['delivered'].includes(order.status)) {
          return res.status(400).json({ ok: false, error: 'শুধু Delivered order এ return করা যায়' });
        }

        const deliveredAt = order.statusHistory.find(h => h.status === 'delivered')?.updatedAt;
        if (deliveredAt) {
          const daysSince = (Date.now() - new Date(deliveredAt)) / 86400000;
          if (daysSince > 7) {
            return res.status(400).json({ ok: false, error: 'Return window শেষ (৭ দিন পার হয়ে গেছে)' });
          }
        }

        const existing = await ReturnRequest.findOne({ orderId, status: { $in: ['pending','approved'] } });
        if (existing) return res.status(409).json({ ok: false, error: 'এই order এ ইতিমধ্যে return request আছে' });

        const returnReq = await ReturnRequest.create({
          returnId:      generateReturnId(),
          orderId, customerId: decoded?.id || null,
          customerPhone: order.customer.phone, customerName: order.customer.name,
          items: (b.items || order.items).map(i => ({
            productId: i.productId, name: i.name, qty: parseInt(i.qty) || 1,
            price: parseFloat(i.price) || 0, reason: sanitize(i.reason || reason, 100),
          })),
          reason, description, images, refundMethod,
          refundAmount: order.pricing.total, status: 'pending',
        });

        order.status = 'return_requested';
        order.statusHistory.push({ status: 'return_requested', note: reason, updatedBy: 'customer' });
        await order.save();

        await Notification.create({
          type: 'return', title: `Return Request — ${orderId}`,
          message: `${order.customer.name} ফেরত চেয়েছেন। কারণ: ${reason}`,
          icon: '📬', isGlobal: false, metadata: { returnId: returnReq.returnId, orderId },
        }).catch(() => {});

        return res.status(201).json({
          ok: true, returnId: returnReq.returnId,
          message: '✅ Return request পাঠানো হয়েছে। Admin ২৪ ঘণ্টার মধ্যে review করবে।',
        });
      }

      /* Admin-only actions below */
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

      /* PATCH: Update Return */
      if (req.method === 'PATCH') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const b = req.body || {};
        const updates = {};
        if (b.status       !== undefined) updates.status       = b.status;
        if (b.refundAmount !== undefined) updates.refundAmount = parseFloat(b.refundAmount);
        if (b.refundMethod !== undefined) updates.refundMethod = b.refundMethod;
        if (b.refundRef    !== undefined) updates.refundRef    = sanitize(b.refundRef, 100);
        if (b.adminNote    !== undefined) updates.adminNote    = sanitize(b.adminNote, 500);
        const ret = await ReturnRequest.findByIdAndUpdate(id, updates, { new: true });
        if (!ret) return res.status(404).json({ ok: false, error: 'Return পাওয়া যায়নি' });
        return res.json({ ok: true, return: ret });
      }

      /* POST: Approve + Process Refund */
      if (req.method === 'POST' && action === 'approve') {
        const { id, refundAmount, refundMethod, refundRef, restockItems, note } = req.body || {};
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const ret = await ReturnRequest.findById(id);
        if (!ret) return res.status(404).json({ ok: false, error: 'Return পাওয়া যায়নি' });
        if (ret.status !== 'pending') {
          return res.status(400).json({ ok: false, error: 'এই request ইতিমধ্যে process হয়েছে' });
        }
        const amt = parseFloat(refundAmount) || ret.refundAmount;
        ret.status = 'approved'; ret.refundAmount = amt;
        ret.refundMethod = refundMethod || ret.refundMethod;
        ret.refundRef    = sanitize(refundRef || '', 100);
        ret.adminNote    = sanitize(note || '', 300);
        ret.processedAt  = new Date(); ret.processedBy = 'admin';
        await ret.save();

        await Order.findOneAndUpdate(
          { orderId: ret.orderId },
          { status: 'refunded', $push: { statusHistory: { status: 'refunded', note: `Refunded ৳${amt}`, updatedBy: 'admin' } } }
        );

        if (restockItems && Array.isArray(ret.items)) {
          for (const item of ret.items) {
            const product = await Product.findOne({ productId: item.productId });
            if (product) {
              const before = product.stock;
              product.stock += item.qty;
              await product.save();
              await InventoryLog.create({
                productId: item.productId, productName: item.name,
                type: 'return', qty: item.qty, stockBefore: before, stockAfter: product.stock,
                ref: ret.returnId, refType: 'return', updatedBy: 'admin',
              });
            }
          }
        }

        sendEmail(
          ret.customerPhone + '@customer.shoplixo.shop',
          `✅ Return Approved — ${ret.returnId}`,
          returnApprovedEmail(ret, amt)
        ).catch(() => {});
        if (ret.customerPhone) {
          sendSMS(ret.customerPhone, smsTemplates.returnApproved(ret.returnId, amt)).catch(() => {});
        }

        return res.json({ ok: true, return: ret, message: `✅ Return approved! ৳${amt} refund দেওয়া হবে।` });
      }

      /* POST: Reject Return */
      if (req.method === 'POST' && action === 'reject') {
        const { id, note } = req.body || {};
        const ret = await ReturnRequest.findByIdAndUpdate(
          id,
          { status: 'rejected', adminNote: sanitize(note || '', 300), processedAt: new Date(), processedBy: 'admin' },
          { new: true }
        );
        if (!ret) return res.status(404).json({ ok: false, error: 'Return পাওয়া যায়নি' });
        await Order.findOneAndUpdate(
          { orderId: ret.orderId },
          { status: 'delivered', $push: { statusHistory: { status: 'delivered', note: 'Return rejected', updatedBy: 'admin' } } }
        );
        if (ret.customerPhone) {
          sendSMS(ret.customerPhone, `আপনার return request (${ret.returnId}) reject হয়েছে। কারণ: ${note || 'Policy অনুযায়ী'}। Shoplixo`).catch(() => {});
        }
        return res.json({ ok: true, return: ret, message: 'Return request reject করা হয়েছে' });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: NOTIFICATIONS
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'notifications') {
      const decoded = verifyToken(req);
      const admin   = isAdmin(req);

      if (!decoded && !admin) {
        return res.status(401).json({ ok: false, error: 'Login করুন' });
      }

      /* GET: My Notifications */
      if (req.method === 'GET' && !action) {
        const { page = 1 } = req.query;
        const skip  = (parseInt(page) - 1) * 20;
        const query = decoded
          ? { $or: [{ userId: decoded.id }, { isGlobal: true }] }
          : { isGlobal: true };
        const [notifications, total, unread] = await Promise.all([
          Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(20).lean(),
          Notification.countDocuments(query),
          Notification.countDocuments({ ...query, isRead: false }),
        ]);
        return res.json({ ok: true, notifications, total, unread, page: parseInt(page) });
      }

      /* GET: Unread Count */
      if (req.method === 'GET' && action === 'count') {
        const query = decoded
          ? { $or: [{ userId: decoded.id }, { isGlobal: true }], isRead: false }
          : { isGlobal: true, isRead: false };
        const count = await Notification.countDocuments(query);
        return res.json({ ok: true, count });
      }

      /* GET: Admin — All */
      if (req.method === 'GET' && action === 'all') {
        if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { page = 1, type } = req.query;
        const skip  = (parseInt(page) - 1) * 30;
        const query = {};
        if (type) query.type = type;
        const [notifications, total] = await Promise.all([
          Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(30).lean(),
          Notification.countDocuments(query),
        ]);
        return res.json({ ok: true, notifications, total });
      }

      /* POST: Mark as Read */
      if (req.method === 'POST' && action === 'read') {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const notif = await Notification.findByIdAndUpdate(id, { isRead: true }, { new: true });
        if (!notif) return res.status(404).json({ ok: false, error: 'পাওয়া যায়নি' });
        return res.json({ ok: true });
      }

      /* POST: Mark All Read */
      if (req.method === 'POST' && action === 'read-all') {
        if (!decoded) return res.status(401).json({ ok: false, error: 'Login করুন' });
        await Notification.updateMany(
          { $or: [{ userId: decoded.id }, { isGlobal: true }], isRead: false },
          { isRead: true }
        );
        return res.json({ ok: true, message: 'সব notification পড়া হয়েছে' });
      }

      /* POST: Broadcast (admin) */
      if (req.method === 'POST' && action === 'broadcast') {
        if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });
        const b = req.body || {};
        if (!b.title || !b.message) {
          return res.status(400).json({ ok: false, error: 'Title ও message দিন' });
        }
        const notif = await Notification.create({
          type: b.type || 'promo', title: sanitize(b.title, 100),
          message: sanitize(b.message, 500), icon: b.icon || '📢',
          link: sanitize(b.link || '', 200), isGlobal: true, channel: b.channel || 'app',
        });
        return res.json({ ok: true, notification: notif, message: '✅ Broadcast পাঠানো হয়েছে!' });
      }

      /* POST: Send to Specific User (admin) */
      if (req.method === 'POST' && action === 'send') {
        if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { userId, title, message, type, link, icon } = req.body || {};
        if (!userId || !title || !message) {
          return res.status(400).json({ ok: false, error: 'userId, title, message দিন' });
        }
        const notif = await Notification.create({
          userId, type: type || 'system', title: sanitize(title, 100),
          message: sanitize(message, 500), icon: icon || '🔔',
          link: sanitize(link || '', 200), isGlobal: false,
        });
        return res.json({ ok: true, notification: notif });
      }

      /* DELETE: Admin clear */
      if (req.method === 'DELETE' && admin) {
        const { id, before } = req.query;
        if (id) {
          await Notification.findByIdAndDelete(id);
          return res.json({ ok: true });
        }
        if (before) {
          const result = await Notification.deleteMany({ createdAt: { $lt: new Date(before) }, isRead: true });
          return res.json({ ok: true, deleted: result.deletedCount });
        }
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: SEED
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'seed') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const secret = req.query.secret;
      if (secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const products = req.body.products;
      if (!products || !products.length) {
        return res.status(400).json({ error: 'No products provided' });
      }
      await Product.deleteMany({});
      const formatted = products.map(p => ({ ...p, productId: String(p.id), isActive: true }));
      const result    = await Product.insertMany(formatted);
      return res.status(200).json({ ok: true, message: `${result.length} products imported!` });
    }

    /* ── Unknown module ────────────────────────────────────────── */
    return res.status(400).json({
      ok: false,
      error: 'Invalid module. Use: stats, returns, notifications, seed',
    });

  } catch (err) {
    console.error('System API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
