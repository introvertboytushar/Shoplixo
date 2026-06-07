/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/content
 *  Merged: Search · Comments (Reviews) · Categories
 *
 *  ── SEARCH ───────────────────────────────────────────────────
 *  GET /api/content?module=search&q=shirt&cat=mens&min=500...
 *  GET /api/content?module=search&action=suggest&q=sh  → Autocomplete
 *  GET /api/content?module=search&action=popular       → Popular searches
 *
 *  ── COMMENTS (Reviews) ───────────────────────────────────────
 *  GET  /api/content?module=comments&productId=xxx          → Product reviews
 *  POST /api/content?module=comments                        → Add review
 *  POST /api/content?module=comments&action=helpful         → Helpful vote
 *  POST /api/content?module=comments&action=reply (admin)   → Admin reply
 *  PATCH /api/content?module=comments&action=approve (admin)→ Approve review
 *  PATCH /api/content?module=comments&action=hide (admin)   → Hide review
 *  DELETE /api/content?module=comments&id=xxx (admin)       → Delete review
 *  GET /api/content?module=comments&action=pending (admin)  → Pending reviews
 *
 *  ── CATEGORIES ───────────────────────────────────────────────
 *  GET    /api/content?module=categories             → All active categories
 *  GET    /api/content?module=categories&slug=xxx    → Single category
 *  GET    /api/content?module=categories&featured=1  → Featured only
 *  POST   /api/content?module=categories (admin)     → Create category
 *  PATCH  /api/content?module=categories&id=xxx      → Update category
 *  DELETE /api/content?module=categories&id=xxx      → Delete (if empty)
 *  POST   /api/content?module=categories&action=reorder → Reorder
 * ══════════════════════════════════════════════════════════════
 */

const { connectDB, Product, Comment, Order, Category } = require('../_db');
const { handleCors, isAdmin, verifyToken, sanitize, checkRateLimit, slugify } = require('../_helpers');

