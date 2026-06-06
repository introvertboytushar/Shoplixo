/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/loyalty
 *  Loyalty Points + Referral Program
 *
 *  GET  /api/loyalty               → আমার points দেখুন
 *  GET  /api/loyalty?action=history → Transaction history
 *  POST /api/loyalty?action=redeem  → Points দিয়ে discount নিন
 *  POST /api/loyalty?action=refer   → Referral code তৈরি
 *  POST /api/loyalty?action=apply-referral → Referral apply করুন
 *  GET  /api/loyalty?action=leaderboard → Top earners
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, User, LoyaltyTxn, Referral } = require('../_db');
const { handleCors, verifyToken, sanitize } = require('../_helpers');

// Points config
const POINTS_PER_TAKA    = 0.1;   // ১০ টাকা = ১ point
const TAKA_PER_POINT     = 0.5;   // ১ point = ৳0.50
const MIN_REDEEM_POINTS  = 100;   // minimum ১০০ points redeem
const MAX_REDEEM_PCT     = 20;    // order total এর সর্বোচ্চ ২০% redeem
const REFERRAL_POINTS    = 200;   // referral এ ২০০ points
const REFERRAL_BONUS     = 100;   // referred user ও ১০০ points পাবে
const REGISTER_POINTS    = 50;    // registration bonus

