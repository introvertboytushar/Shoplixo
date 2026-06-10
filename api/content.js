/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/content  (Upgraded v3)
 *
 *  ── SEARCH ───────────────────────────────────────────────────
 *  GET /api/content?module=search&q=shirt&cat=mens&min=500...
 *  GET /api/content?module=search&action=suggest&q=sh     → Autocomplete
 *  GET /api/content?module=search&action=popular           → Popular searches
 *  GET /api/content?module=search&action=trending          → Trending products [NEW]
 *  GET /api/content?module=search&action=related&id=xxx    → Related products  [NEW]
 *  GET /api/content?module=search&action=history           → User search history (JWT) [NEW]
 *  POST /api/content?module=search&action=track-click      → Track search click [NEW]
 *
 *  ── COMMENTS (Reviews) ───────────────────────────────────────
 *  GET  /api/content?module=comments&productId=xxx         → Product reviews
 *  GET  /api/content?module=comments&action=pending        → Pending (admin)
 *  GET  /api/content?module=comments&action=stats&productId=xxx → Review stats [NEW]
 *  POST /api/content?module=comments                       → Add review
 *  POST /api/content?module=comments&action=helpful        → Helpful vote
 *  POST /api/content?module=comments&action=reply          → Admin reply
 *  POST /api/content?module=comments&action=flag           → Flag review [NEW]
 *  PATCH /api/content?module=comments&action=approve       → Approve (admin)
 *  PATCH /api/content?module=comments&action=hide          → Hide (admin)
 *  PATCH /api/content?module=comments&action=bulk-approve  → Bulk approve (admin) [NEW]
 *  DELETE /api/content?module=comments&id=xxx              → Delete (admin)
 *
 *  ── ACTION ALIASES (UPGRADE-I4 — frontend compatibility) ─────
 *  POST /api/content?action=comment-add                    → Add review [NEW]
 *  GET  /api/content?action=comments&productId=xxx         → Get reviews [NEW]
 *  GET  /api/content?action=suggest&q=...                  → Autocomplete [NEW]
 *  GET  /api/content?action=popular                        → Popular [NEW]
 *
 *  ── CATEGORIES ───────────────────────────────────────────────
 *  GET    /api/content?module=categories                   → All active categories
 *  GET    /api/content?module=categories&slug=xxx          → Single category
 *  GET    /api/content?module=categories&featured=1        → Featured only
 *  POST   /api/content?module=categories                   → Create (admin)
 *  PATCH  /api/content?module=categories&id=xxx            → Update (admin)
 *  DELETE /api/content?module=categories&id=xxx            → Delete if empty (admin)
 *  POST   /api/content?module=categories&action=reorder    → Reorder (admin)
 *  POST   /api/content?module=categories&action=bulk-update → Bulk update (admin) [NEW]
 * ══════════════════════════════════════════════════════════════
 */

'use strict';

const { connectDB, Product, Comment, Order, Category, User } = require('./_db');
const {
  handleCors, isAdmin, verifyToken, sanitize,
  checkRateLimit, slugify,
} = require('./_helpers');

/* ── In-memory popular searches (cross-request accumulator) ─────────────── */
/* NOTE: Resets on serverless cold starts. DB persistence added below.       */
const popularSearches = new Map();

/* ── Spam / bad-content patterns ────────────────────────────────────────── */
const SPAM_PATTERNS = [
  /https?:\/\//i,           // URLs
  /www\./i,                 // Domain patterns
  /whatsapp|telegram/i,     // Promo channels
  /\b01[3-9]\d{8}\b/,       // BD phone numbers in reviews
  /(.)\1{6,}/,              // Repeated chars (aaaaaaaaa)
];

/* ── Minimum word count for a meaningful review ─────────────────────────── */
const REVIEW_MIN_WORDS = 3;

/* ─────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────── */

/** Detect spam in review text. Returns { isSpam, reason } */
function detectSpam(text = '') {
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) return { isSpam: true, reason: 'Spam content detected' };
  }
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < REVIEW_MIN_WORDS) {
    return { isSpam: true, reason: `Review কমপক্ষে ${REVIEW_MIN_WORDS}টি শব্দ লিখুন` };
  }
  return { isSpam: false };
}

