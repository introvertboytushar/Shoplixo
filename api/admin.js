/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/admin  (Ultra Professional v4 — FIXED)
 *  ⚠️  Protected by x-admin-key header
 *
 *  ── DASHBOARD ────────────────────────────────────────────────
 *  GET  ?action=stats            → Full dashboard statistics
 *
 *  ── PRODUCTS ─────────────────────────────────────────────────
 *  GET  ?action=products         → Products list (paginated, filterable)
 *  GET  ?action=product&id=x     → Single product
 *  POST ?action=product-add      → নতুন product যোগ করুন
 *  POST ?action=product-edit     → Product আপডেট করুন
 *  POST ?action=product-delete   → Product মুছুন
 *  POST ?action=product-bulk     → Bulk operations (ids[] or category + stockIncrease)
 *
 *  ── ORDERS ───────────────────────────────────────────────────
 *  GET  ?action=orders           → Orders list (paginated, filterable, date range)
 *  GET  ?action=order&id=x       → Single order detail
 *  POST ?action=status           → Order status আপডেট
 *  POST ?action=payment-verify   → Payment verify করুন
 *
 *  ── RETURN REQUESTS ──────────────────────────────────────────
 *  GET  ?action=returns          → Return requests list
 *  POST ?action=return-update    → Return status আপডেট / Refund process
 *
 *  ── CUSTOMERS ────────────────────────────────────────────────
 *  GET  ?action=customers        → Users list
 *  POST ?action=customer-ban     → User ban/unban
 *
 *  ── COUPONS ──────────────────────────────────────────────────
 *  GET  ?action=coupons          → Coupon list
 *  POST ?action=coupon           → Coupon তৈরি / আপডেট
 *  POST ?action=coupon-delete    → Coupon মুছুন
 *  POST ?action=toggle-coupon    → Coupon on/off
 *
 *  ── REVIEWS ──────────────────────────────────────────────────
 *  GET  ?action=reviews          → All reviews (pending/approved/all)
 *  POST ?action=review-approve   → Review approve করুন
 *  POST ?action=review-delete    → Review মুছুন
 *  POST ?action=review-reply     → Admin reply দিন
 *
 *  ── FLASH SALES ──────────────────────────────────────────────
 *  GET  ?action=flash-sales      → Flash sale list
 *  POST ?action=flash-sale-add   → Flash sale তৈরি
 *  POST ?action=flash-sale-del   → Flash sale মুছুন
 *
 *  ── BUNDLES ──────────────────────────────────────────────────
 *  GET  ?action=bundles          → Bundle list
 *  POST ?action=bundle-add       → Bundle তৈরি
 *  POST ?action=bundle-edit      → Bundle আপডেট
 *  POST ?action=bundle-delete    → Bundle মুছুন
 *
 *  ── NEWSLETTER ───────────────────────────────────────────────
 *  GET  ?action=newsletter       → Subscribers list
 *  POST ?action=newsletter-del   → Subscriber মুছুন
 *
 *  ── ABANDONED CARTS ──────────────────────────────────────────
 *  GET  ?action=abandoned        → Abandoned carts
 *
 *  ── SUPPLIERS ────────────────────────────────────────────────
 *  GET  ?action=suppliers        → Supplier list
 *  POST ?action=supplier-add     → Supplier যোগ করুন
 *  POST ?action=supplier-edit    → Supplier আপডেট
 *  POST ?action=supplier-delete  → Supplier মুছুন
 *
 *  ── INVENTORY ────────────────────────────────────────────────
 *  GET  ?action=inventory        → Inventory log (filterable by product/type)
 *  POST ?action=inventory-add    → Manual stock entry
 *
 *  ── REFERRALS ────────────────────────────────────────────────
 *  GET  ?action=referrals        → Referral tracking data
 *
 *  ── NOTIFICATIONS ────────────────────────────────────────────
 *  POST ?action=notify-broadcast → Broadcast notification to all/segment users
 *
 *  ── SITE SETTINGS ────────────────────────────────────────────
 *  GET  ?action=settings         → Get all site settings
 *  POST ?action=settings         → Save site settings
 * ══════════════════════════════════════════════════════════════
 */

