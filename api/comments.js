/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/comments
 *  Product Reviews + Ratings System
 *
 *  GET  /api/comments?productId=xxx           → product reviews
 *  POST /api/comments                         → review দিন
 *  POST /api/comments?action=helpful          → helpful vote
 *  POST /api/comments?action=reply (admin)    → admin reply
 *  PATCH /api/comments?action=approve (admin) → approve review
 *  DELETE /api/comments?id=xxx (admin)        → delete review
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, Comment, Order, Product } = require('../_db');
const { handleCors, isAdmin, verifyToken, sanitize, checkRateLimit } = require('../_helpers');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || '';

  try {
    await connectDB();
    const action = req.query?.action || '';

    /* ── GET: Product Reviews ────────────────────────────────── */
    if (req.method === 'GET') {
      const { productId, page = 1, limit = 10, sort = 'newest', rating } = req.query;
      if (!productId) return res.status(400).json({ ok: false, error: 'productId দিন' });

      const query = { productId, isApproved: true, isHidden: false };
      if (rating) query.rating = parseInt(rating);

      const sortMap = {
        newest:  { createdAt: -1 },
        oldest:  { createdAt: 1 },
        highest: { rating: -1 },
        lowest:  { rating: 1 },
        helpful: { helpfulCount: -1 },
      };

      const skip  = (parseInt(page) - 1) * parseInt(limit);
      const total = await Comment.countDocuments(query);
      const comments = await Comment.find(query)
        .sort(sortMap[sort] || { createdAt: -1 })
        .skip(skip).limit(parseInt(limit))
        .select('-customerPhone -isHidden -helpfulVotes')
        .lean();

      // Rating stats
      const allRatings = await Comment.aggregate([
        { $match: { productId, isApproved: true } },
        { $group: {
          _id: '$rating',
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' },
        }},
      ]);

      const ratingDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let totalRating = 0, totalCount = 0;
      allRatings.forEach(r => {
        ratingDist[r._id] = r.count;
        totalRating += r._id * r.count;
        totalCount  += r.count;
      });
      const avgRating = totalCount ? (totalRating / totalCount).toFixed(1) : 0;

      return res.json({
        ok: true, comments, total, avgRating: parseFloat(avgRating),
        ratingDist, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
      });
    }

    /* ── POST: Add Review ────────────────────────────────────── */
    if (req.method === 'POST' && !action) {
      if (!checkRateLimit(`review_${ip}`, 3, 300000)) {
        return res.status(429).json({ ok: false, error: '৫ মিনিটে সর্বোচ্চ ৩টি review দেওয়া যাবে' });
      }

      const b = req.body || {};
      const productId    = sanitize(b.productId || '', 50);
      const rating       = parseInt(b.rating) || 0;
      const body         = sanitize(b.body || '', 1000);
      const title        = sanitize(b.title || '', 100);
      const customerName = sanitize(b.customerName || '', 100);
      const orderId      = sanitize(b.orderId || '', 20);
      const size         = sanitize(b.size  || '', 30);
      const color        = sanitize(b.color || '', 30);
      const images       = Array.isArray(b.images) ? b.images.slice(0, 5).map(i => sanitize(i, 500)) : [];

      if (!productId)              return res.status(400).json({ ok: false, error: 'Product ID দিন' });
      if (rating < 1 || rating > 5)return res.status(400).json({ ok: false, error: 'Rating 1-5 এর মধ্যে দিন' });
      if (!body || body.length < 10) return res.status(400).json({ ok: false, error: 'Review কমপক্ষে ১০ অক্ষর লিখুন' });
      if (!customerName)           return res.status(400).json({ ok: false, error: 'নাম দিন' });

      // Check verified purchase
      let isVerifiedPurchase = false;
      let reviewerPhone = '';
      const decoded = verifyToken(req);
      if (decoded) {
        const { User } = require('../_db');
        const user = await User.findById(decoded.id);
        if (user) {
          reviewerPhone = user.phone;
          if (orderId) {
            const order = await Order.findOne({
              orderId, 'customer.phone': user.phone,
              status: { $in: ['delivered','confirmed','processing','shipped'] },
              'items.productId': productId,
            });
            if (order) isVerifiedPurchase = true;
          }
        }
      }

      // Check duplicate (same productId + phone)
      if (reviewerPhone) {
        const dup = await Comment.findOne({ productId, customerPhone: reviewerPhone });
        if (dup) return res.status(409).json({ ok: false, error: 'আপনি এই পণ্যে আগেই review দিয়েছেন' });
      }

      const comment = await Comment.create({
        productId, orderId, userId: decoded?.id || null,
        customerName, customerPhone: reviewerPhone,
        rating, title, body, images, size, color,
        isVerifiedPurchase,
        isApproved: isVerifiedPurchase, // auto-approve verified purchases
      });

      // Update product rating (only if approved)
      if (comment.isApproved) {
        const agg = await Comment.aggregate([
          { $match: { productId, isApproved: true } },
          { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
        ]);
        if (agg.length) {
          await Product.updateOne({ productId }, {
            rating: Math.round(agg[0].avg * 10) / 10,
            reviews: agg[0].count,
          });
        }
      }

      return res.status(201).json({
        ok: true,
        comment: { ...comment.toObject(), customerPhone: undefined },
        message: comment.isApproved
          ? '✅ Review publish হয়েছে!'
          : '✅ Review পাঠানো হয়েছে। Admin approve করার পর publish হবে।',
      });
    }

    /* ── POST: Helpful Vote ──────────────────────────────────── */
    if (req.method === 'POST' && action === 'helpful') {
      const { commentId } = req.body || {};
      if (!commentId) return res.status(400).json({ ok: false, error: 'commentId দিন' });

      const voterKey = ip;
      const comment  = await Comment.findById(commentId);
      if (!comment) return res.status(404).json({ ok: false, error: 'Review পাওয়া যায়নি' });

      const idx = comment.helpfulVotes.indexOf(voterKey);
      let helpful;
      if (idx === -1) {
        comment.helpfulVotes.push(voterKey);
        comment.helpfulCount++;
        helpful = true;
      } else {
        comment.helpfulVotes.splice(idx, 1);
        comment.helpfulCount = Math.max(0, comment.helpfulCount - 1);
        helpful = false;
      }
      await comment.save();
      return res.json({ ok: true, helpful, helpfulCount: comment.helpfulCount });
    }

    /* ── POST: Admin Reply ───────────────────────────────────── */
    if (req.method === 'POST' && action === 'reply') {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { commentId, text } = req.body || {};
      const comment = await Comment.findByIdAndUpdate(commentId,
        { reply: { text: sanitize(text, 500), repliedAt: new Date() } },
        { new: true }
      );
      if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
      return res.json({ ok: true, comment });
    }

    /* ── PATCH: Approve / Hide (Admin) ───────────────────────── */
    if (req.method === 'PATCH' && (action === 'approve' || action === 'hide')) {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { commentId } = req.body || {};
      const update = action === 'approve'
        ? { isApproved: true, isHidden: false }
        : { isHidden: true, isApproved: false };

      const comment = await Comment.findByIdAndUpdate(commentId, update, { new: true });
      if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });

      // Recalculate product rating
      const agg = await Comment.aggregate([
        { $match: { productId: comment.productId, isApproved: true } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]);
      if (agg.length) {
        await Product.updateOne({ productId: comment.productId }, {
          rating: Math.round(agg[0].avg * 10) / 10, reviews: agg[0].count,
        });
      }
      return res.json({ ok: true, comment, message: `Review ${action === 'approve' ? 'approve' : 'hidden'} হয়েছে` });
    }

    /* ── DELETE: Admin ───────────────────────────────────────── */
    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { id } = req.query;
      const comment = await Comment.findByIdAndDelete(id);
      if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
      return res.json({ ok: true, message: 'Review delete হয়েছে' });
    }

    /* ── GET: Admin Pending Reviews ──────────────────────────── */
    if (req.method === 'GET' && action === 'pending') {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const pending = await Comment.find({ isApproved: false, isHidden: false })
        .sort({ createdAt: -1 }).limit(50).lean();
      return res.json({ ok: true, comments: pending, total: pending.length });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Comments API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};