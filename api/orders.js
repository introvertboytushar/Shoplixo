/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/orders  (Upgraded v4)
 *
 *  ── PUBLIC ───────────────────────────────────────────────────
 *  GET  /api/orders?id=xxx                    → Order track (enhanced) [UPGRADE-I5]
 *  GET  /api/orders?action=my                 → My orders (JWT)
 *  GET  /api/orders?action=invoice&id=xxx     → Order invoice data [NEW]
 *  GET  /api/orders?action=stats              → Customer order stats [NEW]
 *  POST /api/orders?action=shipping-estimate  → Delivery charge estimate [NEW]
 *
 *  ── MUTATIONS ────────────────────────────────────────────────
 *  POST /api/orders                           → Place order (w/ price verification)
 *  POST /api/orders?action=cancel             → Cancel order (within window) [NEW]
 *  POST /api/orders?action=return             → Return / refund request [NEW]
 *  POST /api/orders?action=reorder            → Quick reorder [NEW]
 *  POST /api/orders?action=feedback           → Post-delivery feedback [NEW]
 *  POST /api/orders?action=cart-save          → Save abandoned cart [NEW]
 *  POST /api/orders?action=payment-init       → ShurjoPay payment initiate [NEW]
 *  POST /api/orders?action=payment-verify     → ShurjoPay payment verify [NEW]
 * ══════════════════════════════════════════════════════════════
 *  Features: Stock decrement, SMS notification, Per-product 4-tier
 *             delivery charges, Address auto-save, Abandoned cart
 *             conversion, Server-side price verify, Order cancellation
 *             window, Return/refund workflow, Post-delivery feedback,
 *             ShurjoPay online payment gateway
 * ══════════════════════════════════════════════════════════════
 */

'use strict';

const { connectDB, Order, Product, User, AbandonedCart, getSettings } = require('./_db');
const {
  handleCors, generateOrderId, checkRateLimit, verifyToken,
  isValidBDPhone, sanitize, sendEmail, sendSMS,
  orderConfirmationEmail, orderConfirmSMS,
} = require('./_helpers');

/* ── BD Districts (authoritative list) ──────────────────────────────────── */
const BD_DISTRICTS = new Set([
  'ঢাকা','চট্টগ্রাম','রাজশাহী','সিলেট','খুলনা','বরিশাল','রংপুর','ময়মনসিংহ',
  'কুমিল্লা','নারায়ণগঞ্জ','গাজীপুর','ফেনী','নোয়াখালী','লক্ষ্মীপুর','চাঁদপুর',
  'ব্রাহ্মণবাড়িয়া','হবিগঞ্জ','মৌলভীবাজার','সুনামগঞ্জ','নেত্রকোণা','কিশোরগঞ্জ',
  'মানিকগঞ্জ','মুন্সিগঞ্জ','রাজবাড়ী','ফরিদপুর','মাদারীপুর','শরীয়তপুর','গোপালগঞ্জ',
  'টাঙ্গাইল','জামালপুর','শেরপুর','নরসিংদী','পাবনা','সিরাজগঞ্জ','নাটোর',
  'চাঁপাইনবাবগঞ্জ','নওগাঁ','জয়পুরহাট','বগুড়া','দিনাজপুর','ঠাকুরগাঁও','পঞ্চগড়',
  'নীলফামারী','লালমনিরহাট','কুড়িগ্রাম','গাইবান্ধা','যশোর','ঝিনাইদহ','মাগুরা',
  'নড়াইল','কুষ্টিয়া','মেহেরপুর','চুয়াডাঙ্গা','সাতক্ষীরা','বাগেরহাট','পিরোজপুর',
  'ঝালকাঠি','বরগুনা','পটুয়াখালী','ভোলা','কক্সবাজার','বান্দরবান',
  'রাঙামাটি','খাগড়াছড়ি',
]);

// Dhaka বিভাগের জেলা গুলো (Dhaka জেলা বাদে) — "Dhaka Sub-area" shipping tier এর জন্য
const DHAKA_DIVISION_OTHER_DISTRICTS = new Set([
  'নারায়ণগঞ্জ','গাজীপুর','মানিকগঞ্জ','মুন্সিগঞ্জ','নরসিংদী','শরীয়তপুর',
  'মাদারীপুর','গোপালগঞ্জ','ফরিদপুর','রাজবাড়ী','টাঙ্গাইল','কিশোরগঞ্জ',
]);

// ঢাকা জেলার sub-area উপজেলা — আলাদা tier (dhakaSubArea) এর জন্য
const DHAKA_SUBAREA_UPAZILAS = ['সাভার','ধামরাই','কেরানীগঞ্জ','নবাবগঞ্জ','দোহার'];

/* ── Shipping tiers (from env or defaults) ───────────────────────────────── */
const FREE_SHIPPING_MIN  = parseInt(process.env.FREE_SHIPPING_MIN  || '999');
const SHIPPING_COST      = parseInt(process.env.SHIPPING_COST      || '60');
const DHAKA_SHIPPING     = parseInt(process.env.DHAKA_SHIPPING     || '60');
const OUTSIDE_SHIPPING   = parseInt(process.env.OUTSIDE_SHIPPING   || '120');

/* ── Cancellation window: 1 hour after placing ───────────────────────────── */
const CANCEL_WINDOW_MS = parseInt(process.env.CANCEL_WINDOW_MINUTES || '60') * 60 * 1000;