const {
  connectDB, Order, User, Product, Comment, Newsletter, Coupon,
  FlashSale, Bundle, AbandonedCart, LoyaltyTxn, SiteStats,
  Supplier, InventoryLog, ReturnRequest, Notification, Affiliate,
  Referral, SiteSettings, getSetting, setSetting, getSettings,
} = require('./_db');
const {
  handleCors, isAdmin, sanitize, sendEmail, sendSMS,
  orderStatusEmail, orderShippedSMS,
} = require('./_helpers');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  // ✅ Strong cache prevention — admin responses must never be cached
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized. Admin key লাগবে।' });
  }

  const action = req.query?.action || '';
  await connectDB();

  /* ═══════════════════════════════════════════════════════════
     ── DASHBOARD STATS ─────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'stats' && req.method === 'GET') {
    try {
      const now       = new Date();
      const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthE= new Date(now.getFullYear(), now.getMonth(), 0);

      const [
        totalOrders, totalRevObj, totalUsers, pendingOrders,
        todayOrders, monthOrders, lastMonthOrders,
        todayRevObj, monthRevObj, lastMonthRevObj,
        statusBreakdown, revenueByDayRaw, topProductsRaw,
        totalProducts, lowStockProducts, pendingReviews, newsletterCount,
        pendingReturns, abandonedCount,
      ] = await Promise.all([
        Order.countDocuments(),
        Order.aggregate([{ $match: { status: { $nin: ['cancelled','refunded'] } } }, { $group: { _id: null, total: { $sum: '$pricing.total' } } }]),
        User.countDocuments(),
        Order.countDocuments({ status: 'pending' }),
        Order.countDocuments({ createdAt: { $gte: today } }),
        Order.countDocuments({ createdAt: { $gte: thisMonth } }),
        Order.countDocuments({ createdAt: { $gte: lastMonth, $lte: lastMonthE } }),
        Order.aggregate([{ $match: { createdAt: { $gte: today }, status: { $nin: ['cancelled'] } } }, { $group: { _id: null, total: { $sum: '$pricing.total' } } }]),
        Order.aggregate([{ $match: { createdAt: { $gte: thisMonth }, status: { $nin: ['cancelled'] } } }, { $group: { _id: null, total: { $sum: '$pricing.total' } } }]),
        Order.aggregate([{ $match: { createdAt: { $gte: lastMonth, $lte: lastMonthE }, status: { $nin: ['cancelled'] } } }, { $group: { _id: null, total: { $sum: '$pricing.total' } } }]),
        Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Order.aggregate([
          { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 86400000) }, status: { $nin: ['cancelled','refunded'] } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        Order.aggregate([
          { $match: { status: { $nin: ['cancelled','refunded'] } } },
          { $unwind: '$items' },
          { $group: { _id: '$items.name', totalQty: { $sum: '$items.qty' }, totalRev: { $sum: { $multiply: ['$items.price', '$items.qty'] } }, img: { $first: '$items.img' } } },
          { $sort: { totalQty: -1 } }, { $limit: 5 },
        ]),
        Product.countDocuments({ isActive: true }),
        Product.countDocuments({ stock: { $lte: 5 }, isActive: true }),
        Comment.countDocuments({ isApproved: false, isHidden: false }),
        Newsletter.countDocuments({ isActive: true }),
        ReturnRequest.countDocuments({ status: 'pending' }).catch(() => 0),
        AbandonedCart.countDocuments({ isConverted: false, createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } }).catch(() => 0),
      ]);

      const totalRev     = totalRevObj[0]?.total     || 0;
      const todayRev     = todayRevObj[0]?.total     || 0;
      const monthRev     = monthRevObj[0]?.total     || 0;
      const lastMonthRev = lastMonthRevObj[0]?.total || 0;
      const revenueGrowth = lastMonthRev > 0 ? Math.round(((monthRev - lastMonthRev) / lastMonthRev) * 100) : 0;
      const orderGrowth   = lastMonthOrders > 0 ? Math.round(((monthOrders - lastMonthOrders) / lastMonthOrders) * 100) : 0;

      return res.json({
        ok: true,
        stats: {
          totalOrders, totalRev, totalUsers, pendingOrders,
          todayOrders, todayRev, monthOrders, monthRev,
          revenueGrowth, orderGrowth,
          totalProducts, lowStockProducts, pendingReviews, newsletterCount,
          pendingReturns, abandonedCount,
        },
        statusBreakdown: statusBreakdown.map(s => ({ status: s._id, count: s.count })),
        revenueByDay: revenueByDayRaw.map(d => ({ date: d._id, revenue: d.revenue, orders: d.orders })),
        topProducts:  topProductsRaw.map(p => ({ name: p._id, qty: p.totalQty, revenue: p.totalRev, img: p.img })),
      });
    } catch (err) {
      console.error('Stats error:', err);
      return res.status(500).json({ ok: false, error: 'Stats লোড হয়নি' });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     ── PRODUCTS LIST ───────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'products' && req.method === 'GET') {
    try {
      const page   = Math.max(1, parseInt(req.query?.page  || '1'));
      const limit  = Math.min(200, parseInt(req.query?.limit || '20'));
      const search = sanitize(req.query?.search || '', 100);
      const cat    = sanitize(req.query?.cat    || '', 50);
      const badge  = sanitize(req.query?.badge  || '', 20);
      const stock  = req.query?.stock;
      const skip   = (page - 1) * limit;
      const sort   = req.query?.sort || 'newest';

      const query = {};
      if (cat)   query.cat   = cat;
      if (badge) query.badge = badge;
      if (stock === 'low') query.stock = { $gt: 0, $lte: 10 };
      if (stock === 'out') query.stock = 0;
      if (search) {
        query.$or = [
          { name:      { $regex: search, $options: 'i' } },
          { productId: { $regex: search, $options: 'i' } },
          { sku:       { $regex: search, $options: 'i' } },
          { tags:      { $in: [new RegExp(search, 'i')] } },
        ];
      }

      const sortMap = {
        newest:   { createdAt: -1 }, oldest:   { createdAt: 1 },
        price_hi: { price: -1 },    price_lo: { price: 1 },
        stock_lo: { stock: 1 },     sold:     { totalSold: -1 },
      };

      const [products, total] = await Promise.all([
        Product.find(query).sort(sortMap[sort] || { createdAt: -1 }).skip(skip).limit(limit).select('-__v'),
        Product.countDocuments(query),
      ]);

      return res.json({ ok: true, products, total, pagination: { page, limit, pages: Math.ceil(total / limit) } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Products লোড হয়নি' });
    }
  }

  /* ── SINGLE PRODUCT ─────────────────────────────────────── */
  if (action === 'product' && req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, error: 'Product ID দিন' });
    const product = await Product.findOne({ $or: [{ productId: id }, { _id: id.length === 24 ? id : null }] });
    if (!product) return res.status(404).json({ ok: false, error: 'Product পাওয়া যায়নি' });
    return res.json({ ok: true, product });
  }

  /* ── ADD PRODUCT ─────────────────────────────────────────── */
  if (action === 'product-add' && req.method === 'POST') {
    try {
      const b = req.body || {};
      if (!b.name?.trim()) return res.status(400).json({ ok: false, error: 'Product নাম দিন' });
      if (!b.cat?.trim())  return res.status(400).json({ ok: false, error: 'Category দিন' });
      if (!b.price)        return res.status(400).json({ ok: false, error: 'Price দিন' });
      if (!b.img?.trim())  return res.status(400).json({ ok: false, error: 'Image URL দিন' });

      const count = await Product.countDocuments();
      const productId = b.productId?.trim() || `SL-${String(count + 1).padStart(4, '0')}`;

      const existing = await Product.findOne({ productId });
      if (existing) return res.status(409).json({ ok: false, error: `Product ID "${productId}" আগে থেকেই আছে` });

      const product = await Product.create({
        productId: sanitize(productId, 30),
        name:      sanitize(b.name, 200),
        cat:       sanitize(b.cat, 50),
        price:     parseFloat(b.price),
        orig:      b.orig ? parseFloat(b.orig) : undefined,
        img:       sanitize(b.img, 500),
        images:    Array.isArray(b.images) ? b.images.slice(0, 10).map(i => sanitize(i, 500)) : [],
        badge:     ['hot','new','sale','sold','best','trending','exclusive'].includes(b.badge) ? b.badge : 'new',
        rating:    parseFloat(b.rating) || 5,
        reviews:   parseInt(b.reviews) || 0,
        stock:     parseInt(b.stock) ?? 100,
        viewers:   parseInt(b.viewers) || Math.floor(Math.random() * 20 + 5),
        isFeatured:Boolean(b.isFeatured),
        isNew:     b.isNew !== false,
        isFlash:   Boolean(b.isFlash),
        isActive:  b.isActive !== false,
        sizes:     Array.isArray(b.sizes) ? b.sizes : (b.sizes ? String(b.sizes).split(',').map(s => s.trim()) : []),
        colors:    Array.isArray(b.colors) ? b.colors : (b.colors ? String(b.colors).split(',').map(s => s.trim()) : []),
        material:  sanitize(b.material || '', 200),
        warranty:  sanitize(b.warranty || '', 100),
        sku:       sanitize(b.sku || '', 50),
        tags:      Array.isArray(b.tags) ? b.tags : (b.tags ? String(b.tags).split(',').map(s => s.trim()) : []),
        desc:      sanitize(b.desc || '', 3000),
        videoUrl:  sanitize(b.videoUrl || '', 500),
        weight:    b.weight ? parseFloat(b.weight) : undefined,
        seoTitle:  sanitize(b.seoTitle || '', 200),
        seoDesc:   sanitize(b.seoDesc || '', 500),
      });

      return res.status(201).json({ ok: true, product, message: '✅ Product সফলভাবে যোগ হয়েছে!' });
    } catch (err) {
      console.error('Product add error:', err);
      return res.status(500).json({ ok: false, error: err.message || 'Product যোগ হয়নি' });
    }
  }

  /* ── EDIT PRODUCT ─────────────────────────────────────────── */
  if (action === 'product-edit' && req.method === 'POST') {
    try {
      const b  = req.body || {};
      const id = b.productId || b._id;
      if (!id) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const updates = {};
      const fields = ['name','cat','img','desc','material','warranty','sku','videoUrl','seoTitle','seoDesc','badge'];
      fields.forEach(f => { if (b[f] !== undefined) updates[f] = sanitize(String(b[f]), f === 'desc' ? 3000 : 500); });

      if (b.price      !== undefined) updates.price      = parseFloat(b.price);
      if (b.orig       !== undefined) updates.orig       = parseFloat(b.orig);
      if (b.stock      !== undefined) updates.stock      = parseInt(b.stock);
      if (b.rating     !== undefined) updates.rating     = parseFloat(b.rating);
      if (b.reviews    !== undefined) updates.reviews    = parseInt(b.reviews);
      if (b.viewers    !== undefined) updates.viewers    = parseInt(b.viewers);
      if (b.isFeatured !== undefined) updates.isFeatured = Boolean(b.isFeatured);
      if (b.isNew      !== undefined) updates.isNew      = Boolean(b.isNew);
      if (b.isFlash    !== undefined) updates.isFlash    = Boolean(b.isFlash);
      if (b.isActive   !== undefined) updates.isActive   = Boolean(b.isActive);
      if (b.weight     !== undefined) updates.weight     = parseFloat(b.weight);

      if (b.images !== undefined)
        updates.images = Array.isArray(b.images) ? b.images.slice(0,10).map(i => sanitize(i,500)) : [];
      if (b.sizes !== undefined)
        updates.sizes  = Array.isArray(b.sizes)  ? b.sizes  : String(b.sizes).split(',').map(s => s.trim());
      if (b.colors !== undefined)
        updates.colors = Array.isArray(b.colors) ? b.colors : String(b.colors).split(',').map(s => s.trim());
      if (b.tags !== undefined)
        updates.tags   = Array.isArray(b.tags)   ? b.tags   : String(b.tags).split(',').map(s => s.trim());

      const product = await Product.findOneAndUpdate(
        { $or: [{ productId: id }, { _id: id.length === 24 ? id : undefined }] },
        updates, { new: true }
      );
      if (!product) return res.status(404).json({ ok: false, error: 'Product পাওয়া যায়নি' });
      return res.json({ ok: true, product, message: '✅ Product আপডেট হয়েছে!' });
    } catch (err) {
      console.error('Product edit error:', err);
      return res.status(500).json({ ok: false, error: 'Update হয়নি' });
    }
  }

  /* ── DELETE PRODUCT ───────────────────────────────────────── */
  if (action === 'product-delete' && req.method === 'POST') {
    const id = req.body?.productId || req.body?.id;
    if (!id) return res.status(400).json({ ok: false, error: 'Product ID দিন' });
    const product = await Product.findOneAndDelete({ $or: [{ productId: id }, { _id: id.length === 24 ? id : undefined }] });
    if (!product) return res.status(404).json({ ok: false, error: 'Product পাওয়া যায়নি' });
    return res.json({ ok: true, message: `"${product.name}" delete হয়েছে` });
  }

  /* ── BULK PRODUCT OPERATIONS (FIXED: supports category + stockIncrease) ── */
  if (action === 'product-bulk' && req.method === 'POST') {
    const { ids, operation, category, stockIncrease } = req.body || {};

    // Build filter: use ids[] if provided, else use category
    let filter = {};
    if (Array.isArray(ids) && ids.length) {
      filter = { productId: { $in: ids } };
    } else if (category) {
      filter = { cat: category, isActive: true };
    } else {
      // No filter = all active products
      filter = { isActive: true };
    }

    try {
      let result;
      switch (operation) {
        case 'delete':
          result = await Product.deleteMany(filter);
          return res.json({ ok: true, message: `${result.deletedCount}টি product delete হয়েছে` });
        case 'feature':
          result = await Product.updateMany(filter, { isFeatured: true });
          return res.json({ ok: true, message: `${result.modifiedCount}টি product featured করা হয়েছে` });
        case 'unfeature':
          result = await Product.updateMany(filter, { isFeatured: false });
          return res.json({ ok: true, message: `${result.modifiedCount}টি product unfeatured হয়েছে` });
        case 'flash':
          result = await Product.updateMany(filter, { isFlash: true });
          return res.json({ ok: true, message: `${result.modifiedCount}টি product flash sale-এ যোগ হয়েছে` });
        case 'unflash':
          result = await Product.updateMany(filter, { isFlash: false });
          return res.json({ ok: true, message: `${result.modifiedCount}টি product flash sale থেকে বাদ হয়েছে` });
        case 'activate':
          if (stockIncrease && stockIncrease > 0) {
            // Stock increase operation
            result = await Product.updateMany(filter, { $inc: { stock: parseInt(stockIncrease) } });
            return res.json({ ok: true, message: `${result.modifiedCount}টি product-এ +${stockIncrease} stock যোগ হয়েছে` });
          }
          result = await Product.updateMany(filter, { isActive: true });
          return res.json({ ok: true, message: `${result.modifiedCount}টি product activate হয়েছে` });
        case 'deactivate':
          result = await Product.updateMany(filter, { isActive: false });
          return res.json({ ok: true, message: `${result.modifiedCount}টি product deactivate হয়েছে` });
        case 'stock-increase':
          if (!stockIncrease || stockIncrease <= 0) return res.status(400).json({ ok: false, error: 'stockIncrease দিন' });
          result = await Product.updateMany(filter, { $inc: { stock: parseInt(stockIncrease) } });
          return res.json({ ok: true, message: `${result.modifiedCount}টি product-এ +${stockIncrease} stock যোগ হয়েছে` });
        default:
          return res.status(400).json({ ok: false, error: 'Invalid operation. Valid: delete, feature, unfeature, flash, unflash, activate, deactivate, stock-increase' });
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Bulk operation failed: ' + err.message });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     ── ORDERS LIST ──────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'orders' && req.method === 'GET') {
    try {
      const page    = Math.max(1, parseInt(req.query?.page    || '1'));
      const limit   = Math.min(100, parseInt(req.query?.limit || '20'));
      const search  = sanitize(req.query?.search  || '', 100);
      const status  = sanitize(req.query?.status  || '', 50);
      const payment = sanitize(req.query?.payment || '', 50);
      const from    = req.query?.from;
      const to      = req.query?.to;
      const skip    = (page - 1) * limit;

      const query = {};
      if (status)  query.status            = status;
      if (payment) query['payment.method'] = payment;
      if (from || to) {
        query.createdAt = {};
        if (from) query.createdAt.$gte = new Date(from);
        if (to)   query.createdAt.$lte = new Date(to + 'T23:59:59');
      }
      if (search) {
        query.$or = [
          { orderId:          { $regex: search, $options: 'i' } },
          { 'customer.name':  { $regex: search, $options: 'i' } },
          { 'customer.phone': { $regex: search, $options: 'i' } },
        ];
      }

      const [orders, total] = await Promise.all([
        Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-ip -userAgent -__v'),
        Order.countDocuments(query),
      ]);

      return res.json({
        ok: true,
        orders: orders.map(o => ({
          _id: o._id, orderId: o.orderId,
          name: o.customer.name, phone: o.customer.phone,
          district: o.customer.district, address: o.customer.address,
          email: o.customer.email, note: o.customer.note,
          items: o.items, itemCount: o.items.reduce((s, i) => s + i.qty, 0),
          subtotal: o.pricing.subtotal, discount: o.pricing.discount,
          shipping: o.pricing.shipping, total: o.pricing.total,
          coupon: o.pricing.coupon,
          payment: o.payment.method, payStatus: o.payment.status,
          trxId: o.payment.transactionId,
          status: o.status, tracking: o.tracking,
          statusHistory: o.statusHistory,
          loyaltyPointsEarned: o.loyaltyPointsEarned,
          createdAt: o.createdAt,
        })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Orders লোড হয়নি' });
    }
  }

  /* ── SINGLE ORDER ─────────────────────────────────────────── */
  if (action === 'order' && req.method === 'GET') {
    const id = sanitize(req.query?.id || '', 30).toUpperCase();
    if (!id) return res.status(400).json({ ok: false, error: 'Order ID দিন' });
    const order = await Order.findOne({ orderId: id }).select('-__v');
    if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });
    return res.json({ ok: true, order });
  }

  /* ── UPDATE ORDER STATUS ─────────────────────────────────── */
  if (action === 'status' && req.method === 'POST') {
    const b       = req.body || {};
    const id      = sanitize(b.id || b.orderId || '', 20).toUpperCase();
    const status  = sanitize(b.status  || '', 50);
    const note    = sanitize(b.note    || '', 300);
    const courier = sanitize(b.courier || '', 100);
    const trackId = sanitize(b.trackId || b.tracking || '', 100);

    const validStatuses = ['pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled','refunded'];
    if (!id || !validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Order ID এবং valid status দিন (pending/confirmed/processing/shipped/out_for_delivery/delivered/cancelled/refunded)' });
    }

    try {
      // Check current status to prevent duplicate cancel
      const existingOrder = await Order.findOne({ orderId: id }).select('status').lean();
      if (!existingOrder) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });
      if (existingOrder.status === status && status === 'cancelled') {
        return res.json({ ok: true, message: `Order ইতিমধ্যে ${status} আছে`, orderId: id, alreadyInStatus: true });
      }
      const updateObj = {
        status,
        $push: {
          statusHistory: { status, note: note || `Status → ${status}`, updatedBy: 'admin', updatedAt: new Date() },
        },
      };
      if (courier || trackId) {
        updateObj['tracking.courier']    = courier;
        updateObj['tracking.trackingId'] = trackId;
      }

      const order = await Order.findOneAndUpdate({ orderId: id }, updateObj, { new: true });
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

      // Loyalty points on delivery
      if (status === 'delivered') {
        const earned = Math.floor((order.pricing.total || 0) / 10);
        await User.findOneAndUpdate(
          { phone: order.customer.phone },
          { $inc: { totalOrders: 1, totalSpent: order.pricing.total, loyaltyPoints: earned } }
        ).catch(() => {});
        await Order.findOneAndUpdate({ orderId: id }, { loyaltyPointsEarned: earned });
      }

      // Send notifications (non-blocking)
      if (order.customer.email) {
        sendEmail(order.customer.email, `অর্ডার আপডেট — ${id} | Shoplixo`, orderStatusEmail(order, status, trackId, courier)).catch(() => {});
      }
      if (status === 'shipped' && order.customer.phone) {
        sendSMS(order.customer.phone, orderShippedSMS(id, courier, trackId)).catch(() => {});
      }

      return res.json({ ok: true, message: `✅ Status → ${status}`, orderId: id });
    } catch (err) {
      console.error('Status update error:', err);
      return res.status(500).json({ ok: false, error: 'Update হয়নি' });
    }
  }

  /* ── PAYMENT VERIFY ──────────────────────────────────────── */
  if (action === 'payment-verify' && req.method === 'POST') {
    const { orderId, payStatus } = req.body || {};
    if (!orderId) return res.status(400).json({ ok: false, error: 'Order ID দিন' });
    const st = ['verified','failed','pending'].includes(payStatus) ? payStatus : 'verified';
    const order = await Order.findOneAndUpdate(
      { orderId: orderId.toUpperCase() },
      { 'payment.status': st },
      { new: true }
    );
    if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });
    return res.json({ ok: true, message: `Payment ${st}` });
  }

  /* ═══════════════════════════════════════════════════════════
     ── RETURN REQUESTS ──────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'returns' && req.method === 'GET') {
    try {
      const page    = Math.max(1, parseInt(req.query?.page  || '1'));
      const limit   = Math.min(50, parseInt(req.query?.limit || '20'));
      const status  = sanitize(req.query?.status || '', 30);
      const skip    = (page - 1) * limit;
      const query   = status ? { status } : {};

      const [returns, total] = await Promise.all([
        ReturnRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v'),
        ReturnRequest.countDocuments(query),
      ]);

      const stats = await ReturnRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, totalRefund: { $sum: '$refundAmount' } } },
      ]);

      return res.json({
        ok: true, returns, total,
        pagination: { page, limit, pages: Math.ceil(total / limit) },
        stats: Object.fromEntries(stats.map(s => [s._id, { count: s.count, totalRefund: s.totalRefund }])),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Returns লোড হয়নি: ' + err.message });
    }
  }

  if (action === 'return-update' && req.method === 'POST') {
    try {
      const b = req.body || {};
      const { returnId, status, adminNote, refundAmount, refundMethod, refundRef } = b;
      if (!returnId || !status) return res.status(400).json({ ok: false, error: 'returnId এবং status দিন' });

      const validStatuses = ['pending','approved','rejected','refunded','completed'];
      if (!validStatuses.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });

      const updates = {
        status,
        adminNote: sanitize(adminNote || '', 500),
        processedAt: new Date(),
        processedBy: 'admin',
      };
      if (refundAmount) updates.refundAmount = parseFloat(refundAmount);
      if (refundMethod) updates.refundMethod = refundMethod;
      if (refundRef)    updates.refundRef    = sanitize(refundRef, 100);

      const ret = await ReturnRequest.findOneAndUpdate({ returnId }, updates, { new: true });
      if (!ret) return res.status(404).json({ ok: false, error: 'Return Request পাওয়া যায়নি' });

      // If approved/refunded — update order status
      if (status === 'refunded' || status === 'completed') {
        await Order.findOneAndUpdate(
          { orderId: ret.orderId },
          { status: 'returned', $push: { statusHistory: { status: 'returned', note: `Return ${status} by admin`, updatedBy: 'admin', updatedAt: new Date() } } }
        ).catch(() => {});
      }

      return res.json({ ok: true, return: ret, message: `Return ${status}` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Update হয়নি: ' + err.message });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     ── CUSTOMERS ────────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'customers' && req.method === 'GET') {
    try {
      const page   = Math.max(1, parseInt(req.query?.page  || '1'));
      const limit  = Math.min(100, parseInt(req.query?.limit|| '20'));
      const search = sanitize(req.query?.search || '', 100);
      const skip   = (page - 1) * limit;
      const query  = {};
      if (search) {
        query.$or = [
          { name:  { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ];
      }
      const [users, total] = await Promise.all([
        User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-password -otp -otpExpiry -__v'),
        User.countDocuments(query),
      ]);
      return res.json({ ok: true, users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Customers লোড হয়নি' });
    }
  }

  if (action === 'customer-ban' && req.method === 'POST') {
    const { userId, ban } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, error: 'User ID দিন' });
    const user = await User.findByIdAndUpdate(userId, { isActive: !ban }, { new: true });
    if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });
    return res.json({ ok: true, message: ban ? 'User ban হয়েছে' : 'User unban হয়েছে' });
  }

  /* ═══════════════════════════════════════════════════════════
     ── REVIEWS ──────────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'reviews' && req.method === 'GET') {
    try {
      const page   = Math.max(1, parseInt(req.query?.page  || '1'));
      const limit  = Math.min(50, parseInt(req.query?.limit || '20'));
      const filter = req.query?.filter || 'all';
      const rating = req.query?.rating;
      const skip   = (page - 1) * limit;
      const query  = {};
      if (filter === 'pending')  { query.isApproved = false; query.isHidden = false; }
      if (filter === 'approved') { query.isApproved = true; }
      if (filter === 'hidden')   { query.isHidden = true; }
      if (rating) {
        const rArr = String(rating).split(',').map(n => parseInt(n.trim())).filter(Boolean);
        if (rArr.length > 1) query.rating = { $in: rArr };
        else if (rArr.length === 1) query.rating = rArr[0];
      }
      const [comments, total] = await Promise.all([
        Comment.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v'),
        Comment.countDocuments(query),
      ]);
      return res.json({ ok: true, comments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Reviews লোড হয়নি' });
    }
  }

  if (action === 'review-approve' && req.method === 'POST') {
    const { id, hide } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Review ID দিন' });
    const update = hide
      ? { isHidden: true,  isApproved: false }
      : { isApproved: true, isHidden: false };
    const comment = await Comment.findByIdAndUpdate(id, update, { new: true });
    if (!comment) return res.status(404).json({ ok: false, error: 'Review পাওয়া যায়নি' });
    const agg = await Comment.aggregate([
      { $match: { productId: comment.productId, isApproved: true } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    if (agg.length) {
      await Product.updateOne({ productId: comment.productId }, {
        rating: Math.round(agg[0].avg * 10) / 10, reviews: agg[0].count,
      });
    }
    return res.json({ ok: true, message: hide ? 'Review hidden হয়েছে' : 'Review approve হয়েছে' });
  }

  if (action === 'review-delete' && req.method === 'POST') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Review ID দিন' });
    const comment = await Comment.findByIdAndDelete(id);
    if (!comment) return res.status(404).json({ ok: false, error: 'Review পাওয়া যায়নি' });
    return res.json({ ok: true, message: 'Review delete হয়েছে' });
  }

  if (action === 'review-reply' && req.method === 'POST') {
    const { id, text } = req.body || {};
    if (!id || !text) return res.status(400).json({ ok: false, error: 'ID এবং reply text দিন' });
    const comment = await Comment.findByIdAndUpdate(id,
      { reply: { text: sanitize(text, 500), repliedAt: new Date() } }, { new: true });
    if (!comment) return res.status(404).json({ ok: false, error: 'Review পাওয়া যায়নি' });
    return res.json({ ok: true, message: 'Reply দেওয়া হয়েছে' });
  }

  /* ═══════════════════════════════════════════════════════════
     ── FLASH SALES ──────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'flash-sales' && req.method === 'GET') {
    const sales = await FlashSale.find().sort({ createdAt: -1 }).limit(20).lean();
    return res.json({ ok: true, sales });
  }

  if (action === 'flash-sale-add' && req.method === 'POST') {
    const b = req.body || {};
    if (!b.title || !b.startAt || !b.endAt)
      return res.status(400).json({ ok: false, error: 'Title, startAt, endAt দিন' });
    const sale = await FlashSale.create({
      title:            sanitize(b.title, 200),
      description:      sanitize(b.description || '', 500),
      startAt:          new Date(b.startAt),
      endAt:            new Date(b.endAt),
      isActive:         true,
      bannerImg:        sanitize(b.bannerImg || '', 500),
      extraDiscountPct: parseFloat(b.extraDiscountPct) || 0,
      products: Array.isArray(b.products) ? b.products.map(p => ({
        productId: p.productId, salePrice: parseFloat(p.salePrice),
        origPrice: parseFloat(p.origPrice), stock: parseInt(p.stock) || 100,
      })) : [],
    });
    if (sale.products.length) {
      await Product.updateMany({ productId: { $in: sale.products.map(p => p.productId) } }, { isFlash: true });
    }
    return res.status(201).json({ ok: true, sale, message: 'Flash Sale তৈরি হয়েছে' });
  }

  if (action === 'flash-sale-del' && req.method === 'POST') {
    const { id } = req.body || {};
    const sale = await FlashSale.findByIdAndDelete(id);
    if (!sale) return res.status(404).json({ ok: false, error: 'Flash Sale পাওয়া যায়নি' });
    return res.json({ ok: true, message: 'Flash Sale delete হয়েছে' });
  }

  /* ═══════════════════════════════════════════════════════════
     ── BUNDLES ──────────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'bundles' && req.method === 'GET') {
    const bundles = await Bundle.find().sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ ok: true, bundles });
  }

  if (action === 'bundle-add' && req.method === 'POST') {
    const b = req.body || {};
    if (!b.title || !Array.isArray(b.productIds) || b.productIds.length < 2 || !b.discountValue)
      return res.status(400).json({ ok: false, error: 'Title, কমপক্ষে ২টি product ID এবং discount দিন' });
    const bundle = await Bundle.create({
      title:         sanitize(b.title, 200),
      description:   sanitize(b.description || '', 500),
      productIds:    b.productIds,
      discountType:  b.discountType === 'flat' ? 'flat' : 'percent',
      discountValue: parseFloat(b.discountValue),
      img:           sanitize(b.img || '', 500),
      isActive:      true,
      startAt:       b.startAt ? new Date(b.startAt) : undefined,
      endAt:         b.endAt   ? new Date(b.endAt)   : undefined,
    });
    await Product.updateMany({ productId: { $in: b.productIds } }, { $addToSet: { bundleIds: bundle._id.toString() } });
    return res.status(201).json({ ok: true, bundle, message: 'Bundle তৈরি হয়েছে' });
  }

  if (action === 'bundle-edit' && req.method === 'POST') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Bundle ID দিন' });
    const allowed = ['title','description','discountType','discountValue','isActive','img','productIds'];
    const clean = {};
    allowed.forEach(f => { if (updates[f] !== undefined) clean[f] = updates[f]; });
    const bundle = await Bundle.findByIdAndUpdate(id, clean, { new: true });
    if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
    return res.json({ ok: true, bundle, message: 'Bundle update হয়েছে' });
  }

  if (action === 'bundle-delete' && req.method === 'POST') {
    const { id } = req.body || {};
    const bundle = await Bundle.findByIdAndDelete(id);
    if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
    return res.json({ ok: true, message: 'Bundle delete হয়েছে' });
  }

  /* ═══════════════════════════════════════════════════════════
     ── COUPONS ──────────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'coupons' && req.method === 'GET') {
    const coupons = await Coupon.find().sort({ createdAt: -1 }).select('-__v');
    return res.json({ ok: true, coupons });
  }

  if (action === 'coupon' && req.method === 'POST') {
    const b    = req.body || {};
    const code = sanitize(b.code || '', 30).toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: 'Coupon code দিন' });
    const data = {
      code, type: b.type || 'percent',
      discount:    parseFloat(b.discount || 10),
      minOrder:    parseFloat(b.minOrder  || 0),
      maxUses:     parseInt(b.maxUses     || 0),
      isActive:    b.isActive !== false,
      description: sanitize(b.description || '', 200),
    };
    if (b.expiresAt) data.expiresAt = new Date(b.expiresAt);
    const coupon = await Coupon.findOneAndUpdate({ code }, { $set: data }, { upsert: true, new: true });
    return res.json({ ok: true, coupon, message: 'Coupon saved!' });
  }

  if (action === 'toggle-coupon' && req.method === 'POST') {
    const code = sanitize(req.body?.code || '', 30).toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: 'Code দিন' });
    const c = await Coupon.findOne({ code });
    if (!c) return res.status(404).json({ ok: false, error: 'Coupon পাওয়া যায়নি' });
    c.isActive = !c.isActive;
    await c.save();
    return res.json({ ok: true, isActive: c.isActive });
  }

  if (action === 'coupon-delete' && req.method === 'POST') {
    const code = sanitize(req.body?.code || '', 30).toUpperCase();
    const c = await Coupon.findOneAndDelete({ code });
    if (!c) return res.status(404).json({ ok: false, error: 'Coupon পাওয়া যায়নি' });
    return res.json({ ok: true, message: `Coupon "${code}" delete হয়েছে` });
  }

  /* ═══════════════════════════════════════════════════════════
     ── NEWSLETTER ───────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'newsletter' && req.method === 'GET') {
    const page  = Math.max(1, parseInt(req.query?.page  || '1'));
    const limit = Math.min(100, parseInt(req.query?.limit || '50'));
    const skip  = (page - 1) * limit;
    const [subscribers, total] = await Promise.all([
      Newsletter.find({ isActive: true }).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v'),
      Newsletter.countDocuments({ isActive: true }),
    ]);
    return res.json({ ok: true, subscribers, total, pagination: { page, limit, pages: Math.ceil(total / limit) } });
  }

  if (action === 'newsletter-del' && req.method === 'POST') {
    const { email } = req.body || {};
    await Newsletter.findOneAndUpdate({ email }, { isActive: false });
    return res.json({ ok: true, message: 'Subscriber remove হয়েছে' });
  }

  /* ═══════════════════════════════════════════════════════════
     ── ABANDONED CARTS ──────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'abandoned' && req.method === 'GET') {
    const page  = Math.max(1, parseInt(req.query?.page  || '1'));
    const limit = Math.min(50, parseInt(req.query?.limit || '20'));
    const skip  = (page - 1) * limit;
    const [carts, total] = await Promise.all([
      AbandonedCart.find({ isConverted: false }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AbandonedCart.countDocuments({ isConverted: false }),
    ]);
    const totalValue = await AbandonedCart.aggregate([
      { $match: { isConverted: false } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);
    return res.json({ ok: true, carts, total, totalValue: totalValue[0]?.total || 0, pagination: { page, limit, pages: Math.ceil(total / limit) } });
  }

  /* ═══════════════════════════════════════════════════════════
     ── SUPPLIERS ────────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'suppliers' && req.method === 'GET') {
    try {
      const page   = Math.max(1, parseInt(req.query?.page  || '1'));
      const limit  = Math.min(50, parseInt(req.query?.limit || '20'));
      const search = sanitize(req.query?.search || '', 100);
      const skip   = (page - 1) * limit;
      const query  = search
        ? { $or: [{ name: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }] }
        : {};
      const [suppliers, total] = await Promise.all([
        Supplier.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v'),
        Supplier.countDocuments(query),
      ]);
      return res.json({ ok: true, suppliers, total, pagination: { page, limit, pages: Math.ceil(total / limit) } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Suppliers লোড হয়নি: ' + err.message });
    }
  }

  if (action === 'supplier-add' && req.method === 'POST') {
    try {
      const b = req.body || {};
      if (!b.name || !b.phone) return res.status(400).json({ ok: false, error: 'Name এবং phone দিন' });
      const count = await Supplier.countDocuments();
      const supplierId = b.supplierId?.trim() || `SUP-${String(count + 1).padStart(4, '0')}`;
      const existing = await Supplier.findOne({ supplierId });
      if (existing) return res.status(409).json({ ok: false, error: 'Supplier ID already exists' });

      const supplier = await Supplier.create({
        supplierId,
        name:         sanitize(b.name, 200),
        company:      sanitize(b.company || '', 200),
        phone:        sanitize(b.phone, 20),
        email:        sanitize(b.email || '', 150),
        address:      sanitize(b.address || '', 500),
        country:      sanitize(b.country || 'Bangladesh', 100),
        website:      sanitize(b.website || '', 300),
        type:         ['local','china','india','other'].includes(b.type) ? b.type : 'local',
        paymentTerms: sanitize(b.paymentTerms || '', 200),
        deliveryTime: sanitize(b.deliveryTime || '3-7 days', 100),
        minOrder:     parseFloat(b.minOrder) || 0,
        isActive:     b.isActive !== false,
        notes:        sanitize(b.notes || '', 1000),
        categories:   Array.isArray(b.categories) ? b.categories : [],
        bankInfo: {
          bankName:    sanitize(b.bankInfo?.bankName || '', 100),
          accountNo:   sanitize(b.bankInfo?.accountNo || '', 50),
          accountName: sanitize(b.bankInfo?.accountName || '', 100),
          bkash:       sanitize(b.bankInfo?.bkash || '', 20),
          nagad:       sanitize(b.bankInfo?.nagad || '', 20),
        },
      });
      return res.status(201).json({ ok: true, supplier, message: 'Supplier যোগ হয়েছে' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Supplier add হয়নি: ' + err.message });
    }
  }

  if (action === 'supplier-edit' && req.method === 'POST') {
    const b = req.body || {};
    const id = b.supplierId || b._id;
    if (!id) return res.status(400).json({ ok: false, error: 'Supplier ID দিন' });
    const allowed = ['name','company','phone','email','address','country','website','type','paymentTerms','deliveryTime','minOrder','isActive','notes','categories','bankInfo'];
    const updates = {};
    allowed.forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
    const supplier = await Supplier.findOneAndUpdate(
      { $or: [{ supplierId: id }, { _id: id.length === 24 ? id : undefined }] },
      updates, { new: true }
    );
    if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier পাওয়া যায়নি' });
    return res.json({ ok: true, supplier, message: 'Supplier আপডেট হয়েছে' });
  }

  if (action === 'supplier-delete' && req.method === 'POST') {
    const id = req.body?.supplierId || req.body?.id;
    if (!id) return res.status(400).json({ ok: false, error: 'Supplier ID দিন' });
    const supplier = await Supplier.findOneAndDelete({ $or: [{ supplierId: id }, { _id: id.length === 24 ? id : undefined }] });
    if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier পাওয়া যায়নি' });
    return res.json({ ok: true, message: `"${supplier.name}" delete হয়েছে` });
  }

  /* ═══════════════════════════════════════════════════════════
     ── INVENTORY LOG ────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'inventory' && req.method === 'GET') {
    try {
      const page      = Math.max(1, parseInt(req.query?.page || '1'));
      const limit     = Math.min(50, parseInt(req.query?.limit || '20'));
      const productId = req.query?.productId || '';
      const type      = req.query?.type || '';
      const skip      = (page - 1) * limit;
      const query     = {};
      if (productId) query.productId = productId;
      if (type)      query.type = type;

      const [logs, total] = await Promise.all([
        InventoryLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v'),
        InventoryLog.countDocuments(query),
      ]);
      return res.json({ ok: true, logs, total, pagination: { page, limit, pages: Math.ceil(total / limit) } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Inventory লোড হয়নি: ' + err.message });
    }
  }

  if (action === 'inventory-add' && req.method === 'POST') {
    try {
      const b = req.body || {};
      if (!b.productId || !b.type || !b.qty) return res.status(400).json({ ok: false, error: 'productId, type, qty দিন' });

      const product = await Product.findOne({ productId: b.productId });
      if (!product) return res.status(404).json({ ok: false, error: 'Product পাওয়া যায়নি' });

      const qty = parseInt(b.qty);
      const stockBefore = product.stock || 0;
      let stockAfter = stockBefore;

      if (b.type === 'in' || b.type === 'return') stockAfter = stockBefore + qty;
      else if (b.type === 'out' || b.type === 'damage') stockAfter = Math.max(0, stockBefore - qty);
      else if (b.type === 'adjust') stockAfter = qty; // direct set

      await Product.updateOne({ productId: b.productId }, { stock: stockAfter });

      const log = await InventoryLog.create({
        productId: b.productId,
        productName: product.name,
        type: b.type,
        qty,
        stockBefore,
        stockAfter,
        ref: sanitize(b.ref || '', 100),
        refType: b.refType || 'manual',
        note: sanitize(b.note || '', 300),
        updatedBy: 'admin',
        supplierId: b.supplierId || '',
        costPrice: parseFloat(b.costPrice) || 0,
      });

      return res.status(201).json({ ok: true, log, stockAfter, message: `Stock ${b.type}: ${qty} units` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Inventory entry failed: ' + err.message });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     ── REFERRALS ────────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'referrals' && req.method === 'GET') {
    try {
      const page  = Math.max(1, parseInt(req.query?.page  || '1'));
      const limit = Math.min(50, parseInt(req.query?.limit || '20'));
      const skip  = (page - 1) * limit;

      const [referrals, total, stats] = await Promise.all([
        Referral.find().sort({ createdAt: -1 }).skip(skip).limit(limit)
          .populate('referrerUserId', 'name phone').populate('referredUserId', 'name phone').lean(),
        Referral.countDocuments(),
        Referral.aggregate([
          { $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalPoints: { $sum: '$pointsAwarded' },
          }},
        ]),
      ]);

      // Revenue from referral orders
      const refOrderIds = referrals.filter(r => r.orderId).map(r => r.orderId);
      const revAgg = refOrderIds.length ? await Order.aggregate([
        { $match: { orderId: { $in: refOrderIds }, status: { $nin: ['cancelled','refunded'] } } },
        { $group: { _id: null, total: { $sum: '$pricing.total' } } },
      ]) : [{ total: 0 }];

      const completedCount = stats.find(s => s._id === 'completed')?.count || 0;
      const totalCount     = stats.reduce((s, x) => s + x.count, 0);

      return res.json({
        ok: true, referrals, total,
        pagination: { page, limit, pages: Math.ceil(total / limit) },
        summary: {
          total: totalCount,
          completed: completedCount,
          pending: stats.find(s => s._id === 'pending')?.count || 0,
          conversionRate: totalCount ? Math.round((completedCount / totalCount) * 100) : 0,
          revenueFromRefs: revAgg[0]?.total || 0,
          totalPointsIssued: stats.reduce((s, x) => s + (x.totalPoints || 0), 0),
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Referrals লোড হয়নি: ' + err.message });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     ── BROADCAST NOTIFICATION ───────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'notify-broadcast' && req.method === 'POST') {
    try {
      const b = req.body || {};
      if (!b.title || !b.message) return res.status(400).json({ ok: false, error: 'Title এবং message দিন' });

      const notification = await Notification.create({
        type:     b.type || 'promo',
        title:    sanitize(b.title, 200),
        message:  sanitize(b.message, 1000),
        icon:     b.icon || '🔔',
        link:     sanitize(b.link || '', 500),
        isGlobal: true,
        channel:  b.channel || 'app',
      });

      // If SMS broadcast, send to active users (limit 100 at a time)
      let smsSent = 0;
      if (b.channel === 'sms' || b.channel === 'all') {
        const query = { isActive: true, 'notificationPrefs.sms': true };
        if (b.segment === 'loyal') query.loyaltyPoints = { $gte: 1000 };
        if (b.segment === 'gold') query.loyaltyPoints = { $gte: 5000 };
        const users = await User.find(query).select('phone').limit(100);
        for (const u of users) {
          try { await sendSMS(u.phone, `${b.title}: ${b.message} — Shoplixo`); smsSent++; } catch {}
        }
      }

      return res.json({ ok: true, notification, smsSent, message: `Notification broadcast হয়েছে (SMS: ${smsSent})` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Broadcast failed: ' + err.message });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     ── SITE SETTINGS ────────────────────────────────────────
  ═══════════════════════════════════════════════════════════ */
  if (action === 'settings' && req.method === 'GET') {
    try {
      const group = req.query?.group || '';
      const settings = await getSettings(group || undefined);
      return res.json({ ok: true, settings });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Settings লোড হয়নি' });
    }
  }

  if (action === 'settings' && req.method === 'POST') {
    try {
      const b = req.body || {};
      const { key, value, group, label, type } = b;
      if (!key) return res.status(400).json({ ok: false, error: 'key দিন' });
      const setting = await setSetting(key, value, { group: group || 'general', label: label || key, type: type || 'string' });
      return res.json({ ok: true, setting, message: 'Setting saved!' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Setting save হয়নি' });
    }
  }

  /* ── Fallback ─────────────────────────────────────────── */
  return res.status(400).json({
    ok: false, error: 'Invalid action',
    available: [
      'stats',
      'products', 'product', 'product-add', 'product-edit', 'product-delete', 'product-bulk',
      'orders', 'order', 'status', 'payment-verify',
      'returns', 'return-update',
      'customers', 'customer-ban',
      'reviews', 'review-approve', 'review-delete', 'review-reply',
      'flash-sales', 'flash-sale-add', 'flash-sale-del',
      'bundles', 'bundle-add', 'bundle-edit', 'bundle-delete',
      'coupons', 'coupon', 'toggle-coupon', 'coupon-delete',
      'newsletter', 'newsletter-del',
      'abandoned',
      'suppliers', 'supplier-add', 'supplier-edit', 'supplier-delete',
      'inventory', 'inventory-add',
      'referrals',
      'notify-broadcast',
      'settings',
    ],
  });
};