/** Recalculate and persist product rating after a review change */
async function recalcProductRating(productId) {
  const agg = await Comment.aggregate([
    { $match: { productId, isApproved: true, isHidden: false } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  if (agg.length) {
    await Product.updateOne(
      { productId },
      { rating: Math.round(agg[0].avg * 10) / 10, reviews: agg[0].count }
    );
  }
  return agg[0] || { avg: 0, count: 0 };
}

/** Persist a popular search term to DB if SearchTerm model is available */
async function persistSearchTerm(term) {
  try {
    const key = term.toLowerCase().trim();
    popularSearches.set(key, (popularSearches.get(key) || 0) + 1);
    /* If your _db.js exposes a SearchTerm model, uncomment:
    const { SearchTerm } = require('./_db');
    await SearchTerm.findOneAndUpdate(
      { term: key },
      { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    */
  } catch { /* non-fatal */ }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  let module_ = req.query?.module || '';
  let action  = req.query?.action  || '';
  const ip    = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';

  /* ══════════════════════════════════════════════════════════
     ACTION ALIASES  (UPGRADE-I4 — frontend compatibility)
     Allows short ?action=X without requiring ?module=Y
  ══════════════════════════════════════════════════════════ */
  if (!module_ && action) {
    switch (action) {
      /* POST /api/content?action=comment-add → module=comments POST */
      case 'comment-add':
        module_ = 'comments';
        action  = '';          // route to base POST handler
        break;

      /* GET /api/content?action=comments → module=comments GET */
      case 'comments':
        module_ = 'comments';
        action  = '';
        break;

      /* GET /api/content?action=suggest */
      case 'suggest':
        module_ = 'search';
        // keep action=suggest
        break;

      /* GET /api/content?action=popular */
      case 'popular':
        module_ = 'search';
        // keep action=popular
        break;

      /* GET /api/content?action=trending */
      case 'trending':
        module_ = 'search';
        break;

      /* GET /api/content?action=related */
      case 'related':
        module_ = 'search';
        break;

      /* POST /api/content?action=flag */
      case 'flag':
        module_ = 'comments';
        break;

      /* GET /api/content?action=stats */
      case 'stats':
        module_ = 'comments';
        break;

      default:
        break;
    }
  }

  try {
    await connectDB();

    /* ══════════════════════════════════════════════════════════
       MODULE: SEARCH
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'search') {
      if (req.method !== 'GET' && !(req.method === 'POST' && action === 'track-click')) {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
      }

      /* ── Rate limit search endpoints ─────────────────── */
      if (!checkRateLimit(`search_${ip}`, 60, 60000)) {
        return res.status(429).json({ ok: false, error: 'অনেক request! একটু অপেক্ষা করুন।' });
      }

      /* ── [NEW] Track search result click ─────────────── */
      if (req.method === 'POST' && action === 'track-click') {
        const { query: clickQuery, productId: clickedId } = req.body || {};
        if (clickQuery) await persistSearchTerm(clickQuery);
        // Future: save click analytics to DB
        return res.json({ ok: true });
      }

      /* ── Autocomplete Suggestions ─────────────────────── */
      if (action === 'suggest') {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json({ ok: true, suggestions: [] });

        const [products, cats] = await Promise.all([
          Product.find({
            isActive: true,
            $or: [
              { name:  { $regex: q, $options: 'i' } },
              { tags:  { $in: [new RegExp(q, 'i')] } },
            ],
          }).limit(6).select('name cat price img productId badge').lean(),

          Category.find({
            isActive: true,
            $or: [
              { name:   { $regex: q, $options: 'i' } },
              { nameBn: { $regex: q, $options: 'i' } },
            ],
          }).limit(3).select('name nameBn slug icon').lean(),
        ]);

        return res.json({
          ok: true,
          suggestions: products.map(p => ({
            type: 'product',
            id:    p.productId,
            name:  p.name,
            cat:   p.cat,
            price: p.price,
            img:   p.img,
            badge: p.badge,
          })),
          categories: cats.map(c => ({
            type: 'category',
            slug: c.slug,
            name: c.nameBn || c.name,
            icon: c.icon,
          })),
        });
      }

      /* ── Popular Searches ─────────────────────────────── */
      if (action === 'popular') {
        const defaults = [
          'শার্ট','প্যান্ট','জুতা','কুর্তি','স্মার্টওয়াচ',
          'ইয়ারবাড','পাঞ্জাবি','ড্রেস','স্নিকার','পাওয়ার ব্যাংক',
        ];
        const sorted = [...popularSearches.entries()]
          .sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
        return res.json({ ok: true, popular: sorted.length ? sorted : defaults });
      }

      /* ── [NEW] Trending Products ──────────────────────── */
      if (action === 'trending') {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
        const limit = Math.min(parseInt(req.query.limit || '12'), 24);

        const trending = await Product.find({
          isActive: true,
          $or: [
            { isFlash: true },
            { isFeatured: true },
            { totalSold: { $gt: 0 } },
          ],
        })
          .sort({ totalSold: -1, viewers: -1, rating: -1 })
          .limit(limit)
          .select('productId name cat price orig img badge rating reviews stock isFeatured isNew isFlash totalSold viewers')
          .lean();

        return res.json({ ok: true, products: trending, total: trending.length });
      }

      /* ── [NEW] Related Products ───────────────────────── */
      if (action === 'related') {
        const { id: relId, limit: relLimit = 8 } = req.query;
        if (!relId) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

        const source = await Product.findOne({ productId: relId, isActive: true })
          .select('cat tags price').lean();

        if (!source) return res.status(404).json({ ok: false, error: 'Product পাওয়া যায়নি' });

        const lim = Math.min(parseInt(relLimit), 16);
        const minPrice = source.price * 0.5;
        const maxPrice = source.price * 2.0;

        const related = await Product.find({
          isActive: true,
          productId: { $ne: relId },
          cat: source.cat,
          price: { $gte: minPrice, $lte: maxPrice },
        })
          .sort({ rating: -1, totalSold: -1 })
          .limit(lim)
          .select('productId name cat price orig img badge rating reviews stock')
          .lean();

        /* If same-category not enough, pad with same-price-range from other cats */
        if (related.length < lim) {
          const pad = await Product.find({
            isActive: true,
            productId: { $nin: [relId, ...related.map(r => r.productId)] },
            price: { $gte: minPrice, $lte: maxPrice },
          })
            .sort({ rating: -1 })
            .limit(lim - related.length)
            .select('productId name cat price orig img badge rating reviews stock')
            .lean();
          related.push(...pad);
        }

        return res.json({ ok: true, products: related, total: related.length });
      }

      /* ── [NEW] User Search History (JWT) ─────────────── */
      if (action === 'history') {
        const decoded = verifyToken(req);
        if (!decoded) return res.status(401).json({ ok: false, error: 'Login করুন' });
        const user = await User.findById(decoded.id).select('searchHistory').lean();
        return res.json({ ok: true, history: (user?.searchHistory || []).slice(0, 20).reverse() });
      }

      /* ── Main Search + Filter ─────────────────────────── */
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
          { name:  { $regex: term, $options: 'i' } },
          { tags:  { $in: [new RegExp(term, 'i')] } },
          { desc:  { $regex: term, $options: 'i' } },
          { sku:   { $regex: term, $options: 'i' } },
          { brand: { $regex: term, $options: 'i' } },
        ];
        await persistSearchTerm(term);

        /* Save to user history if logged in */
        const decoded = verifyToken(req);
        if (decoded?.id) {
          User.findByIdAndUpdate(
            decoded.id,
            {
              $push: {
                searchHistory: {
                  $each: [{ q: term, at: new Date() }],
                  $slice: -50,
                },
              },
            }
          ).catch(() => {});
        }
      }

      if (cat)                  query.cat        = Array.isArray(cat) ? { $in: cat } : cat;
      if (min || max)           query.price      = { ...(min ? { $gte: parseFloat(min) } : {}), ...(max ? { $lte: parseFloat(max) } : {}) };
      if (rating)               query.rating     = { $gte: parseFloat(rating) };
      if (inStock === 'true')   query.stock      = { $gt: 0 };
      if (isFeatured === 'true') query.isFeatured = true;
      if (isNew === 'true')     query.isNew      = true;
      if (isFlash === 'true')   query.isFlash    = true;
      if (badge)                query.badge      = badge;

      const sortMap = {
        relevance:  hasText ? { score: { $meta: 'textScore' } } : { createdAt: -1 },
        newest:     { createdAt: -1 },
        oldest:     { createdAt:  1 },
        price_asc:  { price:  1 },
        price_desc: { price: -1 },
        rating:     { rating: -1, reviews: -1 },
        popular:    { totalSold: -1 },
        discount:   { discount:  -1 },
        trending:   { viewers: -1, totalSold: -1 },
      };

      const skip     = (Math.max(1, parseInt(page)) - 1) * Math.min(parseInt(limit) || 16, 48);
      const lim      = Math.min(parseInt(limit) || 16, 48);
      const [total, products] = await Promise.all([
        Product.countDocuments(query),
        Product.find(query)
          .sort(sortMap[sort] || { createdAt: -1 })
          .skip(skip).limit(lim)
          .select('productId name cat price orig img badge rating reviews stock isFeatured isNew isFlash colors sizes viewers totalSold brand')
          .lean(),
      ]);

      const facets = await Product.aggregate([
        { $match: { isActive: true, ...(cat ? { cat } : {}) } },
        {
          $facet: {
            categories: [{ $group: { _id: '$cat', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
            priceRange: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }],
            badges:     [{ $group: { _id: '$badge', count: { $sum: 1 } } }, { $match: { _id: { $ne: null } } }],
            brands:     [{ $group: { _id: '$brand', count: { $sum: 1 } } }, { $match: { _id: { $ne: null } } }, { $sort: { count: -1 } }, { $limit: 20 }],
          },
        },
      ]);

      return res.json({
        ok:       true,
        query:    { q, cat, min, max, rating, sort, inStock, badge },
        products,
        total,
        page:     parseInt(page),
        pages:    Math.ceil(total / lim),
        facets:   facets[0] || {},
        message:  total === 0 ? (hasText ? `"${q}" এর কোনো পণ্য পাওয়া যায়নি` : 'কোনো পণ্য পাওয়া যায়নি') : null,
      });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: COMMENTS (Reviews)
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'comments') {

      /* ── GET: Review Statistics per product [NEW] ────── */
      if (req.method === 'GET' && action === 'stats') {
        const { productId } = req.query;
        if (!productId) return res.status(400).json({ ok: false, error: 'productId দিন' });

        const [stats, verifiedCount] = await Promise.all([
          Comment.aggregate([
            { $match: { productId, isApproved: true, isHidden: false } },
            {
              $group: {
                _id: '$rating',
                count: { $sum: 1 },
              },
            },
          ]),
          Comment.countDocuments({ productId, isApproved: true, isVerifiedPurchase: true }),
        ]);

        const ratingDist   = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalRating = 0, totalCount = 0;
        stats.forEach(s => {
          ratingDist[s._id] = s.count;
          totalRating += s._id * s.count;
          totalCount  += s.count;
        });

        const avgRating = totalCount ? +(totalRating / totalCount).toFixed(1) : 0;

        return res.json({
          ok: true,
          stats: {
            avgRating,
            totalCount,
            verifiedCount,
            ratingDist,
            verifiedPercent: totalCount ? Math.round((verifiedCount / totalCount) * 100) : 0,
          },
        });
      }

      /* ── GET: Product Reviews ─────────────────────────── */
      if (req.method === 'GET' && !action) {
        const { productId, page = 1, limit = 10, sort = 'newest', rating: filterRating } = req.query;
        if (!productId) return res.status(400).json({ ok: false, error: 'productId দিন' });

        const query = { productId, isApproved: true, isHidden: false };
        if (filterRating) query.rating = parseInt(filterRating);

        const sortMap = {
          newest:   { createdAt: -1 },
          oldest:   { createdAt:  1 },
          highest:  { rating: -1 },
          lowest:   { rating:  1 },
          helpful:  { helpfulCount: -1 },
          verified: { isVerifiedPurchase: -1, createdAt: -1 },
        };

        const skip       = (Math.max(1, parseInt(page)) - 1) * Math.min(parseInt(limit), 20);
        const lim        = Math.min(parseInt(limit), 20);
        const [total, comments, ratingAgg] = await Promise.all([
          Comment.countDocuments(query),
          Comment.find(query)
            .sort(sortMap[sort] || { createdAt: -1 })
            .skip(skip).limit(lim)
            .select('-customerPhone -isHidden -helpfulVotes -flaggedBy')
            .lean(),
          Comment.aggregate([
            { $match: { productId, isApproved: true, isHidden: false } },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
          ]),
        ]);

        const ratingDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalRating = 0, totalCount = 0;
        ratingAgg.forEach(r => {
          ratingDist[r._id] = r.count;
          totalRating += r._id * r.count;
          totalCount  += r.count;
        });
        const avgRating = totalCount ? +(totalRating / totalCount).toFixed(1) : 0;

        return res.json({
          ok: true, comments, total, avgRating,
          ratingDist,
          page:  parseInt(page),
          pages: Math.ceil(total / lim),
        });
      }

      /* ── GET: Pending Reviews (admin) ────────────────── */
      if (req.method === 'GET' && action === 'pending') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [pending, total] = await Promise.all([
          Comment.find({ isApproved: false, isHidden: false })
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
          Comment.countDocuments({ isApproved: false, isHidden: false }),
        ]);
        return res.json({ ok: true, comments: pending, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
      }

      /* ── POST: Add Review (UPGRADE-I4 — primary endpoint) */
      if (req.method === 'POST' && !action) {
        /* Rate limiting: 3 reviews per 5 minutes per IP */
        if (!checkRateLimit(`review_${ip}`, 3, 300000)) {
          return res.status(429).json({ ok: false, error: '৫ মিনিটে সর্বোচ্চ ৩টি review দেওয়া যাবে' });
        }

        const b            = req.body || {};
        const productId    = sanitize(b.productId    || '', 50);
        const rating       = parseInt(b.rating)      || 0;
        const body         = sanitize(b.body         || '', 1000);
        const title        = sanitize(b.title        || '', 100);
        const customerName = sanitize(b.customerName || '', 100);
        const orderId      = sanitize(b.orderId      || '', 20);
        const size         = sanitize(b.size         || '', 30);
        const color        = sanitize(b.color        || '', 30);
        const images       = Array.isArray(b.images)
          ? b.images.slice(0, 5).map(img => sanitize(String(img), 500)).filter(Boolean)
          : [];

        /* Validation */
        if (!productId)               return res.status(400).json({ ok: false, error: 'Product ID দিন' });
        if (rating < 1 || rating > 5) return res.status(400).json({ ok: false, error: 'Rating 1-5 এর মধ্যে দিন' });
        if (!customerName)            return res.status(400).json({ ok: false, error: 'নাম দিন' });
        if (!body || body.length < 10) return res.status(400).json({ ok: false, error: 'Review কমপক্ষে ১০ অক্ষর লিখুন' });

        /* Spam detection */
        const { isSpam, reason: spamReason } = detectSpam(body);
        if (isSpam) return res.status(400).json({ ok: false, error: spamReason });

        /* Product exists? */
        const product = await Product.findOne({ productId, isActive: true }).select('_id').lean();
        if (!product) return res.status(404).json({ ok: false, error: 'Product পাওয়া যায়নি' });

        /* Verified purchase + duplicate check */
        let isVerifiedPurchase = false;
        let reviewerPhone      = '';
        let reviewerUserId     = null;

        const decoded = verifyToken(req);
        if (decoded?.id) {
          const user = await User.findById(decoded.id).select('phone _id').lean();
          if (user) {
            reviewerPhone  = user.phone;
            reviewerUserId = user._id;

            if (orderId) {
              const verifyOrder = await Order.findOne({
                orderId,
                'customer.phone':  user.phone,
                status:            { $in: ['delivered', 'confirmed', 'processing', 'shipped'] },
                'items.productId': productId,
              }).select('_id').lean();
              if (verifyOrder) isVerifiedPurchase = true;
            } else {
              /* Auto-detect verified purchase even without orderId */
              const anyOrder = await Order.findOne({
                'customer.phone':  user.phone,
                status:            { $in: ['delivered', 'shipped'] },
                'items.productId': productId,
              }).select('_id').lean();
              if (anyOrder) isVerifiedPurchase = true;
            }
          }
        }

        /* Prevent duplicate reviews from same phone */
        if (reviewerPhone) {
          const dup = await Comment.findOne({ productId, customerPhone: reviewerPhone }).select('_id').lean();
          if (dup) return res.status(409).json({ ok: false, error: 'আপনি এই পণ্যে আগেই review দিয়েছেন' });
        }

        /* Create review */
        const comment = await Comment.create({
          productId,
          orderId,
          userId:       reviewerUserId,
          customerName: sanitize(customerName, 100),
          customerPhone: reviewerPhone,
          rating,
          title:        sanitize(title, 100),
          body:         sanitize(body, 1000),
          images,
          size,
          color,
          isVerifiedPurchase,
          /* Auto-approve verified purchases; others need admin review */
          isApproved: isVerifiedPurchase,
          isHidden:   false,
          helpfulCount: 0,
          helpfulVotes: [],
          flagCount:    0,
          flaggedBy:    [],
        });

        /* Update product rating if auto-approved */
        if (comment.isApproved) {
          await recalcProductRating(productId);
        }

        return res.status(201).json({
          ok: true,
          comment: {
            ...comment.toObject(),
            customerPhone: undefined,
            flaggedBy:     undefined,
          },
          message: comment.isApproved
            ? '✅ Review publish হয়েছে!'
            : '✅ Review পাঠানো হয়েছে। Admin approve করার পর দেখা যাবে।',
        });
      }

      /* ── POST: Helpful Vote ───────────────────────────── */
      if (req.method === 'POST' && action === 'helpful') {
        const { commentId } = req.body || {};
        if (!commentId) return res.status(400).json({ ok: false, error: 'commentId দিন' });

        const comment = await Comment.findById(commentId);
        if (!comment) return res.status(404).json({ ok: false, error: 'Review পাওয়া যায়নি' });
        if (comment.isHidden) return res.status(403).json({ ok: false, error: 'Review পাওয়া যায়নি' });

        const idx = comment.helpfulVotes.indexOf(ip);
        let helpful;
        if (idx === -1) {
          comment.helpfulVotes.push(ip);
          comment.helpfulCount = (comment.helpfulCount || 0) + 1;
          helpful = true;
        } else {
          comment.helpfulVotes.splice(idx, 1);
          comment.helpfulCount = Math.max(0, (comment.helpfulCount || 1) - 1);
          helpful = false;
        }
        await comment.save();
        return res.json({ ok: true, helpful, helpfulCount: comment.helpfulCount });
      }

      /* ── POST: Flag / Report Review [NEW] ────────────── */
      if (req.method === 'POST' && action === 'flag') {
        if (!checkRateLimit(`flag_${ip}`, 10, 60000)) {
          return res.status(429).json({ ok: false, error: 'অনেক flag করা হচ্ছে' });
        }
        const { commentId, reason } = req.body || {};
        if (!commentId) return res.status(400).json({ ok: false, error: 'commentId দিন' });

        const comment = await Comment.findById(commentId);
        if (!comment || comment.isHidden) return res.status(404).json({ ok: false, error: 'Review পাওয়া যায়নি' });

        if ((comment.flaggedBy || []).includes(ip)) {
          return res.status(409).json({ ok: false, error: 'আপনি আগেই এই review রিপোর্ট করেছেন' });
        }

        comment.flaggedBy  = [...(comment.flaggedBy || []), ip];
        comment.flagCount  = (comment.flagCount || 0) + 1;
        if (comment.flagCount >= 5) {
          /* Auto-hide if 5+ flags */
          comment.isHidden   = true;
          comment.isApproved = false;
        }
        await comment.save();

        return res.json({ ok: true, message: 'Review রিপোর্ট করা হয়েছে। Admin review করবে।' });
      }

      /* ── POST: Admin Reply ────────────────────────────── */
      if (req.method === 'POST' && action === 'reply') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { commentId, text } = req.body || {};
        if (!commentId || !text?.trim()) {
          return res.status(400).json({ ok: false, error: 'commentId ও reply text দিন' });
        }
        const comment = await Comment.findByIdAndUpdate(
          commentId,
          { reply: { text: sanitize(text, 500), repliedAt: new Date() } },
          { new: true }
        );
        if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
        return res.json({ ok: true, comment, message: 'Reply দেওয়া হয়েছে' });
      }

      /* ── PATCH: Approve (admin) ───────────────────────── */
      if (req.method === 'PATCH' && action === 'approve') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { commentId } = req.body || {};
        if (!commentId) return res.status(400).json({ ok: false, error: 'commentId দিন' });

        const comment = await Comment.findByIdAndUpdate(
          commentId,
          { isApproved: true, isHidden: false },
          { new: true }
        );
        if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
        await recalcProductRating(comment.productId);
        return res.json({ ok: true, comment, message: 'Review approve হয়েছে' });
      }

      /* ── PATCH: Hide (admin) ─────────────────────────── */
      if (req.method === 'PATCH' && action === 'hide') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { commentId } = req.body || {};
        if (!commentId) return res.status(400).json({ ok: false, error: 'commentId দিন' });

        const comment = await Comment.findByIdAndUpdate(
          commentId,
          { isHidden: true, isApproved: false },
          { new: true }
        );
        if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
        await recalcProductRating(comment.productId);
        return res.json({ ok: true, comment, message: 'Review hidden হয়েছে' });
      }

      /* ── PATCH: Bulk Approve (admin) [NEW] ───────────── */
      if (req.method === 'PATCH' && action === 'bulk-approve') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { commentIds } = req.body || {};
        if (!Array.isArray(commentIds) || !commentIds.length) {
          return res.status(400).json({ ok: false, error: 'commentIds array দিন' });
        }
        if (commentIds.length > 50) {
          return res.status(400).json({ ok: false, error: 'একবারে সর্বোচ্চ ৫০টি approve করা যাবে' });
        }

        const result = await Comment.updateMany(
          { _id: { $in: commentIds } },
          { isApproved: true, isHidden: false }
        );

        /* Recalc ratings for affected products */
        const affected = await Comment.find({ _id: { $in: commentIds } })
          .distinct('productId');
        await Promise.allSettled(affected.map(pid => recalcProductRating(pid)));

        return res.json({
          ok: true,
          modified: result.modifiedCount,
          message:  `✅ ${result.modifiedCount}টি review approve হয়েছে`,
        });
      }

      /* ── DELETE: Admin ────────────────────────────────── */
      if (req.method === 'DELETE') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { id } = req.query;
        if (!id) return res.status(400).json({ ok: false, error: 'id দিন' });

        const comment = await Comment.findByIdAndDelete(id);
        if (!comment) return res.status(404).json({ ok: false, error: 'Comment পাওয়া যায়নি' });
        await recalcProductRating(comment.productId);
        return res.json({ ok: true, message: 'Review delete হয়েছে' });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: CATEGORIES
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'categories') {

      /* ── GET: Public ─────────────────────────────────── */
      if (req.method === 'GET') {
        const { slug, featured, parent, withStats } = req.query;

        /* Single category by slug */
        if (slug) {
          const cat = await Category.findOne({ slug, isActive: true }).lean();
          if (!cat) return res.status(404).json({ ok: false, error: 'Category পাওয়া যায়নি' });

          const [productCount, avgPrice, topProducts] = await Promise.all([
            Product.countDocuments({ cat: cat.slug, isActive: true }),
            Product.aggregate([
              { $match: { cat: cat.slug, isActive: true } },
              { $group: { _id: null, avg: { $avg: '$price' }, min: { $min: '$price' }, max: { $max: '$price' } } },
            ]).then(r => r[0] || {}),
            withStats === 'true'
              ? Product.find({ cat: cat.slug, isActive: true })
                  .sort({ rating: -1, totalSold: -1 })
                  .limit(4)
                  .select('productId name price img badge')
                  .lean()
              : [],
          ]);

          return res.json({
            ok: true,
            category: { ...cat, productCount, priceStats: avgPrice, topProducts },
          });
        }

        /* Category list */
        const query = { isActive: true };
        if (featured)             query.isFeatured = true;
        if (parent !== undefined) query.parentSlug  = parent || '';

        const cats     = await Category.find(query).sort({ sortOrder: 1, name: 1 }).lean();
        const enriched = await Promise.all(cats.map(async c => {
          const count = await Product.countDocuments({ cat: c.slug, isActive: true });
          return { ...c, productCount: count };
        }));

        const roots    = enriched.filter(c => !c.parentSlug);
        const children = enriched.filter(c => c.parentSlug);
        const tree     = roots.map(r => ({
          ...r,
          children: children.filter(c => c.parentSlug === r.slug),
        }));

        return res.json({ ok: true, categories: enriched, tree, total: enriched.length });
      }

      /* ── Admin-only below ─────────────────────────────── */
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

      /* ── POST: Create ─────────────────────────────────── */
      if (req.method === 'POST' && !action) {
        const b = req.body || {};
        if (!b.name?.trim()) return res.status(400).json({ ok: false, error: 'Category নাম দিন' });

        const slug = slugify(b.slug || b.name);
        const existing = await Category.findOne({ slug }).select('_id').lean();
        if (existing) return res.status(409).json({ ok: false, error: `Slug "${slug}" ইতিমধ্যে আছে` });

        const cat = await Category.create({
          slug,
          name:        sanitize(b.name,        100),
          nameBn:      sanitize(b.nameBn    || '', 100),
          icon:        sanitize(b.icon      || '', 100),
          img:         sanitize(b.img       || '', 500),
          parentSlug:  sanitize(b.parentSlug || '', 50),
          description: sanitize(b.description || '', 500),
          isActive:    b.isActive !== false,
          isFeatured:  Boolean(b.isFeatured),
          sortOrder:   parseInt(b.sortOrder) || 0,
          seoTitle:    sanitize(b.seoTitle  || '', 200),
          seoDesc:     sanitize(b.seoDesc   || '', 500),
          color:       sanitize(b.color     || '', 20),
          bannerImg:   sanitize(b.bannerImg || '', 500),
        });

        return res.status(201).json({ ok: true, category: cat, message: '✅ Category তৈরি হয়েছে!' });
      }

      /* ── PATCH: Update ───────────────────────────────── */
      if (req.method === 'PATCH' && !action) {
        const id = req.query.id;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

        const b       = req.body || {};
        const updates = {};
        [
          'name', 'nameBn', 'icon', 'img', 'parentSlug',
          'description', 'seoTitle', 'seoDesc', 'color', 'bannerImg',
        ].forEach(f => { if (b[f] !== undefined) updates[f] = sanitize(b[f], 500); });
        if (b.isActive   !== undefined) updates.isActive   = Boolean(b.isActive);
        if (b.isFeatured !== undefined) updates.isFeatured = Boolean(b.isFeatured);
        if (b.sortOrder  !== undefined) updates.sortOrder  = parseInt(b.sortOrder);

        const cat = await Category.findByIdAndUpdate(id, updates, { new: true });
        if (!cat) return res.status(404).json({ ok: false, error: 'Category পাওয়া যায়নি' });
        return res.json({ ok: true, category: cat, message: 'Category update হয়েছে' });
      }

      /* ── POST: Reorder ───────────────────────────────── */
      if (req.method === 'POST' && action === 'reorder') {
        const { order } = req.body || {};
        if (!Array.isArray(order) || !order.length) {
          return res.status(400).json({ ok: false, error: 'order array দিন' });
        }
        await Promise.all(order.map((id, i) => Category.findByIdAndUpdate(id, { sortOrder: i })));
        return res.json({ ok: true, message: 'Category order আপডেট হয়েছে' });
      }

      /* ── POST: Bulk Update [NEW] ──────────────────────── */
      if (req.method === 'POST' && action === 'bulk-update') {
        const { ids, updates: bulkUpdates } = req.body || {};
        if (!Array.isArray(ids) || !ids.length) {
          return res.status(400).json({ ok: false, error: 'ids array দিন' });
        }
        const allowedFields = ['isActive', 'isFeatured', 'sortOrder'];
        const safeUpdates   = {};
        allowedFields.forEach(f => {
          if (bulkUpdates?.[f] !== undefined) safeUpdates[f] = bulkUpdates[f];
        });
        if (!Object.keys(safeUpdates).length) {
          return res.status(400).json({ ok: false, error: 'Update fields দিন' });
        }
        const result = await Category.updateMany({ _id: { $in: ids } }, safeUpdates);
        return res.json({ ok: true, modified: result.modifiedCount, message: `${result.modifiedCount}টি category update হয়েছে` });
      }

      /* ── DELETE ───────────────────────────────────────── */
      if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

        const cat = await Category.findById(id);
        if (!cat) return res.status(404).json({ ok: false, error: 'Category পাওয়া যায়নি' });

        const [productCount, childCount] = await Promise.all([
          Product.countDocuments({ cat: cat.slug }),
          Category.countDocuments({ parentSlug: cat.slug }),
        ]);

        if (productCount > 0) {
          return res.status(400).json({
            ok:    false,
            error: `এই category তে ${productCount}টি product আছে। প্রথমে product গুলো সরান।`,
          });
        }
        if (childCount > 0) {
          return res.status(400).json({
            ok:    false,
            error: `এই category তে ${childCount}টি sub-category আছে। আগে সেগুলো সরান।`,
          });
        }

        await Category.findByIdAndDelete(id);
        return res.json({ ok: true, message: `"${cat.name}" category delete হয়েছে` });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ── Unknown module ──────────────────────────────────────── */
    return res.status(400).json({
      ok:    false,
      error: 'Invalid module. Use: search, comments, categories',
      hint:  'Action aliases: comment-add, comments, suggest, popular, trending, related, flag, stats',
    });

  } catch (err) {
    console.error('[Content API] Unhandled error:', err);
    return res.status(500).json({
      ok:    false,
      error: 'Server error. Please try again.',
      ...(process.env.NODE_ENV === 'development' ? { detail: err.message } : {}),
    });
  }
};