/* In-memory popular searches (use Redis in production) */
const popularSearches = new Map();

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
       MODULE: SEARCH
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'search') {
      if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });
      if (!checkRateLimit(`search_${ip}`, 60, 60000)) {
        return res.status(429).json({ ok: false, error: 'অনেক request! একটু অপেক্ষা করুন।' });
      }

      /* Autocomplete Suggestions */
      if (action === 'suggest') {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json({ ok: true, suggestions: [] });
        const products = await Product.find({
          isActive: true,
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { tags: { $in: [new RegExp(q, 'i')] } },
          ],
        }).limit(8).select('name cat price img productId').lean();
        return res.json({
          ok: true,
          suggestions: products.map(p => ({ id: p.productId, name: p.name, cat: p.cat, price: p.price, img: p.img })),
        });
      }

      /* Popular Searches */
      if (action === 'popular') {
        const defaultPopular = [
          'শার্ট','প্যান্ট','জুতা','কুর্তি','স্মার্টওয়াচ',
          'ইয়ারবাড','পাঞ্জাবি','ড্রেস','স্নিকার','পাওয়ার ব্যাংক',
        ];
        const sorted = [...popularSearches.entries()]
          .sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
        return res.json({ ok: true, popular: sorted.length ? sorted : defaultPopular });
      }

      /* Main Search + Filter */
      const {
        q, cat, min, max, rating, sort = 'relevance',
        inStock, isFeatured, isNew, isFlash, badge,
        page = 1, limit = 16,
      } = req.query;

      const query   = { isActive: true };
      const hasText = q && String(q).trim().length > 0;

      if (hasText) {
        const term = String(q).trim();
        query.$or  = [
          { name: { $regex: term, $options: 'i' } },
          { tags: { $in: [new RegExp(term, 'i')] } },
          { desc: { $regex: term, $options: 'i' } },
          { sku:  { $regex: term, $options: 'i' } },
        ];
        const key = term.toLowerCase();
        popularSearches.set(key, (popularSearches.get(key) || 0) + 1);
      }

      if (cat)                 query.cat        = Array.isArray(cat) ? { $in: cat } : cat;
      if (min || max)          query.price      = { ...(min ? { $gte: parseFloat(min) } : {}), ...(max ? { $lte: parseFloat(max) } : {}) };
      if (rating)              query.rating     = { $gte: parseFloat(rating) };
      if (inStock === 'true')  query.stock      = { $gt: 0 };
      if (isFeatured === 'true') query.isFeatured = true;
      if (isNew === 'true')    query.isNew      = true;
      if (isFlash === 'true')  query.isFlash    = true;
      if (badge)               query.badge      = badge;

      const sortMap = {
        relevance:  hasText ? { score: { $meta: 'textScore' } } : { createdAt: -1 },
        newest:     { createdAt: -1 }, oldest: { createdAt: 1 },
        price_asc:  { price: 1 }, price_desc: { price: -1 },
        rating:     { rating: -1, reviews: -1 },
        popular:    { totalSold: -1 }, discount: { discount: -1 },
      };

      const skip     = (parseInt(page) - 1) * parseInt(limit);
      const lim      = Math.min(parseInt(limit) || 16, 48);
      const total    = await Product.countDocuments(query);
      const products = await Product.find(query)
        .sort(sortMap[sort] || { createdAt: -1 }).skip(skip).limit(lim)
        .select('productId name cat price orig img badge rating reviews stock isFeatured isNew isFlash colors sizes viewers')
        .lean();

      const facets = await Product.aggregate([
        { $match: { isActive: true, ...(cat ? { cat } : {}) } },
        { $facet: {
          categories: [{ $group: { _id: '$cat', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          priceRange: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }],
          badges:     [{ $group: { _id: '$badge', count: { $sum: 1 } } }],
        }},
      ]);

      return res.json({
        ok: true, query: { q, cat, min, max, rating, sort, inStock },
        products, total, page: parseInt(page), pages: Math.ceil(total / lim),
        facets: facets[0] || {},
        message: total === 0 ? `"${q}" এর কোনো পণ্য পাওয়া যায়নি` : null,
      });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: COMMENTS
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'comments') {

      /* GET: Product Reviews */
      if (req.method === 'GET' && !action) {
        const { productId, page = 1, limit = 10, sort = 'newest', rating } = req.query;
        if (!productId) return res.status(400).json({ ok: false, error: 'productId দিন' });

        const query = { productId, isApproved: true, isHidden: false };
        if (rating) query.rating = parseInt(rating);

        const sortMap = {
          newest: { createdAt: -1 }, oldest: { createdAt: 1 },
          highest: { rating: -1 }, lowest: { rating: 1 }, helpful: { helpfulCount: -1 },
        };
        const skip     = (parseInt(page) - 1) * parseInt(limit);
        const total    = await Comment.countDocuments(query);
        const comments = await Comment.find(query)
          .sort(sortMap[sort] || { createdAt: -1 }).skip(skip).limit(parseInt(limit))
          .select('-customerPhone -isHidden -helpfulVotes').lean();

        const allRatings = await Comment.aggregate([
          { $match: { productId, isApproved: true } },
          { $group: { _id: '$rating', count: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
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

      /* GET: Pending Reviews (admin) */
      if (req.method === 'GET' && action === 'pending') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const pending = await Comment.find({ isApproved: false, isHidden: false })
          .sort({ createdAt: -1 }).limit(50).lean();
        return res.json({ ok: true, comments: pending, total: pending.length });
      }

      /* POST: Add Review */
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

        if (!productId)               return res.status(400).json({ ok: false, error: 'Product ID দিন' });
        if (rating < 1 || rating > 5) return res.status(400).json({ ok: false, error: 'Rating 1-5 এর মধ্যে দিন' });
        if (!body || body.length < 10) return res.status(400).json({ ok: false, error: 'Review কমপক্ষে ১০ অক্ষর লিখুন' });
        if (!customerName)             return res.status(400).json({ ok: false, error: 'নাম দিন' });

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

        if (reviewerPhone) {
          const dup = await Comment.findOne({ productId, customerPhone: reviewerPhone });
          if (dup) return res.status(409).json({ ok: false, error: 'আপনি এই পণ্যে আগেই review দিয়েছেন' });
        }

        const comment = await Comment.create({
          productId, orderId, userId: decoded?.id || null,
          customerName, customerPhone: reviewerPhone,
          rating, title, body, images, size, color,
          isVerifiedPurchase, isApproved: isVerifiedPurchase,
        });

        if (comment.isApproved) {
          const agg = await Comment.aggregate([
            { $match: { productId, isApproved: true } },
            { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
          ]);
          if (agg.length) {
            await Product.updateOne({ productId }, { rating: Math.round(agg[0].avg * 10) / 10, reviews: agg[0].count });
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

      /* POST: Helpful Vote */
      if (req.method === 'POST' && action === 'helpful') {
        const { commentId } = req.body || {};
        if (!commentId) return res.status(400).json({ ok: false, error: 'commentId দিন' });
        const comment = await Comment.findById(commentId);
        if (!comment) return res.status(404).json({ ok: false, error: 'Review পাওয়া যায়নি' });
        const idx = comment.helpfulVotes.indexOf(ip);
        let helpful;
        if (idx === -1) {
          comment.helpfulVotes.push(ip);
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

      /* POST: Admin Reply */
      if (req.method === 'POST' && action === 'reply') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { commentId, text } = req.body || {};
        const comment = await Comment.findByIdAndUpdate(commentId,
          { reply: { text: sanitize(text, 500), repliedAt: new Date() } }, { new: true }
        );
        if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
        return res.json({ ok: true, comment });
      }

      /* PATCH: Approve / Hide (admin) */
      if (req.method === 'PATCH' && (action === 'approve' || action === 'hide')) {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { commentId } = req.body || {};
        const update = action === 'approve' ? { isApproved: true, isHidden: false } : { isHidden: true, isApproved: false };
        const comment = await Comment.findByIdAndUpdate(commentId, update, { new: true });
        if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
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

      /* DELETE: Admin */
      if (req.method === 'DELETE') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { id } = req.query;
        const comment = await Comment.findByIdAndDelete(id);
        if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
        return res.json({ ok: true, message: 'Review delete হয়েছে' });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: CATEGORIES
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'categories') {

      /* GET: Public */
      if (req.method === 'GET') {
        const { slug, featured, parent } = req.query;

        if (slug) {
          const cat = await Category.findOne({ slug, isActive: true }).lean();
          if (!cat) return res.status(404).json({ ok: false, error: 'Category পাওয়া যায়নি' });
          const count = await Product.countDocuments({ cat: cat.slug, isActive: true });
          return res.json({ ok: true, category: { ...cat, productCount: count } });
        }

        const query = { isActive: true };
        if (featured)          query.isFeatured = true;
        if (parent !== undefined) query.parentSlug = parent || '';

        const cats     = await Category.find(query).sort({ sortOrder: 1, name: 1 }).lean();
        const enriched = await Promise.all(cats.map(async c => {
          const count = await Product.countDocuments({ cat: c.slug, isActive: true });
          return { ...c, productCount: count };
        }));

        const roots    = enriched.filter(c => !c.parentSlug);
        const children = enriched.filter(c => c.parentSlug);
        const tree     = roots.map(r => ({ ...r, children: children.filter(c => c.parentSlug === r.slug) }));

        return res.json({ ok: true, categories: enriched, tree, total: enriched.length });
      }

      /* Admin only below */
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

      /* POST: Create */
      if (req.method === 'POST' && !action) {
        const b = req.body || {};
        if (!b.name?.trim()) return res.status(400).json({ ok: false, error: 'Category নাম দিন' });
        const slug = slugify(b.slug || b.name);
        const existing = await Category.findOne({ slug });
        if (existing) return res.status(409).json({ ok: false, error: `Slug "${slug}" ইতিমধ্যে আছে` });
        const cat = await Category.create({
          slug, name: sanitize(b.name, 100), nameBn: sanitize(b.nameBn || '', 100),
          icon: sanitize(b.icon || '', 100), img: sanitize(b.img || '', 500),
          parentSlug: sanitize(b.parentSlug || '', 50),
          description: sanitize(b.description || '', 500),
          isActive: b.isActive !== false, isFeatured: Boolean(b.isFeatured),
          sortOrder: parseInt(b.sortOrder) || 0,
          seoTitle: sanitize(b.seoTitle || '', 200), seoDesc: sanitize(b.seoDesc || '', 500),
        });
        return res.status(201).json({ ok: true, category: cat, message: '✅ Category তৈরি হয়েছে!' });
      }

      /* PATCH: Update */
      if (req.method === 'PATCH') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const b = req.body || {};
        const updates = {};
        ['name','nameBn','icon','img','parentSlug','description','seoTitle','seoDesc'].forEach(f => {
          if (b[f] !== undefined) updates[f] = sanitize(b[f], 500);
        });
        if (b.isActive   !== undefined) updates.isActive   = Boolean(b.isActive);
        if (b.isFeatured !== undefined) updates.isFeatured = Boolean(b.isFeatured);
        if (b.sortOrder  !== undefined) updates.sortOrder  = parseInt(b.sortOrder);
        const cat = await Category.findByIdAndUpdate(id, updates, { new: true });
        if (!cat) return res.status(404).json({ ok: false, error: 'Category পাওয়া যায়নি' });
        return res.json({ ok: true, category: cat, message: 'Category update হয়েছে' });
      }

      /* POST: Reorder */
      if (req.method === 'POST' && action === 'reorder') {
        const { order } = req.body || {};
        if (!Array.isArray(order)) return res.status(400).json({ ok: false, error: 'order array দিন' });
        await Promise.all(order.map((id, i) => Category.findByIdAndUpdate(id, { sortOrder: i })));
        return res.json({ ok: true, message: 'Category order আপডেট হয়েছে' });
      }

      /* DELETE */
      if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const cat = await Category.findById(id);
        if (!cat) return res.status(404).json({ ok: false, error: 'Category পাওয়া যায়নি' });
        const productCount = await Product.countDocuments({ cat: cat.slug });
        if (productCount > 0) {
          return res.status(400).json({
            ok: false,
            error: `এই category তে ${productCount}টি product আছে। প্রথমে product গুলো সরান।`,
          });
        }
        await Category.findByIdAndDelete(id);
        return res.json({ ok: true, message: `"${cat.name}" category delete হয়েছে` });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ── Unknown module ────────────────────────────────────────── */
    return res.status(400).json({
      ok: false,
      error: 'Invalid module. Use: search, comments, categories',
    });

  } catch (err) {
    console.error('Content API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