/* ── Cancellable statuses ────────────────────────────────────────────────── */
const CANCELLABLE_STATUSES = new Set(['pending', 'confirmed']);

/* ── Returnable statuses ─────────────────────────────────────────────────── */
const RETURNABLE_STATUSES = new Set(['delivered']);

/* ── Courier tracking URL builders ──────────────────────────────────────── */
const COURIER_TRACKING = {
  pathao:    id => `https://pathao.com/bd/courier-tracking/?consignment_id=${id}`,
  steadfast: id => `https://steadfast.com.bd/track?invoice=${id}`,
  redx:      id => `https://redx.com.bd/track/${id}`,
  paperfly:  id => `https://paperfly.com.bd/en/tracking/${id}`,
  sundarban: id => `https://sundarbancourier.com/tracking/?trackId=${id}`,
  dhl:       id => `https://www.dhl.com/bd-en/home/tracking/tracking-express.html?submit=1&tracking-id=${id}`,
};

/* ─────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────── */

/** Determine delivery tier based on district and upazila */
function getDeliveryTier(district, upazila = '') {
  if (district === 'ঢাকা') {
    return DHAKA_SUBAREA_UPAZILAS.includes(upazila) ? 'dhakaSubArea' : 'dhakaCity';
  }
  if (DHAKA_DIVISION_OTHER_DISTRICTS.has(district)) return 'dhakaDivision';
  return 'outsideDhaka';
}

/** Compute shipping cost — settings-driven 4-tier (Dhaka City / Dhaka SubArea / Dhaka Division / Outside Dhaka),
 *  supports per-product deliveryCharges override (highest rate wins),
 *  fallback to env vars if settings not configured yet. Returns { shipping, tier }. */
async function calcShipping(cleanItems, district = '', upazila = '', subtotal) {
  let shippingSettings = {};
  try {
    shippingSettings = await getSettings('shipping');
  } catch (_) { /* DB issue → fall back to env defaults below */ }

  const tier = getDeliveryTier(district, upazila);

  const freeMin = parseInt(shippingSettings.shipping_free_above ?? FREE_SHIPPING_MIN, 10);
  if (subtotal >= freeMin) return { shipping: 0, tier };

  const GLOBAL_TIER_RATES = {
    dhakaCity:     parseInt(shippingSettings.shipping_dhaka         ?? DHAKA_SHIPPING,   10),
    dhakaSubArea:  parseInt(shippingSettings.shipping_dhaka_subarea ?? shippingSettings.shipping_dhaka ?? DHAKA_SHIPPING, 10),
    dhakaDivision: parseInt(shippingSettings.shipping_dhaka_sub     ?? OUTSIDE_SHIPPING, 10),
    outsideDhaka:  parseInt(shippingSettings.shipping_outside       ?? OUTSIDE_SHIPPING, 10),
  };

  let charge = GLOBAL_TIER_RATES[tier];

  /* Per-product override — সবচেয়ে বেশি rate-টা নেওয়া হয় (একটাই delivery, সবচেয়ে costly item-এর rate প্রযোজ্য হবে) */
  try {
    const productIds = [...new Set(cleanItems.map(i => i.productId))];
    const products = await Product.find({ productId: { $in: productIds } })
      .select('productId deliveryCharges').lean();
    for (const p of products) {
      const dc = p.deliveryCharges;
      if (dc?.enabled && dc[tier] != null && !Number.isNaN(dc[tier])) {
        charge = Math.max(charge, dc[tier]);
      }
    }
  } catch (_) { /* fallback to global rate on error */ }

  return { shipping: charge, tier };
}

/** Build courier tracking info from order.tracking field */
function buildTrackingInfo(order) {
  const t = order.tracking || {};
  const courierId  = (t.courier || '').toLowerCase();
  const trackingId = t.trackingId || t.trackingNumber || '';
  const trackingUrl = trackingId && courierId && COURIER_TRACKING[courierId]
    ? COURIER_TRACKING[courierId](trackingId)
    : null;

  return {
    courier:         t.courier        || null,
    trackingId:      trackingId       || null,
    trackingUrl,
    estimatedDelivery: t.estimatedDelivery || null,
    dispatchedAt:    t.dispatchedAt   || null,
    deliveredAt:     t.deliveredAt    || null,
    currentLocation: t.currentLocation || null,
    notes:           t.notes          || null,
  };
}

/** Format order for public tracking response — masks sensitive data */
function formatOrderPublic(order) {
  return {
    orderId:     order.orderId,
    status:      order.status,
    customer: {
      name:     order.customer.name,
      phone:    order.customer.phone.slice(0, -4) + '****',
      district: order.customer.district,
    },
    items:       order.items.map(i => ({
      productId: i.productId,
      name:      i.name,
      img:       i.img,
      qty:       i.qty,
      price:     i.price,
      size:      i.size  || null,
      color:     i.color || null,
    })),
    pricing:     order.pricing,
    payment: {
      method: order.payment?.method,
      status: order.payment?.status,
    },
    tracking:    buildTrackingInfo(order),
    history:     (order.statusHistory || []).map(h => ({
      status:    h.status,
      note:      h.note,
      updatedAt: h.updatedAt || h.createdAt,
    })),
    canCancel:   CANCELLABLE_STATUSES.has(order.status)
                 && (Date.now() - new Date(order.createdAt).getTime()) < CANCEL_WINDOW_MS,
    canReturn:   RETURNABLE_STATUSES.has(order.status),
    createdAt:   order.createdAt,
    updatedAt:   order.updatedAt,
  };
}

