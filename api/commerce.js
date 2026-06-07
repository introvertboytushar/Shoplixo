/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/commerce
 *  Merged: Coupon · Newsletter · Loyalty · Bundle · Flash Sale
 *
 *  ── COUPON ───────────────────────────────────────────────────
 *  POST /api/commerce?module=coupon              → Validate coupon
 *  GET  /api/commerce?module=coupon&code=xxx     → Check coupon
 *
 *  ── NEWSLETTER ───────────────────────────────────────────────
 *  POST /api/commerce?module=newsletter          → Subscribe (welcome coupon)
 *
 *  ── LOYALTY ──────────────────────────────────────────────────
 *  GET  /api/commerce?module=loyalty                      → My points
 *  GET  /api/commerce?module=loyalty&action=history       → Tx history
 *  GET  /api/commerce?module=loyalty&action=leaderboard   → Top earners
 *  POST /api/commerce?module=loyalty&action=redeem        → Redeem points
 *  POST /api/commerce?module=loyalty&action=deduct        → Deduct points
 *  POST /api/commerce?module=loyalty&action=earn          → Earn points
 *  POST /api/commerce?module=loyalty&action=refer         → Get referral code
 *  POST /api/commerce?module=loyalty&action=apply-referral→ Apply referral
 *
 *  ── BUNDLE ───────────────────────────────────────────────────
 *  GET    /api/commerce?module=bundle            → All active bundles
 *  GET    /api/commerce?module=bundle&id=xxx     → Single bundle
 *  GET    /api/commerce?module=bundle&productId=xx→ Bundles by product
 *  POST   /api/commerce?module=bundle (admin)    → Create bundle
 *  PATCH  /api/commerce?module=bundle&id=xx      → Update bundle
 *  DELETE /api/commerce?module=bundle&id=xx      → Delete bundle
 *
 *  ── FLASH ────────────────────────────────────────────────────
 *  GET  /api/commerce?module=flash               → Active flash sales
 *  GET  /api/commerce?module=flash&id=xxx        → Single flash sale
 *  GET  /api/commerce?module=flash&action=check  → Countdown timer
 *  GET  /api/commerce?module=flash&action=all    → All (admin)
 *  POST /api/commerce?module=flash (admin)       → Create flash sale
 *  PATCH /api/commerce?module=flash&id=xxx       → Update
 *  POST /api/commerce?module=flash&action=toggle&id=xxx → Toggle
 *  DELETE /api/commerce?module=flash&id=xxx      → Delete
 * ══════════════════════════════════════════════════════════════
 */

const {
  connectDB, Coupon, Newsletter, User, LoyaltyTxn, Referral,
  Bundle, Product, FlashSale,
} = require('../_db');
const {
  handleCors, isAdmin, verifyToken, sanitize, checkRateLimit,
  isValidEmail, sendEmail,
} = require('../_helpers');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LOYALTY CONFIG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const POINTS_PER_TAKA   = 0.1;
const TAKA_PER_POINT    = 0.5;
const MIN_REDEEM_POINTS = 100;
const MAX_REDEEM_PCT    = 20;
const REFERRAL_POINTS   = 200;
const REFERRAL_BONUS    = 100;

