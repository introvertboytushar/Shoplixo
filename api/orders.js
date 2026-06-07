/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/orders  (Enhanced v2)
 *
 *  POST /api/orders          → নতুন order দিন
 *  GET  /api/orders?id=xxx   → order track করুন
 *  GET  /api/orders?action=my → আমার orders (JWT)
 * ══════════════════════════════════════════════════════════════
 *  নতুন: Stock decrement, SMS notification, Loyalty points earn,
 *         Abandoned cart conversion tracking
 * ══════════════════════════════════════════════════════════════
 */

const { connectDB, Order, Coupon, Product, User, AbandonedCart } = require('../_db');
const {
  handleCors, generateOrderId, checkRateLimit, verifyToken,
  isValidBDPhone, sanitize, sendEmail, sendSMS,
  orderConfirmationEmail, orderConfirmSMS,
} = require('../_helpers');

const BD_DISTRICTS = [
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
];

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  /* ══════════════════════════════════════════════════════════
     GET: Track Order
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'GET' && !req.query.action) {
    const id = req.query?.id || '';
    if (!id) return res.status(400).json({ ok: false, error: 'Order ID দিন' });

    try {
      await connectDB();
      const order = await Order.findOne({ orderId: id.toUpperCase() }).select('-ip -userAgent -__v');
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });

      return res.json({
        ok: true,
        order: {
          orderId:   order.orderId,
          status:    order.status,
          customer:  {
            name:  order.customer.name,
            phone: order.customer.phone.slice(0, -4) + '****',
          },
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

  /* ══════════════════════════════════════════════════════════
     GET: My Orders (JWT required)
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'GET' && req.query.action === 'my') {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ ok: false, error: 'Login করুন' });

    try {
      await connectDB();
      const user = await User.findById(decoded.id).select('phone');
      if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });

      const page  = Math.max(1, parseInt(req.query.page || '1'));
      const limit = Math.min(20, parseInt(req.query.limit || '10'));
      const skip  = (page - 1) * limit;

      const [orders, total] = await Promise.all([
        Order.find({ 'customer.phone': user.phone })
          .sort({ createdAt: -1 }).skip(skip).limit(limit)
          .select('-ip -userAgent -__v -customer.email'),
        Order.countDocuments({ 'customer.phone': user.phone }),
      ]);

      return res.json({ ok: true, orders, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  /* ══════════════════════════════════════════════════════════
     POST: Place Order
  ══════════════════════════════════════════════════════════ */
  if (req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '';
    if (!checkRateLimit(`order_${ip}`, 5, 60000)) {
      return res.status(429).json({ ok: false, error: 'অনেক request! ১ মিনিট পরে চেষ্টা করুন।' });
    }

    const b = req.body || {};

    /* ── Validation ─────────────────────────────────────── */
    const name     = sanitize(b.name, 100);
    const phone    = sanitize(b.phone, 20).replace(/\s+/g, '');
    const address  = sanitize(b.address, 300);
    const district = sanitize(b.district, 50);
    const email    = sanitize(b.email   || '', 150);
    const note     = sanitize(b.note    || '', 500);
    const payment  = String(b.payment   || '').toLowerCase();
    const trxId    = sanitize(b.trxId   || '', 100);
    const couponCode    = sanitize(b.couponCode    || '', 50).toUpperCase();
    const sessionId     = sanitize(b.sessionId     || '', 100); // for abandoned cart tracking
    const loyaltyPoints = parseInt(b.loyaltyPoints || '0');     // points to redeem
    const items    = Array.isArray(b.items) ? b.items : [];

    if (!name)                  return res.status(400).json({ ok: false, error: 'নাম লিখুন!' });
    if (!isValidBDPhone(phone)) return res.status(400).json({ ok: false, error: 'সঠিক ফোন নম্বর দিন!' });
    if (!address)               return res.status(400).json({ ok: false, error: 'ঠিকানা লিখুন!' });
    if (!district)              return res.status(400).json({ ok: false, error: 'জেলা সিলেক্ট করুন!' });
    if (!['bkash','nagad','rocket','upay','cod'].includes(payment))
      return res.status(400).json({ ok: false, error: 'Payment method সিলেক্ট করুন!' });
    if (payment !== 'cod' && !trxId)
      return res.status(400).json({ ok: false, error: 'Transaction ID দিন!' });
    if (!items.length) return res.status(400).json({ ok: false, error: 'Cart খালি!' });

    /* ── Sanitize items ────────────────────────────────── */
    const cleanItems = items.slice(0, 30).map(i => ({
      productId: String(i.id || i.productId || ''),
      name:      sanitize(i.name, 200),
      price:     Math.max(0, parseFloat(i.price) || 0),
      qty:       Math.min(99, Math.max(1, parseInt(i.qty) || 1)),
      img:       sanitize(i.img   || '', 500),
      size:      sanitize(i.size  || '', 50),
      color:     sanitize(i.color || '', 50),
    })).filter(i => i.productId && i.name && i.price > 0);

    if (!cleanItems.length) return res.status(400).json({ ok: false, error: 'Valid items নেই!' });

    try {
      await connectDB();

      /* ── Verify stock availability ──────────────────── */
      const productIds = [...new Set(cleanItems.map(i => i.productId))];
      const dbProducts = await Product.find({ productId: { $in: productIds } })
        .select('productId name stock price').lean();

      const stockMap = Object.fromEntries(dbProducts.map(p => [p.productId, p]));
      for (const item of cleanItems) {
        const dbProd = stockMap[item.productId];
        if (!dbProd) continue; // product might not be in DB (static), skip
        if (dbProd.stock < item.qty) {
          return res.status(400).json({
            ok: false,
            error: `"${item.name}" এর stock মাত্র ${dbProd.stock}টি বাকি আছে।`,
          });
        }
      }

      /* ── Calculate pricing ──────────────────────────── */
      const freeMin  = parseInt(process.env.FREE_SHIPPING_MIN || '999');
      const shipCost = parseInt(process.env.SHIPPING_COST     || '60');
      const subtotal = cleanItems.reduce((s, i) => s + i.price * i.qty, 0);
      const shipping = subtotal >= freeMin ? 0 : shipCost;

      /* ── Apply coupon ───────────────────────────────── */
      let discountAmt   = 0;
      let appliedCoupon = '';
      if (couponCode) {
        try {
          const coupon = await Coupon.findOne({ code: couponCode, isActive: true });
          if (coupon) {
            const now     = new Date();
            const notExp  = !coupon.expiresAt || coupon.expiresAt > now;
            const hasUses = !coupon.maxUses   || coupon.usedCount < coupon.maxUses;
            const meetMin = subtotal >= (coupon.minOrder || 0);
            if (notExp && hasUses && meetMin) {
              discountAmt = coupon.type === 'percent'
                ? Math.round(subtotal * coupon.discount / 100)
                : Math.min(coupon.discount, subtotal);
              appliedCoupon = couponCode;
            }
          }
        } catch { /* non-fatal */ }
      }

      /* ── Apply loyalty points ───────────────────────── */
      let loyaltyDiscount = 0;
      let loyaltyUsed = 0;
      const decoded = verifyToken(req);
      if (loyaltyPoints > 0 && decoded) {
        try {
          const user = await User.findById(decoded.id);
          if (user && user.loyaltyPoints >= loyaltyPoints) {
            // 1 point = ৳0.50
            const maxDiscount = Math.floor(subtotal * 0.20); // max 20% of subtotal
            loyaltyDiscount = Math.min(Math.floor(loyaltyPoints * 0.5), maxDiscount);
            loyaltyUsed = Math.ceil(loyaltyDiscount / 0.5);

            // Deduct points
            await User.findByIdAndUpdate(decoded.id, { $inc: { loyaltyPoints: -loyaltyUsed } });
          }
        } catch { /* non-fatal */ }
      }

      const total = Math.max(0, subtotal + shipping - discountAmt - loyaltyDiscount);

      /* ── Loyalty points to earn ─────────────────────── */
      const pointsToEarn = Math.floor(total / 10); // 10 টাকা = 1 point

      /* ── Generate unique order ID ───────────────────── */
      let orderId = generateOrderId();
      for (let i = 0; i < 5; i++) {
        const exists = await Order.findOne({ orderId });
        if (!exists) break;
        orderId = generateOrderId();
      }

      /* ── Save order ─────────────────────────────────── */
      const order = new Order({
        orderId,
        customer: { name, phone, email, address, district, note },
        items:    cleanItems,
        payment:  { method: payment, transactionId: trxId, status: 'pending' },
        pricing:  { subtotal, shipping, discount: discountAmt, coupon: appliedCoupon, loyaltyDiscount, total },
        loyaltyPointsEarned: pointsToEarn,
        loyaltyPointsUsed:   loyaltyUsed,
        status:   'pending',
        statusHistory: [{ status: 'pending', note: 'Order placed', updatedBy: 'system' }],
        source:   sanitize(req.headers.referer || 'website', 100),
        ip, userAgent: sanitize(req.headers['user-agent'] || '', 300),
      });

      await order.save();

      /* ── Decrement stock ────────────────────────────── */
      const stockOps = cleanItems
        .filter(i => stockMap[i.productId]) // only items in DB
        .map(i => ({
          updateOne: {
            filter: { productId: i.productId, stock: { $gte: i.qty } },
            update: {
              $inc: { stock: -i.qty, totalSold: i.qty },
              $set: { badge: stockMap[i.productId]?.stock - i.qty === 0 ? 'sold' : stockMap[i.productId]?.badge },
            },
          },
        }));
      if (stockOps.length) Product.bulkWrite(stockOps).catch(() => {});

      /* ── Mark coupon used ───────────────────────────── */
      if (appliedCoupon) {
        Coupon.findOneAndUpdate(
          { code: appliedCoupon },
          { $inc: { usedCount: 1 }, $addToSet: { usedBy: phone } }
        ).catch(() => {});
      }

      /* ── Mark abandoned cart as converted ───────────── */
      if (sessionId) {
        AbandonedCart.findOneAndUpdate(
          { sessionId },
          { isConverted: true, convertedAt: new Date() }
        ).catch(() => {});
      }

      /* ── Send confirmation email (non-blocking) ─────── */
      if (email) {
        sendEmail(
          email,
          `✅ Order Confirmed — ${orderId} | Shoplixo`,
          orderConfirmationEmail(order)
        ).catch(() => {});
      }

      /* ── Send SMS notification ──────────────────────── */
      sendSMS(phone, orderConfirmSMS(orderId, name, total)).catch(() => {});

      /* ── Success response ───────────────────────────── */
      return res.status(201).json({
        ok: true,
        orderId,
        total,
        subtotal,
        shipping,
        discount: discountAmt,
        loyaltyDiscount,
        loyaltyPointsEarned: pointsToEarn,
        message: `অর্ডার সফল! Order ID: ${orderId}`,
      });

    } catch (err) {
      console.error('Place order error:', err);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
