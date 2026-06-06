/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/search
 *  Full-Text Search + Advanced Filter System
 *
 *  GET /api/search?q=shirt&cat=mens-shirts&min=500&max=2000
 *                 &rating=4&sort=price_asc&inStock=true&page=1
 *  GET /api/search?action=suggest&q=sh   → Autocomplete
 *  GET /api/search?action=popular        → Popular searches
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, Product } = require('../_db');
const { handleCors, checkRateLimit } = require('../_helpers');

// In-memory popular searches (production-এ Redis use করুন)
const popularSearches = new Map();

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  const ip     = req.headers['x-forwarded-for']?.split(',')[0] || '';
  const action = req.query?.action || '';

  if (!checkRateLimit(`search_${ip}`, 60, 60000)) {
    return res.status(429).json({ ok: false, error: 'অনেক request! একটু অপেক্ষা করুন।' });
  }

  try {
    await connectDB();

    /* ── Autocomplete Suggestions ────────────────────────────── */
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

      const suggestions = products.map(p => ({
        id: p.productId, name: p.name, cat: p.cat,
        price: p.price, img: p.img,
      }));

      return res.json({ ok: true, suggestions });
    }

    /* ── Popular Searches ────────────────────────────────────── */
    if (action === 'popular') {
      const defaultPopular = [
        'শার্ট', 'প্যান্ট', 'জুতা', 'কুর্তি', 'স্মার্টওয়াচ',
        'ইয়ারবাড', 'পাঞ্জাবি', 'ড্রেস', 'স্নিকার', 'পাওয়ার ব্যাংক',
      ];
      const sorted = [...popularSearches.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
      return res.json({ ok: true, popular: sorted.length ? sorted : defaultPopular });
    }

    /* ── Main Search + Filter ────────────────────────────────── */
    const {
      q, cat, min, max, rating, sort = 'relevance',
      inStock, isFeatured, isNew, isFlash, badge,
      page = 1, limit = 16,
    } = req.query;

    const query = { isActive: true };
    const hasText = q && String(q).trim().length > 0;

    // Text search
    if (hasText) {
      const term = String(q).trim();
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { tags: { $in: [new RegExp(term, 'i')] } },
        { desc: { $regex: term, $options: 'i' } },
        { sku:  { $regex: term, $options: 'i' } },
      ];
      // Track popular searches
      const key = term.toLowerCase();
      popularSearches.set(key, (popularSearches.get(key) || 0) + 1);
    }

    // Category filter
    if (cat) query.cat = Array.isArray(cat) ? { $in: cat } : cat;

    // Price range
    if (min || max) {
      query.price = {};
      if (min) query.price.$gte = parseFloat(min);
      if (max) query.price.$lte = parseFloat(max);
    }

    // Rating filter
    if (rating) query.rating = { $gte: parseFloat(rating) };

    // Boolean filters
    if (inStock === 'true')     query.stock     = { $gt: 0 };
    if (isFeatured === 'true')  query.isFeatured = true;
    if (isNew === 'true')       query.isNew      = true;
    if (isFlash === 'true')     query.isFlash    = true;
    if (badge)                  query.badge      = badge;

    // Sort options
    const sortMap = {
      relevance:  hasText ? { score: { $meta: 'textScore' } } : { createdAt: -1 },
      newest:     { createdAt: -1 },
      oldest:     { createdAt: 1 },
      price_asc:  { price: 1 },
      price_desc: { price: -1 },
      rating:     { rating: -1, reviews: -1 },
      popular:    { totalSold: -1 },
      discount:   { discount: -1 },
    };
    const sortOpt = sortMap[sort] || { createdAt: -1 };

    const skip     = (parseInt(page) - 1) * parseInt(limit);
    const lim      = Math.min(parseInt(limit) || 16, 48);
    const total    = await Product.countDocuments(query);
    const products = await Product.find(query)
      .sort(sortOpt).skip(skip).limit(lim)
      .select('productId name cat price orig img badge rating reviews stock isFeatured isNew isFlash colors sizes viewers')
      .lean();

    // Aggregation for filter options (facets)
    const facets = await Product.aggregate([
      { $match: { isActive: true, ...(cat ? { cat } : {}) } },
      { $facet: {
        categories: [{ $group: { _id: '$cat', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        priceRange: [{ $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }],
        badges:     [{ $group: { _id: '$badge', count: { $sum: 1 } } }],
      }},
    ]);

    return res.json({
      ok: true,
      query: { q, cat, min, max, rating, sort, inStock },
      products,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / lim),
      facets: facets[0] || {},
      message: total === 0 ? `"${q}" এর কোনো পণ্য পাওয়া যায়নি` : null,
    });

  } catch (err) {
    console.error('Search API error:', err);
    return res.status(500).json({ ok: false, error: 'Search error' });
  }
};