function generateReferralCode(name, phone) {
  const n = name.replace(/\s+/g, '').toUpperCase().slice(0, 4);
  const p = phone.slice(-4);
  return `${n}${p}`;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   NEWSLETTER WELCOME EMAIL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
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
       MODULE: COUPON
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'coupon') {
      if (!checkRateLimit(`coupon_${ip}`, 15, 60000)) {
        return res.status(429).json({ ok: false, error: 'অনেক request!' });
      }

      const code     = sanitize(
        (req.method === 'POST' ? req.body?.code : req.query?.code) || '', 50
      ).toUpperCase();
      const subtotal = parseFloat(
        (req.method === 'POST' ? req.body?.subtotal : req.query?.subtotal) || 0
      );

      if (!code) return res.status(400).json({ ok: false, error: 'Coupon code দিন!' });

      const coupon = await Coupon.findOne({ code, isActive: true });
      if (!coupon) {
        return res.status(404).json({ ok: false, error: `"${code}" একটি valid coupon code নয়!` });
      }
      if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        return res.status(400).json({ ok: false, error: 'এই coupon-এর মেয়াদ শেষ হয়ে গেছে!' });
      }
      if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
        return res.status(400).json({ ok: false, error: 'এই coupon ইতিমধ্যে সর্বোচ্চ ব্যবহার হয়ে গেছে!' });
      }
      if (subtotal > 0 && coupon.minOrder > 0 && subtotal < coupon.minOrder) {
        return res.status(400).json({
          ok: false,
          error: `এই coupon-এর জন্য কমপক্ষে ৳${coupon.minOrder.toLocaleString()} এর অর্ডার করতে হবে!`,
        });
      }

      const discountAmt = subtotal > 0
        ? (coupon.type === 'percent'
            ? Math.round(subtotal * coupon.discount / 100)
            : Math.min(coupon.discount, subtotal))
        : coupon.discount;

      return res.json({
        ok: true, code: coupon.code, type: coupon.type,
        discount: coupon.discount, discountAmt, minOrder: coupon.minOrder,
        description: coupon.description,
        message: coupon.type === 'percent'
          ? `🎉 ${coupon.discount}% ছাড় পেয়েছেন! (৳${discountAmt.toLocaleString()})`
          : `🎉 ৳${coupon.discount} ছাড় পেয়েছেন!`,
      });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: NEWSLETTER
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'newsletter') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!checkRateLimit(`nl_${ip}`, 5, 60000)) {
        return res.status(429).json({ ok: false, error: 'অনেক request!' });
      }

      const email = sanitize(req.body?.email || '', 150).toLowerCase();
      const name  = sanitize(req.body?.name  || '', 100);
      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ ok: false, error: 'সঠিক Email দিন!' });
      }

      const existing = await Newsletter.findOne({ email });
      if (existing) {
        if (!existing.isActive) {
          existing.isActive = true;
          await existing.save();
          return res.json({ ok: true, message: 'আপনি আবার subscribe হয়েছেন!' });
        }
        return res.json({ ok: true, message: 'আপনি ইতিমধ্যে subscriber!' });
      }

      await Newsletter.create({ email, name, source: 'website' });
      const couponCode = 'WELCOME10';
      sendEmail(email, '🎁 আপনার Welcome Gift — Shoplixo', newsletterWelcomeEmail(email, name, couponCode))
        .catch(() => {});

      return res.status(201).json({
        ok: true,
        message: '🎉 Subscribe সফল! Email দেখুন — Welcome coupon পাঠানো হয়েছে!',
        coupon: couponCode,
      });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: LOYALTY
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'loyalty') {
      const decoded = verifyToken(req);
      if (!decoded && action !== 'leaderboard') {
        return res.status(401).json({ ok: false, error: 'Login করুন' });
      }

      /* GET: My Balance */
      if (req.method === 'GET' && !action) {
        const user = await User.findById(decoded.id)
          .select('name phone loyaltyPoints referralCode totalReferrals totalOrders totalSpent');
        if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });
        const pointsValue = Math.floor(user.loyaltyPoints * TAKA_PER_POINT);
        return res.json({
          ok: true, balance: user.loyaltyPoints, valueInTaka: pointsValue,
          referralCode: user.referralCode, totalReferrals: user.totalReferrals,
          stats: { totalOrders: user.totalOrders, totalSpent: user.totalSpent },
          nextReward: user.loyaltyPoints >= MIN_REDEEM_POINTS
            ? `আপনি ৳${pointsValue} পর্যন্ত discount নিতে পারেন!`
            : `আরও ${MIN_REDEEM_POINTS - user.loyaltyPoints} points হলে redeem করতে পারবেন`,
        });
      }

      /* GET: Transaction History */
      if (req.method === 'GET' && action === 'history') {
        const { page = 1 } = req.query;
        const skip  = (parseInt(page) - 1) * 20;
        const total = await LoyaltyTxn.countDocuments({ userId: decoded.id });
        const txns  = await LoyaltyTxn.find({ userId: decoded.id })
          .sort({ createdAt: -1 }).skip(skip).limit(20).lean();
        return res.json({ ok: true, transactions: txns, total, page: parseInt(page) });
      }

      /* GET: Leaderboard */
      if (req.method === 'GET' && action === 'leaderboard') {
        const top = await User.find({ isActive: true })
          .sort({ loyaltyPoints: -1 }).limit(10)
          .select('name loyaltyPoints totalOrders totalReferrals').lean();
        return res.json({
          ok: true,
          leaderboard: top.map((u, i) => ({
            rank: i + 1,
            name: u.name.split(' ')[0] + (u.name.split(' ')[1] ? ' ' + u.name.split(' ')[1][0] + '.' : ''),
            points: u.loyaltyPoints, orders: u.totalOrders, referrals: u.totalReferrals,
          })),
        });
      }

      /* POST: Redeem Points (validate only) */
      if (req.method === 'POST' && action === 'redeem') {
        const { points, orderTotal } = req.body || {};
        const redeemPoints = parseInt(points) || 0;
        const total        = parseFloat(orderTotal) || 0;
        if (redeemPoints < MIN_REDEEM_POINTS) {
          return res.status(400).json({ ok: false, error: `কমপক্ষে ${MIN_REDEEM_POINTS} points redeem করতে হবে` });
        }
        const user = await User.findById(decoded.id);
        if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });
        if (user.loyaltyPoints < redeemPoints) {
          return res.status(400).json({ ok: false, error: 'পর্যাপ্ত points নেই' });
        }
        const discountTaka  = Math.floor(redeemPoints * TAKA_PER_POINT);
        const maxDiscount   = Math.floor(total * MAX_REDEEM_PCT / 100);
        const finalDiscount = Math.min(discountTaka, maxDiscount);
        const actualPoints  = Math.ceil(finalDiscount / TAKA_PER_POINT);
        return res.json({
          ok: true, redeemPoints: actualPoints, discountTaka: finalDiscount,
          remainingBalance: user.loyaltyPoints - actualPoints,
          message: `✅ ${actualPoints} points redeem করলে ৳${finalDiscount} ছাড় পাবেন`,
        });
      }

      /* POST: Deduct Points (called from orders) */
      if (req.method === 'POST' && action === 'deduct') {
        const { points, orderId } = req.body || {};
        const deductPoints = parseInt(points) || 0;
        if (deductPoints < 1) return res.status(400).json({ ok: false, error: 'Points amount দিন' });
        const user = await User.findById(decoded.id);
        if (!user || user.loyaltyPoints < deductPoints) {
          return res.status(400).json({ ok: false, error: 'পর্যাপ্ত points নেই' });
        }
        user.loyaltyPoints -= deductPoints;
        await user.save();
        await LoyaltyTxn.create({
          userId: user._id, phone: user.phone, type: 'redeem', points: -deductPoints,
          balance: user.loyaltyPoints, ref: orderId, note: `Order ${orderId} এ ${deductPoints} points redeem`,
        });
        return res.json({ ok: true, balance: user.loyaltyPoints, deducted: deductPoints });
      }

      /* POST: Earn Points (called after delivery) */
      if (req.method === 'POST' && action === 'earn') {
        const { orderTotal, orderId } = req.body || {};
        const earnedPoints = Math.floor((parseFloat(orderTotal) || 0) * POINTS_PER_TAKA);
        if (earnedPoints < 1) return res.json({ ok: true, earned: 0 });
        const user = await User.findByIdAndUpdate(
          decoded.id, { $inc: { loyaltyPoints: earnedPoints } }, { new: true }
        );
        await LoyaltyTxn.create({
          userId: user._id, phone: user.phone, type: 'earn', points: earnedPoints,
          balance: user.loyaltyPoints, ref: orderId, note: `Order ${orderId} থেকে ${earnedPoints} points অর্জন`,
        });
        return res.json({ ok: true, earned: earnedPoints, balance: user.loyaltyPoints });
      }

      /* POST: Generate Referral Code */
      if (req.method === 'POST' && action === 'refer') {
        const user = await User.findById(decoded.id);
        if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });
        if (!user.referralCode) {
          let code = generateReferralCode(user.name, user.phone);
          const existing = await User.findOne({ referralCode: code, _id: { $ne: user._id } });
          if (existing) code += Math.floor(Math.random() * 90 + 10);
          user.referralCode = code;
          await user.save();
        }
        const siteUrl = process.env.SITE_URL || 'https://shoplixo.shop';
        return res.json({
          ok: true, referralCode: user.referralCode,
          referralLink: `${siteUrl}?ref=${user.referralCode}`,
          totalReferrals: user.totalReferrals,
          message: `বন্ধুকে এই code শেয়ার করুন। সে কিনলে আপনি ${REFERRAL_POINTS} points পাবেন!`,
          rewards: {
            you: `${REFERRAL_POINTS} points = ৳${Math.floor(REFERRAL_POINTS * TAKA_PER_POINT)}`,
            friend: `${REFERRAL_BONUS} points bonus`,
          },
        });
      }

      /* POST: Apply Referral Code */
      if (req.method === 'POST' && action === 'apply-referral') {
        const { referralCode } = req.body || {};
        if (!referralCode) return res.status(400).json({ ok: false, error: 'Referral code দিন' });
        const referrer = await User.findOne({ referralCode: referralCode.toUpperCase().trim() });
        if (!referrer) return res.status(404).json({ ok: false, error: 'Invalid referral code' });
        if (String(referrer._id) === String(decoded.id)) {
          return res.status(400).json({ ok: false, error: 'নিজের referral code ব্যবহার করা যাবে না' });
        }
        const newUser = await User.findById(decoded.id);
        if (newUser.referredBy) return res.status(409).json({ ok: false, error: 'আপনি আগেই referral code use করেছেন' });

        referrer.loyaltyPoints += REFERRAL_POINTS;
        referrer.totalReferrals++;
        await referrer.save();
        await LoyaltyTxn.create({
          userId: referrer._id, phone: referrer.phone, type: 'referral', points: REFERRAL_POINTS,
          balance: referrer.loyaltyPoints, ref: newUser.phone, note: `${newUser.name} কে refer করেছেন`,
        });

        newUser.loyaltyPoints += REFERRAL_BONUS;
        newUser.referredBy = referralCode.toUpperCase();
        await newUser.save();
        await LoyaltyTxn.create({
          userId: newUser._id, phone: newUser.phone, type: 'referral', points: REFERRAL_BONUS,
          balance: newUser.loyaltyPoints, ref: referralCode, note: 'Referral bonus',
        });
        await Referral.create({
          referrerUserId: referrer._id, referrerPhone: referrer.phone,
          referralCode: referralCode.toUpperCase(),
          referredPhone: newUser.phone, referredUserId: newUser._id,
          status: 'completed', pointsAwarded: REFERRAL_POINTS,
        });

        return res.json({
          ok: true, bonusPoints: REFERRAL_BONUS, balance: newUser.loyaltyPoints,
          message: `🎉 Referral code apply হয়েছে! আপনি ${REFERRAL_BONUS} bonus points পেয়েছেন।`,
        });
      }

      return res.status(400).json({ ok: false, error: 'Invalid loyalty action' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: BUNDLE
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'bundle') {
      /* GET */
      if (req.method === 'GET') {
        const { id, productId } = req.query;

        if (id) {
          const bundle = await Bundle.findById(id);
          if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
          const products = await Product.find({ productId: { $in: bundle.productIds }, isActive: true })
            .select('productId name price orig img rating reviews stock badge').lean();
          const subtotal    = products.reduce((s, p) => s + p.price, 0);
          const discount    = bundle.discountType === 'percent'
            ? Math.round(subtotal * bundle.discountValue / 100) : bundle.discountValue;
          const bundlePrice = Math.max(0, subtotal - discount);
          return res.json({ ok: true, bundle: { ...bundle.toObject(), products, subtotal, discount, bundlePrice } });
        }

        const now   = new Date();
        const query = { isActive: true, $or: [{ startAt: { $exists: false } }, { startAt: { $lte: now } }] };
        if (productId) query.productIds = productId;

        const bundles  = await Bundle.find(query).sort({ createdAt: -1 }).limit(20).lean();
        const enriched = await Promise.all(bundles.map(async (b) => {
          const prods    = await Product.find({ productId: { $in: b.productIds }, isActive: true })
            .select('productId name price img stock').lean();
          const subtotal = prods.reduce((s, p) => s + p.price, 0);
          const discount = b.discountType === 'percent'
            ? Math.round(subtotal * b.discountValue / 100) : b.discountValue;
          return { ...b, products: prods, subtotal, discount, bundlePrice: Math.max(0, subtotal - discount) };
        }));
        return res.json({ ok: true, bundles: enriched });
      }

      /* POST: Create */
      if (req.method === 'POST') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { title, description, productIds, discountType, discountValue, img, startAt, endAt } = req.body || {};
        if (!title?.trim())          return res.status(400).json({ ok: false, error: 'Title দিন' });
        if (!Array.isArray(productIds) || productIds.length < 2)
          return res.status(400).json({ ok: false, error: 'কমপক্ষে ২টি product লাগবে' });
        if (!discountValue || discountValue < 1)
          return res.status(400).json({ ok: false, error: 'Discount amount দিন' });
        const products = await Product.find({ productId: { $in: productIds } });
        if (products.length < productIds.length)
          return res.status(400).json({ ok: false, error: 'কিছু product পাওয়া যায়নি' });
        const bundle = await Bundle.create({
          title: sanitize(title, 200), description: sanitize(description || '', 500),
          productIds, discountType: discountType || 'percent',
          discountValue: parseFloat(discountValue), img: sanitize(img || '', 500),
          startAt: startAt ? new Date(startAt) : undefined,
          endAt:   endAt   ? new Date(endAt)   : undefined,
          isActive: true,
        });
        await Product.updateMany({ productId: { $in: productIds } }, { $addToSet: { bundleIds: bundle._id.toString() } });
        return res.status(201).json({ ok: true, bundle, message: 'Bundle তৈরি হয়েছে' });
      }

      /* PATCH: Update */
      if (req.method === 'PATCH') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { id } = req.query;
        if (!id) return res.status(400).json({ ok: false, error: 'Bundle ID দিন' });
        const updates = {};
        const b = req.body || {};
        if (b.title         !== undefined) updates.title         = sanitize(b.title, 200);
        if (b.description   !== undefined) updates.description   = sanitize(b.description, 500);
        if (b.discountValue !== undefined) updates.discountValue = parseFloat(b.discountValue);
        if (b.discountType  !== undefined) updates.discountType  = b.discountType;
        if (b.isActive      !== undefined) updates.isActive      = Boolean(b.isActive);
        if (b.productIds    !== undefined) updates.productIds    = b.productIds;
        const bundle = await Bundle.findByIdAndUpdate(id, updates, { new: true });
        if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
        return res.json({ ok: true, bundle, message: 'Bundle update হয়েছে' });
      }

      /* DELETE */
      if (req.method === 'DELETE') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { id } = req.query;
        const bundle = await Bundle.findByIdAndDelete(id);
        if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
        return res.json({ ok: true, message: 'Bundle delete হয়েছে' });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: FLASH
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'flash') {
      const now = new Date();

      if (req.method === 'GET') {
        /* Countdown check */
        if (action === 'check') {
          const sale = await FlashSale.findOne({
            isActive: true, startAt: { $lte: now }, endAt: { $gt: now },
          }).select('title endAt bannerImg description').lean();
          if (!sale) {
            const upcoming = await FlashSale.findOne({ isActive: true, startAt: { $gt: now } })
              .sort({ startAt: 1 }).select('title startAt endAt').lean();
            return res.json({ ok: true, active: false, upcoming: upcoming || null });
          }
          return res.json({
            ok: true, active: true, title: sale.title, endAt: sale.endAt,
            bannerImg: sale.bannerImg, description: sale.description,
            secondsLeft: Math.max(0, Math.floor((sale.endAt - now) / 1000)),
          });
        }

        /* Admin: All */
        if (action === 'all') {
          if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
          const sales = await FlashSale.find({}).sort({ startAt: -1 }).lean();
          return res.json({
            ok: true,
            sales: sales.map(s => ({
              ...s, isLive: s.isActive && s.startAt <= now && s.endAt > now,
              isUpcoming: s.startAt > now, isExpired: s.endAt <= now,
            })),
          });
        }

        /* Single flash sale */
        if (req.query.id) {
          const sale = await FlashSale.findById(req.query.id).lean();
          if (!sale) return res.status(404).json({ ok: false, error: 'Flash sale পাওয়া যায়নি' });
          const productIds = sale.products.map(p => p.productId);
          const dbProds    = await Product.find({ productId: { $in: productIds }, isActive: true })
            .select('productId name price orig img badge rating reviews stock').lean();
          const prodMap = Object.fromEntries(dbProds.map(p => [p.productId, p]));
          return res.json({
            ok: true,
            sale: {
              ...sale,
              products: sale.products.map(sp => ({
                ...sp, ...(prodMap[sp.productId] || {}),
                flashPrice: sp.salePrice,
                origPrice:  sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice,
                savings:    (sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice) - sp.salePrice,
              })),
              isLive: sale.isActive && sale.startAt <= now && sale.endAt > now,
              secondsLeft: sale.endAt > now ? Math.floor((sale.endAt - now) / 1000) : 0,
            },
          });
        }

        /* Public: Active flash sales */
        const sales    = await FlashSale.find({ isActive: true, startAt: { $lte: now }, endAt: { $gt: now } })
          .sort({ endAt: 1 }).lean();
        const enriched = await Promise.all(sales.map(async (sale) => {
          const productIds = sale.products.map(p => p.productId);
          const dbProds    = await Product.find({ productId: { $in: productIds }, isActive: true })
            .select('productId name price img badge rating stock').lean();
          const prodMap = Object.fromEntries(dbProds.map(p => [p.productId, p]));
          return {
            ...sale,
            products: sale.products.map(sp => ({
              ...sp,
              name: prodMap[sp.productId]?.name || '',
              img:  prodMap[sp.productId]?.img  || '',
              currentStock: prodMap[sp.productId]?.stock || sp.stock,
              savings: (sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice) - sp.salePrice,
            })),
            secondsLeft: Math.floor((sale.endAt - now) / 1000),
            totalItems:  sale.products.length,
          };
        }));
        return res.json({ ok: true, sales: enriched, count: enriched.length });
      }

      /* Admin-only write operations */
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

      /* POST: Create */
      if (req.method === 'POST' && !action) {
        const b = req.body || {};
        if (!b.title)   return res.status(400).json({ ok: false, error: 'Title দিন' });
        if (!b.startAt) return res.status(400).json({ ok: false, error: 'Start time দিন' });
        if (!b.endAt)   return res.status(400).json({ ok: false, error: 'End time দিন' });
        if (!Array.isArray(b.products) || !b.products.length)
          return res.status(400).json({ ok: false, error: 'কমপক্ষে ১টি product দিন' });

        const startAt = new Date(b.startAt);
        const endAt   = new Date(b.endAt);
        if (isNaN(startAt.getTime()) || isNaN(endAt.getTime()))
          return res.status(400).json({ ok: false, error: 'Valid date দিন' });
        if (endAt <= startAt)
          return res.status(400).json({ ok: false, error: 'End time start time এর পরে হতে হবে' });

        const products = b.products.slice(0, 50).map(p => ({
          productId: String(p.productId || ''),
          salePrice: Math.max(0, parseFloat(p.salePrice) || 0),
          origPrice: Math.max(0, parseFloat(p.origPrice) || 0),
          stock:     Math.max(0, parseInt(p.stock) || 10),
          soldCount: 0,
        })).filter(p => p.productId && p.salePrice > 0);
        if (!products.length)
          return res.status(400).json({ ok: false, error: 'Valid products দিন (productId ও salePrice required)' });

        const sale = await FlashSale.create({
          title: sanitize(b.title, 200), description: sanitize(b.description || '', 500),
          startAt, endAt, isActive: b.isActive !== false, products,
          extraDiscountPct: parseFloat(b.extraDiscountPct) || 0,
          bannerImg: sanitize(b.bannerImg || '', 500),
        });

        if (sale.isActive && startAt <= now && endAt > now) {
          Product.updateMany({ productId: { $in: products.map(p => p.productId) } }, { $set: { isFlash: true } }).catch(() => {});
        }
        return res.status(201).json({ ok: true, sale, message: 'Flash sale তৈরি হয়েছে!' });
      }

      /* PATCH: Update */
      if (req.method === 'PATCH') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ ok: false, error: 'Flash sale ID দিন' });
        const b = req.body || {};
        const updates = {};
        if (b.title        !== undefined) updates.title       = sanitize(b.title, 200);
        if (b.description  !== undefined) updates.description = sanitize(b.description, 500);
        if (b.startAt      !== undefined) updates.startAt     = new Date(b.startAt);
        if (b.endAt        !== undefined) updates.endAt       = new Date(b.endAt);
        if (b.isActive     !== undefined) updates.isActive    = Boolean(b.isActive);
        if (b.bannerImg    !== undefined) updates.bannerImg   = sanitize(b.bannerImg, 500);
        if (b.extraDiscountPct !== undefined) updates.extraDiscountPct = parseFloat(b.extraDiscountPct) || 0;
        if (b.products     !== undefined) {
          updates.products = b.products.slice(0, 50).map(p => ({
            productId: String(p.productId || ''), salePrice: Math.max(0, parseFloat(p.salePrice) || 0),
            origPrice: Math.max(0, parseFloat(p.origPrice) || 0),
            stock: Math.max(0, parseInt(p.stock) || 10), soldCount: parseInt(p.soldCount) || 0,
          }));
        }
        const sale = await FlashSale.findByIdAndUpdate(id, updates, { new: true });
        if (!sale) return res.status(404).json({ ok: false, error: 'Flash sale পাওয়া যায়নি' });
        return res.json({ ok: true, sale, message: 'Flash sale আপডেট হয়েছে' });
      }

      /* POST: Toggle */
      if (req.method === 'POST' && action === 'toggle') {
        const id = req.query.id || req.body?.id;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const sale = await FlashSale.findById(id);
        if (!sale) return res.status(404).json({ ok: false, error: 'পাওয়া যায়নি' });
        sale.isActive = !sale.isActive;
        await sale.save();
        const pIds = sale.products.map(p => p.productId);
        if (sale.isActive && sale.startAt <= now && sale.endAt > now) {
          Product.updateMany({ productId: { $in: pIds } }, { isFlash: true }).catch(() => {});
        } else {
          Product.updateMany({ productId: { $in: pIds } }, { isFlash: false }).catch(() => {});
        }
        return res.json({ ok: true, isActive: sale.isActive });
      }

      /* DELETE */
      if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const sale = await FlashSale.findByIdAndDelete(id);
        if (!sale) return res.status(404).json({ ok: false, error: 'পাওয়া যায়নি' });
        Product.updateMany({ productId: { $in: sale.products.map(p => p.productId) } }, { isFlash: false }).catch(() => {});
        return res.json({ ok: true, message: 'Flash sale delete হয়েছে' });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ── Unknown module ────────────────────────────────────────── */
    return res.status(400).json({
      ok: false,
      error: 'Invalid module. Use: coupon, newsletter, loyalty, bundle, flash',
    });

  } catch (err) {
    console.error('Commerce API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