function generateReferralCode(name, phone) {
  const n = name.replace(/\s+/g, '').toUpperCase().slice(0, 4);
  const p = phone.slice(-4);
  return `${n}${p}`;
}

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  const action  = req.query?.action || '';
  const decoded = verifyToken(req);
  if (!decoded && action !== 'leaderboard') {
    return res.status(401).json({ ok: false, error: 'Login করুন' });
  }

  try {
    await connectDB();

    /* ── GET: My Balance ──────────────────────────────────────── */
    if (req.method === 'GET' && !action) {
      const user = await User.findById(decoded.id)
        .select('name phone loyaltyPoints referralCode totalReferrals totalOrders totalSpent');
      if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });

      const pointsValue = Math.floor(user.loyaltyPoints * TAKA_PER_POINT);

      return res.json({
        ok: true,
        balance: user.loyaltyPoints,
        valueInTaka: pointsValue,
        referralCode: user.referralCode,
        totalReferrals: user.totalReferrals,
        stats: { totalOrders: user.totalOrders, totalSpent: user.totalSpent },
        nextReward: user.loyaltyPoints >= MIN_REDEEM_POINTS
          ? `আপনি ৳${pointsValue} পর্যন্ত discount নিতে পারেন!`
          : `আরও ${MIN_REDEEM_POINTS - user.loyaltyPoints} points হলে redeem করতে পারবেন`,
      });
    }

    /* ── GET: Transaction History ─────────────────────────────── */
    if (req.method === 'GET' && action === 'history') {
      const { page = 1 } = req.query;
      const skip  = (parseInt(page) - 1) * 20;
      const total = await LoyaltyTxn.countDocuments({ userId: decoded.id });
      const txns  = await LoyaltyTxn.find({ userId: decoded.id })
        .sort({ createdAt: -1 }).skip(skip).limit(20).lean();

      return res.json({ ok: true, transactions: txns, total, page: parseInt(page) });
    }

    /* ── GET: Leaderboard ─────────────────────────────────────── */
    if (req.method === 'GET' && action === 'leaderboard') {
      const top = await User.find({ isActive: true })
        .sort({ loyaltyPoints: -1 }).limit(10)
        .select('name loyaltyPoints totalOrders totalReferrals').lean();

      return res.json({
        ok: true,
        leaderboard: top.map((u, i) => ({
          rank: i + 1,
          name: u.name.split(' ')[0] + (u.name.split(' ')[1] ? ' ' + u.name.split(' ')[1][0] + '.' : ''),
          points: u.loyaltyPoints,
          orders: u.totalOrders,
          referrals: u.totalReferrals,
        })),
      });
    }

    /* ── POST: Redeem Points ──────────────────────────────────── */
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

      const discountTaka = Math.floor(redeemPoints * TAKA_PER_POINT);
      const maxDiscount  = Math.floor(total * MAX_REDEEM_PCT / 100);
      const finalDiscount = Math.min(discountTaka, maxDiscount);
      const actualPoints  = Math.ceil(finalDiscount / TAKA_PER_POINT);

      // Check: don't finalize, just validate and return discount amount
      // Actual deduction happens when order is placed with `pointsRedeemed` flag
      return res.json({
        ok: true,
        redeemPoints: actualPoints,
        discountTaka: finalDiscount,
        remainingBalance: user.loyaltyPoints - actualPoints,
        message: `✅ ${actualPoints} points redeem করলে ৳${finalDiscount} ছাড় পাবেন`,
      });
    }

    /* ── POST: Finalize Points Deduction (called from orders API) */
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
        userId: user._id, phone: user.phone,
        type: 'redeem', points: -deductPoints,
        balance: user.loyaltyPoints,
        ref: orderId, note: `Order ${orderId} এ ${deductPoints} points redeem`,
      });

      return res.json({ ok: true, balance: user.loyaltyPoints, deducted: deductPoints });
    }

    /* ── POST: Add Points (called from orders API after delivery) */
    if (req.method === 'POST' && action === 'earn') {
      const { orderTotal, orderId } = req.body || {};
      const earnedPoints = Math.floor((parseFloat(orderTotal) || 0) * POINTS_PER_TAKA);
      if (earnedPoints < 1) return res.json({ ok: true, earned: 0 });

      const user = await User.findByIdAndUpdate(
        decoded.id,
        { $inc: { loyaltyPoints: earnedPoints } },
        { new: true }
      );

      await LoyaltyTxn.create({
        userId: user._id, phone: user.phone,
        type: 'earn', points: earnedPoints,
        balance: user.loyaltyPoints,
        ref: orderId, note: `Order ${orderId} থেকে ${earnedPoints} points অর্জন`,
      });

      return res.json({ ok: true, earned: earnedPoints, balance: user.loyaltyPoints });
    }

    /* ── POST: Generate Referral Code ────────────────────────── */
    if (req.method === 'POST' && action === 'refer') {
      const user = await User.findById(decoded.id);
      if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });

      if (!user.referralCode) {
        let code = generateReferralCode(user.name, user.phone);
        // Ensure uniqueness
        const existing = await User.findOne({ referralCode: code, _id: { $ne: user._id } });
        if (existing) code += Math.floor(Math.random() * 90 + 10);
        user.referralCode = code;
        await user.save();
      }

      const siteUrl = process.env.SITE_URL || 'https://shoplixo.shop';
      return res.json({
        ok: true,
        referralCode: user.referralCode,
        referralLink: `${siteUrl}?ref=${user.referralCode}`,
        totalReferrals: user.totalReferrals,
        message: `বন্ধুকে এই code শেয়ার করুন। সে কিনলে আপনি ${REFERRAL_POINTS} points পাবেন!`,
        rewards: {
          you: `${REFERRAL_POINTS} points = ৳${Math.floor(REFERRAL_POINTS * TAKA_PER_POINT)}`,
          friend: `${REFERRAL_BONUS} points bonus`,
        },
      });
    }

    /* ── POST: Apply Referral Code (during registration) ─────── */
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

      // Award points to referrer
      referrer.loyaltyPoints += REFERRAL_POINTS;
      referrer.totalReferrals++;
      await referrer.save();

      await LoyaltyTxn.create({
        userId: referrer._id, phone: referrer.phone,
        type: 'referral', points: REFERRAL_POINTS,
        balance: referrer.loyaltyPoints,
        ref: newUser.phone, note: `${newUser.name} কে refer করেছেন`,
      });

      // Award bonus to new user
      newUser.loyaltyPoints += REFERRAL_BONUS;
      newUser.referredBy = referralCode.toUpperCase();
      await newUser.save();

      await LoyaltyTxn.create({
        userId: newUser._id, phone: newUser.phone,
        type: 'referral', points: REFERRAL_BONUS,
        balance: newUser.loyaltyPoints,
        ref: referralCode, note: `Referral bonus`,
      });

      await Referral.create({
        referrerUserId: referrer._id, referrerPhone: referrer.phone,
        referralCode: referralCode.toUpperCase(),
        referredPhone: newUser.phone, referredUserId: newUser._id,
        status: 'completed', pointsAwarded: REFERRAL_POINTS,
      });

      return res.json({
        ok: true,
        bonusPoints: REFERRAL_BONUS,
        balance: newUser.loyaltyPoints,
        message: `🎉 Referral code apply হয়েছে! আপনি ${REFERRAL_BONUS} bonus points পেয়েছেন।`,
      });
    }

    return res.status(400).json({ ok: false, error: 'Invalid action' });

  } catch (err) {
    console.error('Loyalty API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};