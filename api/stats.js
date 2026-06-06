/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/stats
 *  Live Site Statistics + Social Proof Data
 *
 *  GET /api/stats            → Live stats (orders today, revenue)
 *  GET /api/stats?action=live → Real-time counters (public)
 *  GET /api/stats?action=dashboard → Full admin dashboard stats
 *  POST /api/stats?action=visit → Track visitor (lightweight)
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, Order, User, Product, SiteStats, Newsletter } = require('../_db');
const { handleCors, isAdmin } = require('../_helpers');

// Cache to avoid DB hammering (30 second cache)
let statsCache = null;
let statsCacheTime = 0;
const CACHE_TTL = 30 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  const action = req.query?.action || '';

  try {
    await connectDB();

    /* ── POST: Track Visit ────────────────────────────────────── */
    if (req.method === 'POST' && action === 'visit') {
      const today = todayKey();
      await SiteStats.findOneAndUpdate(
        { date: today },
        { $inc: { visitors: 1 } },
        { upsert: true, new: true }
      );
      return res.json({ ok: true });
    }

    /* ── GET: Public Live Stats (no auth needed) ─────────────── */
    if (req.method === 'GET' && action === 'live') {
      const now = Date.now();
      if (statsCache && now - statsCacheTime < CACHE_TTL) {
        return res.json({ ok: true, ...statsCache });
      }

      const today    = todayKey();
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
        todayOrders,
        todayRevenue:   todayRevAgg[0]?.total || 0,
        totalOrders,
        totalCustomers,
        happyCustomers: Math.max(50000, totalCustomers * 5),
        onlineNow:      Math.floor(Math.random() * 80 + 20),
        lastUpdated:    new Date().toISOString(),
      };

      statsCache     = liveData;
      statsCacheTime = now;

      return res.json({ ok: true, ...liveData });
    }

    /* ── GET: Full Admin Dashboard Stats ─────────────────────── */
    if (req.method === 'GET' && action === 'dashboard') {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

      const today     = new Date(); today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const lastWeek  = new Date(today); lastWeek.setDate(lastWeek.getDate() - 7);
      const lastMonth = new Date(today); lastMonth.setMonth(lastMonth.getMonth() - 1);

      const [
        // Today stats
        todayOrderCount, todayRevenueAgg,
        // Yesterday stats
        yestOrderCount, yestRevenueAgg,
        // All time
        totalOrderCount, totalRevenueAgg,
        pendingOrders, shippedOrders, deliveredOrders,
        totalUsers, newUsersToday,
        totalProducts, lowStockProducts, outOfStock,
        newsletterCount,
        // Recent orders
        recentOrders,
        // Revenue by day (last 7 days)
        revenueByDay,
        // Top products
        topProducts,
        // Orders by status
        ordersByStatus,
        // Orders by district
        ordersByDistrict,
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
          orders:  todayOrderCount,
          revenue: todayRevenue,
          growth:  yestRevenue > 0 ? Math.round((todayRevenue - yestRevenue) / yestRevenue * 100) : 0,
        },
        totals: {
          orders: totalOrderCount, revenue: totalRevenue,
          avgOrder: Math.round(avgOrder),
          pending: pendingOrders, shipped: shippedOrders, delivered: deliveredOrders,
        },
        users: { total: totalUsers, newToday: newUsersToday, newsletter: newsletterCount },
        products: { total: totalProducts, lowStock: lowStockProducts, outOfStock },
        recentOrders,
        charts: { revenueByDay, topProducts, ordersByStatus, ordersByDistrict },
      });
    }

    /* ── GET: Default — public stats ─────────────────────────── */
    if (req.method === 'GET') {
      const [totalOrders, totalUsers, totalProducts] = await Promise.all([
        Order.countDocuments({ status: { $nin: ['cancelled'] } }),
        User.countDocuments({ isActive: true }),
        Product.countDocuments({ isActive: true }),
      ]);

      return res.json({
        ok: true,
        totalOrders,
        totalCustomers: Math.max(50000, totalUsers * 5),
        totalProducts,
        districts: 64,
        rating: 4.8,
      });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Stats API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};