/** Build a minimal HTML invoice string (used by action=invoice) */
function buildInvoiceData(order) {
  return {
    orderId:   order.orderId,
    date:      new Date(order.createdAt).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' }),
    customer:  {
      name:     order.customer.name,
      phone:    order.customer.phone,
      address:  `${order.customer.address}, ${order.customer.district}`,
      email:    order.customer.email || null,
    },
    items:     order.items.map(i => ({
      name:    i.name,
      qty:     i.qty,
      price:   i.price,
      total:   i.price * i.qty,
      size:    i.size  || null,
      color:   i.color || null,
    })),
    pricing:   order.pricing,
    payment:   order.payment,
    status:    order.status,
    siteName:  process.env.SITE_NAME || 'Shoplixo',
    siteUrl:   process.env.SITE_URL  || 'https://shoplixo.shop',
  };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  const action = req.query?.action || '';

  /* ══════════════════════════════════════════════════════════
     GET: Track Order  [UPGRADE-I5 — enhanced with courier info]
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'GET' && !action) {
    const id = (req.query?.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'Order ID দিন' });

    try {
      await connectDB();
      const order = await Order.findOne({ orderId: id.toUpperCase() })
        .select('-ip -userAgent -__v -customer.email')
        .lean();
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

      return res.json({ ok: true, order: formatOrderPublic(order) });
    } catch (err) {
      console.error('[Track order]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     GET: My Orders  (JWT)
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'GET' && action === 'my') {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ ok: false, error: 'Login করুন' });

    try {
      await connectDB();
      const user = await User.findById(decoded.id).select('phone').lean();
      if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });

      const page   = Math.max(1, parseInt(req.query.page  || '1'));
      const limit  = Math.min(20, parseInt(req.query.limit || '10'));
      const status = req.query.status || '';
      const skip   = (page - 1) * limit;

      const filter = { 'customer.phone': user.phone };
      if (status) filter.status = status;

      const [orders, total] = await Promise.all([
        Order.find(filter)
          .sort({ createdAt: -1 }).skip(skip).limit(limit)
          .select('-ip -userAgent -__v -customer.email')
          .lean(),
        Order.countDocuments(filter),
      ]);

      return res.json({
        ok: true,
        orders: orders.map(formatOrderPublic),
        total, page, pages: Math.ceil(total / limit),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     GET: Order Invoice Data  [NEW]
     GET /api/orders?action=invoice&id=SLX-xxxxx
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'GET' && action === 'invoice') {
    const id = (req.query?.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'Order ID দিন' });

    try {
      await connectDB();
      const order = await Order.findOne({ orderId: id.toUpperCase() }).lean();
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

      /* Verify caller owns the order (phone suffix match or JWT) */
      const phone = (req.query.phone || '').trim();
      const decoded = verifyToken(req);
      const isOwner = decoded
        ? (await User.findById(decoded.id).select('phone').lean())?.phone === order.customer.phone
        : phone && order.customer.phone.endsWith(phone.slice(-4));

      if (!isOwner) return res.status(403).json({ ok: false, error: 'Unauthorized' });

      return res.json({ ok: true, invoice: buildInvoiceData(order) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     GET: Customer Order Stats  [NEW]
     GET /api/orders?action=stats  (JWT required)
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'GET' && action === 'stats') {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ ok: false, error: 'Login করুন' });

    try {
      await connectDB();
      const user = await User.findById(decoded.id).select('phone').lean();
      if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });

      const [agg, statusBreakdown] = await Promise.all([
        Order.aggregate([
          { $match: { 'customer.phone': user.phone } },
          {
            $group: {
              _id:         null,
              totalOrders: { $sum: 1 },
              totalSpent:  { $sum: '$pricing.total' },
              avgOrder:    { $avg: '$pricing.total' },
              totalItems:  { $sum: { $sum: '$items.qty' } },
            },
          },
        ]),
        Order.aggregate([
          { $match: { 'customer.phone': user.phone } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
      ]);

      const stats = agg[0] || { totalOrders: 0, totalSpent: 0, avgOrder: 0, totalItems: 0 };
      const breakdown = Object.fromEntries(statusBreakdown.map(s => [s._id, s.count]));

      return res.json({
        ok: true,
        stats: {
          totalOrders:     stats.totalOrders,
          totalSpent:      Math.round(stats.totalSpent),
          avgOrderValue:   Math.round(stats.avgOrder),
          totalItems:      stats.totalItems,
          statusBreakdown: breakdown,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: Place Order  (server-side price verification added)
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && !action) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    if (!checkRateLimit(`order_${ip}`, 5, 60000)) {
      return res.status(429).json({ ok: false, error: 'অনেক request! ১ মিনিট পরে চেষ্টা করুন।' });
    }

    const b = req.body || {};
    const { lat, lng, accuracy } = b.gpsLocation || {};
    const deviceInfo  = req.headers['user-agent']?.substring(0, 200) || '';
    const fingerprint = b.fingerprint || {};

    /* ── Input sanitisation ──────────────────────────── */
    const name           = sanitize(b.name,           100);
    const phone          = sanitize(b.phone,           20).replace(/\s+/g, '');
    const address        = sanitize(b.address,        300);
    const district       = sanitize(b.district,        50);
    const division = sanitize(b.division || '', 30);
    const upazila  = sanitize(b.upazila  || '', 100);
    const union_   = sanitize(b.union    || '', 100);
    const village  = sanitize(b.village  || '', 150);
    const house    = sanitize(b.house    || '', 150);
    const email          = sanitize(b.email       || '', 150);
    const note           = sanitize(b.note        || '', 500);
    const payment        = String(b.payment       || '').toLowerCase().trim();
    const trxId          = sanitize(b.trxId       || '', 100);
    const sessionId      = sanitize(b.sessionId   || '', 100);
    const items          = Array.isArray(b.items) ? b.items : [];
    const utmSource      = sanitize(b.utmSource   || '', 50);
    const utmCampaign    = sanitize(b.utmCampaign || '', 50);

    /* ── Validation ──────────────────────────────────── */
    if (!name)                 return res.status(400).json({ ok: false, error: 'নাম লিখুন!' });
    if (!isValidBDPhone(phone)) return res.status(400).json({ ok: false, error: 'সঠিক ফোন নম্বর দিন!' });
    if (!address)              return res.status(400).json({ ok: false, error: 'ঠিকানা লিখুন!' });
    if (!district)             return res.status(400).json({ ok: false, error: 'জেলা সিলেক্ট করুন!' });
    if (!BD_DISTRICTS.has(district)) {
      return res.status(400).json({ ok: false, error: 'সঠিক জেলা সিলেক্ট করুন!' });
    }
    if (!['bkash', 'nagad', 'rocket', 'upay', 'cod'].includes(payment)) {
      return res.status(400).json({ ok: false, error: 'Payment method সিলেক্ট করুন!' });
    }
    if (payment !== 'cod' && !trxId) {
      return res.status(400).json({ ok: false, error: 'Transaction ID দিন!' });
    }
    if (!items.length) return res.status(400).json({ ok: false, error: 'Cart খালি!' });

    /* ── Sanitise items ──────────────────────────────── */
    const cleanItems = items.slice(0, 30).map(i => ({
      productId: String(i.id || i.productId || ''),
      name:      sanitize(i.name,         200),
      price:     Math.max(0, parseFloat(i.price)  || 0),
      qty:       Math.min(99, Math.max(1, parseInt(i.qty) || 1)),
      img:       sanitize(i.img   || '', 500),
      size:      sanitize(i.size  || '',  50),
      color:     sanitize(i.color || '',  50),
    })).filter(i => i.productId && i.name && i.price > 0);

    if (!cleanItems.length) return res.status(400).json({ ok: false, error: 'Valid items নেই!' });

    try {
      await connectDB();

      /* ── Server-side price & stock verification ──── */
      const productIds = [...new Set(cleanItems.map(i => i.productId))];
      const dbProducts = await Product.find({ productId: { $in: productIds } })
        .select('productId name stock price isActive').lean();
      const stockMap = Object.fromEntries(dbProducts.map(p => [p.productId, p]));

      for (const item of cleanItems) {
        const dbProd = stockMap[item.productId];
        if (!dbProd) continue; // static product, skip verification
        if (!dbProd.isActive) {
          return res.status(400).json({ ok: false, error: `"${item.name}" এই মুহূর্তে পাওয়া যাচ্ছে না।` });
        }
        if (dbProd.stock < item.qty) {
          return res.status(400).json({
            ok: false,
            error: `"${item.name}" এর stock মাত্র ${dbProd.stock}টি বাকি আছে।`,
          });
        }
        /* Price tampering detection — allow ±5% tolerance for flash sales */
        const priceDiff = Math.abs(item.price - dbProd.price) / dbProd.price;
        if (priceDiff > 0.05) {
          /* Silently use DB price to prevent price manipulation */
          item.price = dbProd.price;
        }
      }

      /* ── Pricing calculation ─────────────────────── */
      const subtotal = cleanItems.reduce((s, i) => s + i.price * i.qty, 0);
      const { shipping, tier: deliveryTier } = await calcShipping(cleanItems, district, upazila, subtotal);

      const total = Math.max(0, subtotal + shipping);

      /* ── Generate unique order ID ────────────────── */
      const decoded = verifyToken(req);
      let orderId = generateOrderId();
      for (let i = 0; i < 5; i++) {
        if (!(await Order.findOne({ orderId }).select('_id').lean())) break;
        orderId = generateOrderId();
      }

      /* ── Persist order ───────────────────────────── */
      const order = await Order.create({
        orderId,
        customer: {
          name, phone, email, address, district, note,
          division, upazila, union: union_, village, house,
          ipAddress:   ip,
          gpsLocation: (lat && lng) ? { lat, lng, accuracy: accuracy || null } : undefined,
          deviceInfo,
          fingerprint: {
            ip:        fingerprint.ip || ip,
            ipDetails: {
              city:    sanitize(fingerprint.ipDetails?.city    || '', 200),
              region:  sanitize(fingerprint.ipDetails?.region  || '', 200),
              country: sanitize(fingerprint.ipDetails?.country || '', 200),
              isp:     sanitize(fingerprint.ipDetails?.isp     || '', 200),
              org:     sanitize(fingerprint.ipDetails?.org     || '', 200),
              zip:     sanitize(fingerprint.ipDetails?.zip     || '',  20),
              timezone:sanitize(fingerprint.ipDetails?.timezone|| '', 100),
              lat:     fingerprint.ipDetails?.lat ?? null,
              lng:     fingerprint.ipDetails?.lng ?? null,
            },
            gps: fingerprint.gps || {
              lat:      lat      || null,
              lng:      lng      || null,
              accuracy: accuracy || null,
            },
            device: {
              userAgent:   sanitize(fingerprint.device?.userAgent    || '', 300),
              platform:    sanitize(fingerprint.device?.platform     || '', 100),
              vendor:      sanitize(fingerprint.device?.vendor       || '', 100),
              language:    sanitize(fingerprint.device?.language     || '',  20),
              screenWidth: fingerprint.device?.screenWidth  ?? null,
              screenHeight:fingerprint.device?.screenHeight ?? null,
              timezone:    sanitize(fingerprint.device?.timezone     || '', 100),
              cores:       fingerprint.device?.cores ?? null,
              memory:      fingerprint.device?.memory ?? null,
              touchPoints: fingerprint.device?.touchPoints ?? null,
              cookieEnabled: fingerprint.device?.cookieEnabled ?? null,
              doNotTrack:  fingerprint.device?.doNotTrack ?? null,
            },
            capturedAt: fingerprint.capturedAt ? new Date(fingerprint.capturedAt) : new Date(),
          },
        },
        items:      cleanItems,
        payment:    { method: payment, transactionId: trxId, status: 'pending' },
        pricing:    { subtotal, shipping, discount: 0, total },
        deliveryTier,
        status:     'pending',
        statusHistory: [{ status: 'pending', note: 'Order placed', updatedBy: 'system', updatedAt: new Date() }],
        source:     sanitize(req.headers.referer || 'website', 100),
        utmSource,
        utmCampaign,
        ip,
        userAgent:  sanitize(req.headers['user-agent'] || '', 300),
      });

      /* ── Decrement stock (non-blocking) ──────────── */
      const stockOps = cleanItems
        .filter(i => stockMap[i.productId])
        .map(i => ({
          updateOne: {
            filter: { productId: i.productId, stock: { $gte: i.qty } },
            update: {
              $inc: { stock: -i.qty, totalSold: i.qty },
              $set: {
                badge: (stockMap[i.productId]?.stock - i.qty <= 0) ? 'sold' : (stockMap[i.productId]?.badge || ''),
              },
            },
          },
        }));
      if (stockOps.length) Product.bulkWrite(stockOps).catch(() => {});

      /* ── Mark abandoned cart converted (non-blocking) */
      if (sessionId) {
        AbandonedCart.findOneAndUpdate(
          { sessionId },
          { isConverted: true, convertedAt: new Date(), orderId }
        ).catch(() => {});
      }

      /* ── Address auto-save for logged-in users (non-blocking) ── */
      if (decoded?.id) {
        const newAddress = {
          label:     'সাম্প্রতিক',
          name,
          phone,
          address,
          district,
          upazila,
          area:      '',
          isDefault: false,
        };
        User.findByIdAndUpdate(
          decoded.id,
          [
            {
              $set: {
                addresses: {
                  $slice: [
                    {
                      $filter: {
                        input: {
                          $concatArrays: [
                            [newAddress],
                            {
                              $ifNull: [
                                {
                                  $filter: {
                                    input: '$addresses',
                                    as:    'a',
                                    cond: {
                                      $not: {
                                        $and: [
                                          { $eq: ['$$a.district', district] },
                                          { $eq: ['$$a.address',  address]  },
                                        ],
                                      },
                                    },
                                  },
                                },
                                [],
                              ],
                            },
                          ],
                        },
                        as:   'x',
                        cond: { $ne: ['$$x', null] },
                      },
                    },
                    5,
                  ],
                },
              },
            },
          ],
          { new: true }
        ).catch(() => {});
      }

      /* ── Confirmation email (non-blocking) ────────── */
      if (email) {
        sendEmail(
          email,
          `✅ Order Confirmed — ${orderId} | Shoplixo`,
          orderConfirmationEmail(order)
        ).catch(() => {});
      }

      /* ── SMS (non-blocking) ───────────────────────── */
      sendSMS(phone, orderConfirmSMS(orderId, name, total)).catch(() => {});

      /* ── Response ─────────────────────────────────── */
      return res.status(201).json({
        ok:       true,
        orderId,
        total,
        subtotal,
        shipping,
        discount: 0,
        message:  `🎉 অর্ডার সফল! Order ID: ${orderId}`,
      });

    } catch (err) {
      console.error('[Place order]', err);
      return res.status(500).json({ ok: false, error: 'Server error. আবার চেষ্টা করুন।' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: Cancel Order  [NEW]
     POST /api/orders?action=cancel
     Body: { orderId, phone, reason }
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && action === 'cancel') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    if (!checkRateLimit(`cancel_${ip}`, 10, 60000)) {
      return res.status(429).json({ ok: false, error: 'অনেক request!' });
    }

    const { orderId: cancelId, phone: cancelPhone, reason } = req.body || {};
    if (!cancelId) return res.status(400).json({ ok: false, error: 'Order ID দিন' });

    try {
      await connectDB();
      const order = await Order.findOne({ orderId: cancelId.toUpperCase() });
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

      /* Ownership verify */
      const decoded = verifyToken(req);
      const isOwner = decoded
        ? (await User.findById(decoded.id).select('phone').lean())?.phone === order.customer.phone
        : cancelPhone && order.customer.phone.slice(-4) === String(cancelPhone).slice(-4);

      if (!isOwner) return res.status(403).json({ ok: false, error: 'Unauthorized' });

      /* Status check */
      if (!CANCELLABLE_STATUSES.has(order.status)) {
        return res.status(400).json({
          ok:    false,
          error: `"${order.status}" অবস্থায় order cancel করা যায় না।`,
        });
      }

      /* Time window check */
      const ageMs = Date.now() - new Date(order.createdAt).getTime();
      if (ageMs > CANCEL_WINDOW_MS) {
        const minutes = Math.round(CANCEL_WINDOW_MS / 60000);
        return res.status(400).json({
          ok:    false,
          error: `Order place করার ${minutes} মিনিটের মধ্যেই cancel করা যায়।`,
        });
      }

      /* Cancel */
      order.status = 'cancelled';
      order.statusHistory.push({
        status:    'cancelled',
        note:      sanitize(reason || 'Customer cancelled', 200),
        updatedBy: 'customer',
        updatedAt: new Date(),
      });
      await order.save();

      /* Restore stock (non-blocking) */
      const stockOps = order.items.map(i => ({
        updateOne: {
          filter: { productId: i.productId },
          update: { $inc: { stock: i.qty, totalSold: -i.qty } },
        },
      }));
      if (stockOps.length) Product.bulkWrite(stockOps).catch(() => {});

      return res.json({ ok: true, message: '✅ Order cancel হয়েছে।', orderId: order.orderId });

    } catch (err) {
      console.error('[Cancel order]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: Return / Refund Request  [NEW]
     POST /api/orders?action=return
     Body: { orderId, phone, reason, items: [{ productId, qty }] }
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && action === 'return') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    if (!checkRateLimit(`return_${ip}`, 5, 300000)) {
      return res.status(429).json({ ok: false, error: 'অনেক request!' });
    }

    const { orderId: returnId, phone: returnPhone, reason, items: returnItems } = req.body || {};
    if (!returnId)  return res.status(400).json({ ok: false, error: 'Order ID দিন' });
    if (!reason?.trim()) return res.status(400).json({ ok: false, error: 'Return কারণ লিখুন' });

    try {
      await connectDB();
      const order = await Order.findOne({ orderId: returnId.toUpperCase() });
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

      /* Ownership verify */
      const decoded = verifyToken(req);
      const isOwner = decoded
        ? (await User.findById(decoded.id).select('phone').lean())?.phone === order.customer.phone
        : returnPhone && order.customer.phone.slice(-4) === String(returnPhone).slice(-4);
      if (!isOwner) return res.status(403).json({ ok: false, error: 'Unauthorized' });

      if (!RETURNABLE_STATUSES.has(order.status)) {
        return res.status(400).json({
          ok:    false,
          error: `Order "delivered" না হলে return request করা যায় না।`,
        });
      }

      /* Check if return already requested */
      if (order.returnRequest?.requestedAt) {
        return res.status(409).json({ ok: false, error: 'এই order এর জন্য আগেই return request দেওয়া হয়েছে।' });
      }

      /* Save return request */
      order.returnRequest = {
        reason:       sanitize(reason, 500),
        items:        Array.isArray(returnItems) ? returnItems.slice(0, 10) : [],
        requestedAt:  new Date(),
        status:       'pending',
        requestedBy:  'customer',
      };
      order.status = 'return_requested';
      order.statusHistory.push({
        status:    'return_requested',
        note:      `Return request: ${sanitize(reason, 100)}`,
        updatedBy: 'customer',
        updatedAt: new Date(),
      });
      await order.save();

      /* Notify admin via email */
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        sendEmail(
          adminEmail,
          `🔄 Return Request — ${order.orderId} | Shoplixo`,
          `<p>Order <strong>${order.orderId}</strong> এর জন্য return request এসেছে।</p>
           <p>Customer: ${order.customer.name} (${order.customer.phone})</p>
           <p>কারণ: ${reason}</p>`
        ).catch(() => {});
      }

      return res.json({
        ok:      true,
        message: '✅ Return request পাঠানো হয়েছে। Admin review করবে।',
        orderId: order.orderId,
      });

    } catch (err) {
      console.error('[Return request]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: Quick Reorder  [NEW]
     POST /api/orders?action=reorder
     Body: { orderId, phone }
     Returns: pre-filled cart items from previous order
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && action === 'reorder') {
    const { orderId: reorderId, phone: reorderPhone } = req.body || {};
    if (!reorderId) return res.status(400).json({ ok: false, error: 'Order ID দিন' });

    try {
      await connectDB();
      const order = await Order.findOne({ orderId: reorderId.toUpperCase() })
        .select('items customer.phone pricing').lean();
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

      /* Ownership check */
      const decoded = verifyToken(req);
      const isOwner = decoded
        ? (await User.findById(decoded.id).select('phone').lean())?.phone === order.customer.phone
        : reorderPhone && order.customer.phone.slice(-4) === String(reorderPhone).slice(-4);
      if (!isOwner) return res.status(403).json({ ok: false, error: 'Unauthorized' });

      /* Fetch current stock & price for each item */
      const productIds  = [...new Set(order.items.map(i => i.productId))];
      const dbProds     = await Product.find({ productId: { $in: productIds } })
        .select('productId name price stock img isActive badge').lean();
      const dbMap       = Object.fromEntries(dbProds.map(p => [p.productId, p]));

      const cartItems = order.items.map(item => {
        const db = dbMap[item.productId] || {};
        return {
          productId:   item.productId,
          name:        db.name   || item.name,
          price:       db.price  || item.price,  // use current price
          img:         db.img    || item.img,
          qty:         item.qty,
          size:        item.size  || null,
          color:       item.color || null,
          badge:       db.badge  || null,
          inStock:     db.stock  > 0,
          isActive:    db.isActive !== false,
          stockQty:    db.stock  || 0,
          priceChanged: db.price && db.price !== item.price,
        };
      });

      return res.json({ ok: true, cartItems, message: 'Cart ready! Review করে order দিন।' });

    } catch (err) {
      console.error('[Reorder]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: Post-Delivery Feedback  [NEW]
     POST /api/orders?action=feedback
     Body: { orderId, phone, rating (1-5), comment }
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && action === 'feedback') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    if (!checkRateLimit(`feedback_${ip}`, 5, 300000)) {
      return res.status(429).json({ ok: false, error: 'অনেক request!' });
    }

    const { orderId: fbOrderId, phone: fbPhone, rating: fbRating, comment: fbComment } = req.body || {};
    if (!fbOrderId) return res.status(400).json({ ok: false, error: 'Order ID দিন' });
    const rating = parseInt(fbRating);
    if (rating < 1 || rating > 5) return res.status(400).json({ ok: false, error: 'Rating 1-5 এর মধ্যে দিন' });

    try {
      await connectDB();
      const order = await Order.findOne({ orderId: fbOrderId.toUpperCase() });
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

      /* Ownership check */
      const decoded = verifyToken(req);
      const isOwner = decoded
        ? (await User.findById(decoded.id).select('phone').lean())?.phone === order.customer.phone
        : fbPhone && order.customer.phone.slice(-4) === String(fbPhone).slice(-4);
      if (!isOwner) return res.status(403).json({ ok: false, error: 'Unauthorized' });

      if (!['delivered', 'return_requested'].includes(order.status)) {
        return res.status(400).json({ ok: false, error: 'Delivered order এর জন্যই feedback দেওয়া যায়' });
      }

      if (order.feedback?.submittedAt) {
        return res.status(409).json({ ok: false, error: 'এই order এর জন্য আগেই feedback দেওয়া হয়েছে' });
      }

      order.feedback = {
        rating,
        comment:     sanitize(fbComment || '', 500),
        submittedAt: new Date(),
      };
      await order.save();

      return res.json({ ok: true, message: '✅ Feedback দেওয়ার জন্য ধন্যবাদ!' });

    } catch (err) {
      console.error('[Feedback]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: Save Abandoned Cart  [NEW]
     POST /api/orders?action=cart-save
     Body: { sessionId, phone?, items, totalValue }
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && action === 'cart-save') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    if (!checkRateLimit(`cart_${ip}`, 30, 60000)) {
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    const b = req.body || {};
    const sessionId  = sanitize(b.sessionId || '', 100);
    const cartPhone  = sanitize(b.phone     || '', 20);
    const cartItems  = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
    const totalValue = parseFloat(b.totalValue || '0');

    if (!sessionId || !cartItems.length) {
      return res.status(400).json({ ok: false, error: 'sessionId ও items দিন' });
    }

    try {
      await connectDB();
      await AbandonedCart.findOneAndUpdate(
        { sessionId },
        {
          $set: {
            phone:       cartPhone,
            items:       cartItems,
            totalValue,
            updatedAt:   new Date(),
            isConverted: false,
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true, new: true }
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('[Cart save]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: ShurjoPay Payment Initiate  [NEW]
     POST /api/orders?action=payment-init
     Body: { amount, currency, customerName, customerPhone,
             customerEmail, customerAddress, items, returnUrl, cancelUrl }
  ══════════════════════════════════════════════════════════ */
  if (action === 'payment-init' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    if (!checkRateLimit(`payinit_${ip}`, 10, 60000)) {
      return res.status(429).json({ ok: false, error: 'অনেক request! একটু অপেক্ষা করুন।' });
    }

    const {
      amount, currency, customerName, customerPhone,
      customerEmail, customerAddress, items, returnUrl, cancelUrl,
    } = req.body || {};

    if (!amount || !customerName || !customerPhone || !returnUrl || !cancelUrl) {
      return res.status(400).json({ ok: false, error: 'amount, customerName, customerPhone, returnUrl, cancelUrl দিন' });
    }

    try {
      /* Step 1: ShurjoPay token নাও */
      const tokenRes = await fetch('https://engine.shurjopayment.com/api/get_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: process.env.SHURJOPAY_USERNAME,
          password: process.env.SHURJOPAY_PASSWORD,
        }),
      }).then(r => r.json());

      if (!tokenRes.token) {
        console.error('[ShurjoPay token]', tokenRes);
        return res.status(500).json({ ok: false, error: 'Payment gateway সমস্যা' });
      }

      /* Step 2: Payment create করো */
      const orderId = 'SL-' + Date.now().toString().slice(-8);
      const payRes  = await fetch('https://engine.shurjopayment.com/api/secret-pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenRes.token}`,
        },
        body: JSON.stringify({
          prefix:          process.env.SHURJOPAY_MERCHANT_KEY_PREFIX || 'sp',
          token:           tokenRes.token,
          return_url:      returnUrl,
          cancel_url:      cancelUrl,
          amount:          amount,
          currency:        currency || 'BDT',
          order_id:        orderId,
          discsount_amount: 0,
          disc_percent:    0,
          customer_name:   customerName,
          customer_addr:   customerAddress || '',
          customer_phone:  customerPhone,
          customer_email:  customerEmail   || '',
          client_ip:       req.headers['x-forwarded-for']?.split(',')[0] || '127.0.0.1',
          product_details: JSON.stringify(items || []),
          value1:          'shoplixo',
          value2:          '',
          value3:          '',
          value4:          '',
        }),
      }).then(r => r.json());

      if (payRes.checkout_url) {
        return res.json({
          ok:          true,
          checkoutUrl: payRes.checkout_url,
          orderId,
          spOrderId:   payRes.sp_order_id,
        });
      }

      console.error('[ShurjoPay init]', payRes);
      return res.status(500).json({ ok: false, error: 'Payment initiate সমস্যা' });

    } catch (err) {
      console.error('[Payment init]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: ShurjoPay Payment Verify (Callback)  [NEW]
     POST /api/orders?action=payment-verify
     Body: { orderId, spOrderId }
  ══════════════════════════════════════════════════════════ */
  if (action === 'payment-verify' && req.method === 'POST') {
    const { orderId: verifyOrderId, spOrderId } = req.body || {};

    if (!verifyOrderId || !spOrderId) {
      return res.status(400).json({ ok: false, error: 'orderId ও spOrderId দিন' });
    }

    try {
      /* Token নাও */
      const tokenRes = await fetch('https://engine.shurjopayment.com/api/get_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: process.env.SHURJOPAY_USERNAME,
          password: process.env.SHURJOPAY_PASSWORD,
        }),
      }).then(r => r.json());

      if (!tokenRes.token) {
        return res.status(500).json({ ok: false, error: 'Payment gateway সমস্যা' });
      }

      /* Payment verify করো */
      const verifyRes = await fetch('https://engine.shurjopayment.com/api/verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenRes.token}`,
        },
        body: JSON.stringify({ order_id: spOrderId }),
      }).then(r => r.json());

      const payment = verifyRes?.[0];
      if (payment?.sp_code === '1000') {
        /* Payment successful — order DB তে update করো */
        await connectDB();
        await Order.findOneAndUpdate(
          { orderId: verifyOrderId },
          {
            paymentStatus:  'paid',
            paymentMethod:  'online',
            paymentGateway: 'shurjopay',
            spOrderId:      payment.bank_trx_id,
            paidAt:         new Date(),
            status:         'confirmed',
          }
        );
        return res.json({ ok: true, status: 'paid', orderId: verifyOrderId });
      }

      console.error('[ShurjoPay verify]', verifyRes);
      return res.json({ ok: false, status: 'failed', spCode: payment?.sp_code });

    } catch (err) {
      console.error('[Payment verify]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: Delivery Charge Estimate  [NEW]
     POST /api/orders?action=shipping-estimate
     Body: { items: [{ productId, price, qty }], district, upazila? }
     Response: { ok, shipping, tier, subtotal, freeShippingMin }
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'POST' && action === 'shipping-estimate') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    if (!checkRateLimit(`shipest_${ip}`, 30, 60000)) {
      return res.status(429).json({ ok: false, error: 'অনেক request! একটু অপেক্ষা করুন।' });
    }

    const b        = req.body || {};
    const estItems = Array.isArray(b.items) ? b.items : [];
    const estDist  = sanitize(b.district  || '', 50);
    const estUpa   = sanitize(b.upazila   || '', 100);

    if (!estDist) {
      return res.status(400).json({ ok: false, error: 'district দিন' });
    }

    const cleanEstItems = estItems.slice(0, 30).map(i => ({
      productId: String(i.productId || i.id || ''),
      price:     Math.max(0, parseFloat(i.price) || 0),
      qty:       Math.min(99, Math.max(1, parseInt(i.qty) || 1)),
    })).filter(i => i.productId && i.price > 0);

    const subtotal = cleanEstItems.reduce((s, i) => s + i.price * i.qty, 0);

    try {
      let shippingSettings = {};
      try { shippingSettings = await getSettings('shipping'); } catch (_) {}
      const freeShippingMin = parseInt(shippingSettings.shipping_free_above ?? FREE_SHIPPING_MIN, 10);

      const { shipping, tier } = await calcShipping(cleanEstItems, estDist, estUpa, subtotal);

      return res.json({ ok: true, shipping, tier, subtotal, freeShippingMin });
    } catch (err) {
      console.error('[Shipping estimate]', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ── Unknown method / action ─────────────────────────────── */
  return res.status(405).json({
    ok:    false,
    error: 'Method not allowed',
    hint:  'Valid actions: my, invoice, stats, shipping-estimate, cancel, return, reorder, feedback, cart-save, payment-init, payment-verify',
  });
};
