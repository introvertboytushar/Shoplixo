/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/products  (Unified Public + Admin v4)
 *  Last updated: Upgraded with CSV import/export, analytics,
 *  low-stock alerts, bulk-update, duplicate, restore, category
 *  listing, search autocomplete, and env-based CORS.
 *
 *  ── PUBLIC (No auth — সব browser, সব device) ─────────────────
 *  GET  /api/products                           → সব active products
 *  GET  /api/products?id=SL-0001                → একটি product detail
 *  GET  /api/products?cat=mens-shirts           → category filter
 *  GET  /api/products?search=shirt              → search
 *  GET  /api/products?tags=cotton,summer        → tag filter (comma-sep)
 *  GET  /api/products?badge=hot                 → badge filter
 *  GET  /api/products?featured=true             → featured products
 *  GET  /api/products?flash=true                → flash sale products
 *  GET  /api/products?sort=newest|popular|price_asc|price_desc|rating|az|za
 *  GET  /api/products?page=1&limit=20           → pagination
 *  GET  /api/products?action=categories         → সব categories + count
 *  GET  /api/products?action=search-suggestions&q=sh → autocomplete
 *  GET  /api/products?action=compare&ids=a,b    → product comparison
 *  GET  /api/products?action=batch&ids=a,b      → batch fetch (recently viewed / wishlist)
 *  GET  /api/products?action=related&id=xxx     → related products (smart)
 *  POST /api/products?action=view&id=xxx        → viewer count increment
 *
 *  ── ADMIN (x-admin-key header required) ──────────────────────
 *  GET    /api/products?action=all              → সব products (inactive সহ) + pagination
 *  GET    /api/products?action=analytics        → dashboard product analytics
 *  GET    /api/products?action=low-stock        → low stock & out-of-stock items
 *  GET    /api/products?action=csv-export       → CSV / JSON export
 *  POST   /api/products                         → নতুন product তৈরি
 *  POST   /api/products?action=csv-import       → bulk import (max 200/batch)
 *  POST   /api/products?action=duplicate&id=xx  → product duplicate করুন
 *  POST   /api/products?action=restore&id=xx    → deleted product restore করুন
 *  POST   /api/products?action=bulk-update      → multiple products এ field update
 *  POST   /api/products?action=toggle&id=xxx    → isActive toggle
 *  POST   /api/products?action=stock            → bulk stock update
 *  PATCH  /api/products?id=xxx                  → product update
 *  DELETE /api/products?id=xxx                  → soft delete (isActive=false)
 * ══════════════════════════════════════════════════════════════
 */

'use strict';

const { connectDB, Product } = require('./_db');
const {
  handleCors, isAdmin, sanitize, sendEmail, lowStockAlertEmail, checkRateLimit,
} = require('./_helpers');

/* ── Constants ──────────────────────────────────────────────── */
const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD, 10) || 5;
const MAX_IMPORT_BATCH    = 200;
const VALID_BADGES        = ['hot', 'new', 'sale', 'sold', 'best', 'trending', 'exclusive'];

/* ── Security: configurable CORS origin (SEC-1 fix) ─────────── */
// Production এ .env তে ALLOWED_ORIGIN=https://shoplixo.shop set করুন
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.SITE_URL || '*';

/* ══════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
══════════════════════════════════════════════════════════════ */

/** Public-safe field list — sensitive/internal fields বাদ */
function publicProduct(p) {
  return {
    _id:            p._id,
    productId:      p.productId,
    name:           p.name,
    cat:            p.cat,
    price:          p.price,
    orig:           p.orig,
    img:            p.img,
    images:         p.images         || [],
    badge:          p.badge,
    rating:         p.rating,
    reviews:        p.reviews        || 0,
    stock:          p.stock,
    viewers:        p.viewers        || 0,
    isFeatured:     !!p.isFeatured,
    isNew:          !!p.isNew,
    isFlash:        !!p.isFlash,
    sizes:          p.sizes          || [],
    colors:         p.colors         || [],
    tags:           p.tags           || [],
    desc:           p.desc,
    material:       p.material,
    warranty:       p.warranty,
    sku:            p.sku,
    videoUrl:       p.videoUrl,
    weight:         p.weight,
    seoTitle:       p.seoTitle,
    seoDesc:        p.seoDesc,
    returnPolicy:   p.returnPolicy,
    specifications: p.specifications || [],
    totalSold:      p.totalSold      || 0,
    createdAt:      p.createdAt,
    updatedAt:      p.updatedAt,
  };
}

/** Admin view — isActive, bundleIds সহ সব fields */
function adminProduct(p) {
  return {
    ...publicProduct(p),
    isActive:  p.isActive,
    bundleIds: p.bundleIds || [],
  };
}

/**
 * Products array → CSV string (UTF-8 with BOM for Excel)
 * Multi-value fields (sizes, colors, tags) pipe-separated
 */
function productsToCSV(products) {
  const headers = [
    'productId', 'name', 'cat', 'price', 'orig', 'stock', 'badge',
    'rating', 'reviews', 'viewers', 'totalSold', 'isFeatured', 'isNew',
    'isFlash', 'isActive', 'sku', 'material', 'warranty', 'weight',
    'sizes', 'colors', 'tags', 'seoTitle', 'seoDesc', 'returnPolicy', 'img',
  ];

  const esc = (v) => {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join('|') : String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [headers.join(',')];
  products.forEach(p => rows.push(headers.map(h => esc(p[h])).join(',')));
  return '\uFEFF' + rows.join('\n'); // BOM prefix for Excel UTF-8 compatibility
}

/** Unique product ID generator with collision avoidance */
async function generateUniqueProductId() {
  const base     = `SL-${Date.now().toString(36).toUpperCase()}`;
  const existing = await Product.exists({ productId: base });
  return existing ? `${base}-${Math.floor(Math.random() * 900 + 100)}` : base;
}

/** Parse a single CSV row respecting double-quoted fields */
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur.trim()); cur = '';
    } else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

/** Parse pipe-separated or comma-separated array field from import */
function parseArrayField(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v).split(/[|,]/).map(s => s.trim()).filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════
   MAIN HANDLER
══════════════════════════════════════════════════════════════ */
module.exports = async (req, res) => {

  /* ── CORS & Cache headers ── */
  res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, Authorization, Cache-Control, Pragma');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma',   'no-cache');
  res.setHeader('Expires',  '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Vary',     'Accept-Encoding');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (handleCors(req, res)) return;

  try {
    await connectDB();
    const action = req.query?.action || '';

    /* ════════════════════════════════════════════════════════
       ── GET REQUESTS ──
    ════════════════════════════════════════════════════════ */
    if (req.method === 'GET') {

      /* ─── Public: All Categories with product count ─── */
      if (action === 'categories') {
        const cats = await Product.aggregate([
          { $match: { isActive: { $ne: false } } },
          {
            $group: {
              _id:      '$cat',
              count:    { $sum: 1 },
              avgPrice: { $avg: '$price' },
              minPrice: { $min: '$price' },
              img:      { $first: '$img' },
            },
          },
          { $sort: { count: -1 } },
        ]);

        return res.json({
          ok:         true,
          categories: cats.map(c => ({
            slug:     c._id,
            count:    c.count,
            avgPrice: Math.round(c.avgPrice || 0),
            minPrice: c.minPrice || 0,
            img:      c.img || '',
          })),
          total: cats.length,
        });
      }

      /* ─── Public: Search Autocomplete / Suggestions ─── */
      if (action === 'search-suggestions') {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
        if (checkRateLimit && !checkRateLimit(`suggest_${ip}`, 30, 10000)) {
          return res.status(429).json({ ok: false, error: 'Too many requests' });
        }

        const q = sanitize(req.query.q || '', 100).trim();
        if (!q || q.length < 2) return res.json({ ok: true, suggestions: [], categories: [] });

        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

        const [items, catMatches] = await Promise.all([
          Product.find({ isActive: { $ne: false }, $or: [{ name: re }, { tags: { $in: [re] } }, { cat: re }] })
            .limit(8)
            .select('productId name cat price img badge')
            .lean(),
          Product.distinct('cat', { isActive: { $ne: false }, cat: re }),
        ]);

        return res.json({
          ok: true,
          suggestions: items.map(p => ({
            type:      'product',
            productId: p.productId,
            name:      p.name,
            cat:       p.cat,
            price:     p.price,
            img:       p.img,
            badge:     p.badge,
          })),
          categories: catMatches.slice(0, 4),
        });
      }

      /* ─── Single product by productId ─── */
      if (req.query.id && !action) {
        const pid     = sanitize(req.query.id, 50);
        const product = await Product.findOne({
          $or: [
            { productId: pid },
            { _id: pid.length === 24 ? pid : undefined },
          ],
          isActive: { $ne: false },
        }).lean();

        if (!product) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

        // Increment viewer count — fire & forget
        Product.findOneAndUpdate(
          { productId: product.productId },
          { $inc: { viewers: 1 } }
        ).catch(() => {});

        return res.json({ ok: true, product: publicProduct(product) });
      }

      /* ─── Compare Products ─── */
      if (action === 'compare') {
        const ids = String(req.query.ids || '')
          .split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
        if (ids.length < 2)
          return res.status(400).json({ ok: false, error: 'কমপক্ষে ২টি product ID দিন' });

        const products = await Product.find({
          productId: { $in: ids },
          isActive:  { $ne: false },
        })
          .select('productId name cat price orig img badge rating reviews stock sizes colors material warranty desc specifications returnPolicy weight sku')
          .lean();

        const compareKeys = ['price', 'rating', 'stock', 'material', 'warranty', 'sizes', 'colors', 'weight', 'returnPolicy'];
        const comparison  = compareKeys.reduce((acc, key) => {
          acc[key] = products.map(p => ({
            productId: p.productId,
            value:     Array.isArray(p[key]) ? p[key].join(', ') : (p[key] ?? '—'),
          }));
          return acc;
        }, {});

        return res.json({ ok: true, products: products.map(publicProduct), comparison });
      }

      /* ─── Batch Fetch (Recently Viewed / Wishlist) ─── */
      if (action === 'batch') {
        const ids = String(req.query.ids || '')
          .split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
        if (!ids.length) return res.json({ ok: true, products: [] });

        const products = await Product.find({
          productId: { $in: ids },
          isActive:  { $ne: false },
        })
          .select('productId name cat price orig img badge rating reviews stock viewers totalSold')
          .lean();

        // Preserve caller's ordering (e.g. recently-viewed order)
        const ordered = ids
          .map(id => products.find(p => p.productId === id))
          .filter(Boolean);

        return res.json({ ok: true, products: ordered.map(publicProduct) });
      }

      /* ─── Related Products (smart: cat + tags, price-range fallback) ─── */
      if (action === 'related') {
        const pid = sanitize(req.query.id || '', 50);
        if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

        const base = await Product.findOne({ productId: pid })
          .select('cat tags price').lean();
        if (!base) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

        let related = await Product.find({
          isActive:  { $ne: false },
          productId: { $ne: pid },
          $or: [
            { cat:  base.cat },
            { tags: { $in: base.tags || [] } },
          ],
        })
          .sort({ totalSold: -1, rating: -1 })
          .limit(12)
          .select('productId name price orig img badge rating reviews stock totalSold viewers')
          .lean();

        // Pad with popular products in a similar price range if needed
        if (related.length < 4 && base.price) {
          const priceMin = base.price * 0.5;
          const priceMax = base.price * 1.5;
          const existing = new Set([pid, ...related.map(r => r.productId)]);
          const extra    = await Product.find({
            isActive:  { $ne: false },
            productId: { $nin: [...existing] },
            price:     { $gte: priceMin, $lte: priceMax },
          })
            .sort({ totalSold: -1 })
            .limit(8 - related.length)
            .select('productId name price orig img badge rating reviews stock')
            .lean();
          related = [...related, ...extra];
        }

        return res.json({ ok: true, products: related.slice(0, 12).map(publicProduct) });
      }

      /* ─── ADMIN: Analytics Dashboard ─── */
      if (action === 'analytics') {
        if (!isAdmin(req))
          return res.status(403).json({ ok: false, error: 'Admin access required' });

        const [
          totalProducts, totalActive, totalInactive,
          outOfStock, lowStockCount,
          totalViewsAgg, topSelling, topViewed,
          byCategory, recentlyAdded,
        ] = await Promise.all([
          Product.countDocuments({}),
          Product.countDocuments({ isActive: { $ne: false } }),
          Product.countDocuments({ isActive: false }),
          Product.countDocuments({ isActive: { $ne: false }, stock: 0 }),
          Product.countDocuments({ isActive: { $ne: false }, stock: { $gt: 0, $lte: LOW_STOCK_THRESHOLD } }),
          Product.aggregate([{ $group: { _id: null, total: { $sum: '$viewers' } } }]),
          Product.find({ isActive: { $ne: false } })
            .sort({ totalSold: -1 }).limit(5)
            .select('productId name price totalSold stock img cat').lean(),
          Product.find({ isActive: { $ne: false } })
            .sort({ viewers: -1 }).limit(5)
            .select('productId name price viewers stock img').lean(),
          Product.aggregate([
            { $match: { isActive: { $ne: false } } },
            {
              $group: {
                _id:     '$cat',
                count:   { $sum: 1 },
                revenue: { $sum: { $multiply: ['$price', { $ifNull: ['$totalSold', 0] }] } },
                avgRating: { $avg: '$rating' },
              },
            },
            { $sort: { count: -1 } },
          ]),
          Product.find({}).sort({ createdAt: -1 }).limit(5)
            .select('productId name price createdAt isActive cat').lean(),
        ]);

        return res.json({
          ok:    true,
          stats: {
            totalProducts, totalActive, totalInactive,
            outOfStock,    lowStock: lowStockCount,
            totalViews: totalViewsAgg[0]?.total || 0,
          },
          topSelling,
          topViewed,
          byCategory,
          recentlyAdded,
        });
      }

      /* ─── ADMIN: Low Stock & Out-of-Stock Items ─── */
      if (action === 'low-stock') {
        if (!isAdmin(req))
          return res.status(403).json({ ok: false, error: 'Admin access required' });

        const threshold = Math.max(1, parseInt(req.query.threshold, 10) || LOW_STOCK_THRESHOLD);

        const [outOfStock, lowStock] = await Promise.all([
          Product.find({ isActive: { $ne: false }, stock: 0 })
            .sort({ totalSold: -1 })
            .select('productId name cat price stock img totalSold badge').lean(),
          Product.find({ isActive: { $ne: false }, stock: { $gt: 0, $lte: threshold } })
            .sort({ stock: 1 })
            .select('productId name cat price stock img totalSold badge').lean(),
        ]);

        return res.json({
          ok:          true,
          outOfStock:  outOfStock.map(adminProduct),
          lowStock:    lowStock.map(adminProduct),
          threshold,
          totalAlerts: outOfStock.length + lowStock.length,
        });
      }

      /* ─── ADMIN: CSV / JSON Export (UPGRADE-A2) ─── */
      if (action === 'csv-export') {
        if (!isAdmin(req))
          return res.status(403).json({ ok: false, error: 'Admin access required' });

        const format    = (req.query.format || 'json').toLowerCase(); // json | csv
        const catFilter = req.query.cat;
        const query     = {};
        if (catFilter) query.cat = catFilter;

        const products = await Product.find(query).sort({ createdAt: -1 }).lean();

        if (format === 'csv') {
          const csv = productsToCSV(products);
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="shoplixo_products_${Date.now()}.csv"`);
          return res.send(csv);
        }

        return res.json({
          ok:         true,
          products:   products.map(adminProduct),
          count:      products.length,
          exportedAt: new Date().toISOString(),
        });
      }

      /* ─── ADMIN: All Products (inactive সহ) + search/filter/pagination ─── */
      if (action === 'all') {
        if (!isAdmin(req))
          return res.status(403).json({ ok: false, error: 'Admin access required' });

        const { page = 1, limit = 50, cat, badge, search } = req.query;
        const { isActive: isActiveFilter } = req.query;

        const query = {};
        if (cat)   query.cat   = cat;
        if (badge) query.badge = badge;
        if (isActiveFilter !== undefined && isActiveFilter !== '')
          query.isActive = isActiveFilter === 'true';
        if (search) {
          const re  = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          query.$or = [
            { name:      re },
            { productId: re },
            { sku:       re },
            { tags:      { $in: [re] } },
            { cat:       re },
          ];
        }

        const lim  = Math.min(parseInt(limit, 10) || 50, 200);
        const skip = (Math.max(parseInt(page, 10), 1) - 1) * lim;

        const [items, total] = await Promise.all([
          Product.find(query).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
          Product.countDocuments(query),
        ]);

        return res.json({
          ok:       true,
          products: items.map(adminProduct),
          total,
          page:     parseInt(page, 10),
          pages:    Math.ceil(total / lim),
          hasMore:  parseInt(page, 10) * lim < total,
        });
      }

      /* ─── Public: Products List (main endpoint) ─── */
      const {
        cat, featured, flash, badge,
        limit    = 100,
        page     = 1,
        sort     = 'newest',
        minPrice, maxPrice, minRating, inStock,
        search, tags,
      } = req.query;

      const query = { isActive: { $ne: false } };

      if (cat)                         query.cat        = cat;
      if (featured  === 'true')        query.isFeatured = true;
      if (flash     === 'true')        query.isFlash    = true;
      if (req.query.isNew === 'true')  query.isNew      = true;
      if (badge)                       query.badge      = badge;
      if (inStock   === 'true')        query.stock      = { $gt: 0 };
      if (minRating)                   query.rating     = { $gte: parseFloat(minRating) };

      if (tags) {
        const tagList = String(tags).split(',').map(t => t.trim()).filter(Boolean);
        if (tagList.length) query.tags = { $in: tagList };
      }

      if (minPrice || maxPrice) {
        query.price = {};
        if (minPrice) query.price.$gte = parseFloat(minPrice);
        if (maxPrice) query.price.$lte = parseFloat(maxPrice);
      }

      if (search) {
        const re   = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or  = [
          { name:      re },
          { tags:      { $in: [re] } },
          { desc:      re },
          { sku:       re },
          { productId: re },
          { cat:       re },
        ];
      }

      const sortMap = {
        newest:     { createdAt: -1 },
        oldest:     { createdAt:  1 },
        popular:    { totalSold:  -1 },
        sold:       { totalSold:  -1 },
        price_asc:  { price:  1 },
        price_lo:   { price:  1 },
        price_desc: { price: -1 },
        price_hi:   { price: -1 },
        rating:     { rating: -1 },
        viewers:    { viewers: -1 },
        featured:   { isFeatured: -1, createdAt: -1 },
        az:         { name:  1 },
        za:         { name: -1 },
      };

      const lim     = Math.min(parseInt(limit, 10) || 100, 200);
      const skip    = (Math.max(parseInt(page, 10), 1) - 1) * lim;
      const sortOpt = sortMap[sort] || { createdAt: -1 };

      const [items, total] = await Promise.all([
        Product.find(query).sort(sortOpt).skip(skip).limit(lim).lean(),
        Product.countDocuments(query),
      ]);

      const mapped = items.map(publicProduct);
      return res.status(200).json({
        ok:       true,
        products: mapped,
        data:     mapped,          // ✅ backward-compat for index.html syncProductsFromAPI()
        count:    mapped.length,
        total,
        page:     parseInt(page, 10),
        pages:    Math.ceil(total / lim),
        hasMore:  parseInt(page, 10) * lim < total,
      });
    }

    /* ════════════════════════════════════════════════════════
       POST: Increment Viewer Count  (public — no auth)
    ════════════════════════════════════════════════════════ */
    if (req.method === 'POST' && action === 'view') {
      const pid = sanitize(req.query.id || req.body?.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      await Product.findOneAndUpdate({ productId: pid }, { $inc: { viewers: 1 } });
      return res.json({ ok: true });
    }

    /* ════════════════════════════════════════════════════════
       ADMIN ONLY — x-admin-key header required
    ════════════════════════════════════════════════════════ */
    if (!isAdmin(req)) {
      return res.status(403).json({
        ok:    false,
        error: 'Admin access required. x-admin-key header দিন।',
      });
    }

    /* ─── POST: CSV / JSON Bulk Import (UPGRADE-A2) ─── */
    if (req.method === 'POST' && action === 'csv-import') {
      const rows = req.body?.products;
      if (!Array.isArray(rows) || !rows.length)
        return res.status(400).json({ ok: false, error: 'products array দিন [{ name, cat, price, ... }]' });
      if (rows.length > MAX_IMPORT_BATCH)
        return res.status(400).json({
          ok:    false,
          error: `এক বারে সর্বোচ্চ ${MAX_IMPORT_BATCH}টি import করা যাবে`,
        });

      const results = { created: 0, updated: 0, skipped: 0, errors: [] };

      for (const row of rows) {
        try {
          const pid = sanitize(String(row.productId || ''), 50);

          if (!row.name || !row.cat || !row.price) {
            results.errors.push({ row: pid || '?', error: 'name, cat, price required' });
            results.skipped++;
            continue;
          }

          const data = {
            name:       sanitize(String(row.name),  200),
            cat:        sanitize(String(row.cat),   50),
            price:      Math.max(0, parseFloat(row.price)  || 0),
            orig:       row.orig ? parseFloat(row.orig)    : undefined,
            img:        sanitize(String(row.img    || ''), 500),
            badge:      VALID_BADGES.includes(row.badge) ? row.badge : 'new',
            stock:      Math.max(0, parseInt(row.stock,   10) || 100),
            rating:     Math.min(5, Math.max(0, parseFloat(row.rating)  || 5)),
            reviews:    Math.max(0, parseInt(row.reviews, 10) || 0),
            isFeatured: row.isFeatured === true  || row.isFeatured === 'true',
            isNew:      row.isNew      !== false && row.isNew      !== 'false',
            isFlash:    row.isFlash    === true  || row.isFlash    === 'true',
            isActive:   row.isActive   !== false && row.isActive   !== 'false',
            sku:        sanitize(String(row.sku       || ''), 50),
            material:   sanitize(String(row.material  || ''), 100),
            warranty:   sanitize(String(row.warranty  || ''), 100),
            sizes:      parseArrayField(row.sizes),
            colors:     parseArrayField(row.colors),
            tags:       parseArrayField(row.tags),
            seoTitle:   sanitize(String(row.seoTitle  || ''), 200),
            seoDesc:    sanitize(String(row.seoDesc   || ''), 300),
            returnPolicy: sanitize(String(row.returnPolicy || ''), 200),
          };

          if (pid) {
            const existing = await Product.findOneAndUpdate({ productId: pid }, data, { new: true });
            if (existing) { results.updated++; }
            else {
              await Product.create({ ...data, productId: pid });
              results.created++;
            }
          } else {
            const newPid = await generateUniqueProductId();
            await Product.create({ ...data, productId: newPid });
            results.created++;
          }
        } catch (e) {
          results.errors.push({ row: row.productId || '?', error: e.message });
          results.skipped++;
        }
      }

      return res.json({
        ok: true,
        ...results,
        message: `✅ Import সম্পন্ন: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`,
      });
    }

    /* ─── POST: Duplicate Product ─── */
    if (req.method === 'POST' && action === 'duplicate') {
      const pid = sanitize(req.query.id || req.body?.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const original = await Product.findOne({
        $or: [{ productId: pid }, { _id: pid.length === 24 ? pid : undefined }],
      }).lean();
      if (!original) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

      const newPid = await generateUniqueProductId();
      const { _id, productId, createdAt, updatedAt, totalSold, viewers, reviews, ...rest } = original;

      const duplicate = await Product.create({
        ...rest,
        productId: newPid,
        name:      `${original.name} (Copy)`,
        isActive:  false,    // inactive — admin কে publish করতে হবে
        totalSold: 0,
        viewers:   Math.floor(Math.random() * 10 + 1),
        reviews:   0,
        sku:       '',       // SKU clear — দুটো product same SKU রাখা উচিত নয়
      });

      return res.status(201).json({
        ok:      true,
        product: adminProduct(duplicate.toObject()),
        message: '✅ Product duplicate হয়েছে। Inactive অবস্থায় তৈরি — publish করার আগে review করুন।',
      });
    }

    /* ─── POST: Restore Soft-Deleted Product ─── */
    if (req.method === 'POST' && action === 'restore') {
      const pid = sanitize(req.query.id || req.body?.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const product = await Product.findOneAndUpdate(
        { $or: [{ productId: pid }, { _id: pid.length === 24 ? pid : undefined }] },
        { $set: { isActive: true } },
        { new: true }
      );
      if (!product) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

      return res.json({
        ok:      true,
        product: adminProduct(product.toObject()),
        message: '✅ পণ্য restore হয়েছে!',
      });
    }

    /* ─── POST: Bulk Field Update (multiple products) ─── */
    if (req.method === 'POST' && action === 'bulk-update') {
      const { productIds, updates: updateData } = req.body || {};

      if (!Array.isArray(productIds) || !productIds.length)
        return res.status(400).json({ ok: false, error: 'productIds array দিন' });
      if (!updateData || typeof updateData !== 'object' || Array.isArray(updateData))
        return res.status(400).json({ ok: false, error: 'updates object দিন' });

      // Only whitelisted fields allowed for bulk update
      const BULK_ALLOWED = ['isActive', 'badge', 'isFeatured', 'isNew', 'isFlash', 'cat'];
      const safeData     = {};
      BULK_ALLOWED.forEach(k => { if (updateData[k] !== undefined) safeData[k] = updateData[k]; });

      if (!Object.keys(safeData).length)
        return res.status(400).json({
          ok:    false,
          error: `Allowed bulk-update fields: ${BULK_ALLOWED.join(', ')}`,
        });

      const result = await Product.updateMany(
        { productId: { $in: productIds.slice(0, 200) } },
        { $set: safeData }
      );

      return res.json({
        ok:       true,
        modified: result.modifiedCount,
        message:  `✅ ${result.modifiedCount}টি পণ্য আপডেট হয়েছে!`,
      });
    }

    /* ─── POST: Create Product ─── */
    if (req.method === 'POST' && !action) {
      const b = req.body || {};
      if (!b.name || !b.cat || !b.price)
        return res.status(400).json({ ok: false, error: 'name, cat, price দিন' });

      const productId = sanitize(b.productId || '', 50) || await generateUniqueProductId();
      if (await Product.exists({ productId }))
        return res.status(409).json({ ok: false, error: `ProductId "${productId}" আগে থেকেই আছে` });

      const product = await Product.create({
        productId,
        name:           sanitize(b.name,       200),
        cat:            sanitize(b.cat,        50),
        price:          Math.max(0, parseFloat(b.price) || 0),
        orig:           b.orig ? parseFloat(b.orig) : undefined,
        img:            sanitize(b.img        || '', 500),
        images:         Array.isArray(b.images) ? b.images.slice(0, 10).map(i => sanitize(i, 500)) : [],
        badge:          VALID_BADGES.includes(b.badge) ? b.badge : 'new',
        stock:          Math.max(0, parseInt(b.stock, 10) || 100),
        rating:         Math.min(5, Math.max(0, parseFloat(b.rating)  || 5)),
        reviews:        Math.max(0, parseInt(b.reviews, 10) || 0),
        viewers:        parseInt(b.viewers, 10) || Math.floor(Math.random() * 20 + 5),
        isFeatured:     Boolean(b.isFeatured),
        isNew:          b.isNew !== false,
        isFlash:        Boolean(b.isFlash),
        isActive:       b.isActive !== false,
        sizes:          Array.isArray(b.sizes)  ? b.sizes  : (b.sizes  ? String(b.sizes).split(',').map(s => s.trim())  : []),
        colors:         Array.isArray(b.colors) ? b.colors : (b.colors ? String(b.colors).split(',').map(s => s.trim()) : []),
        material:       sanitize(b.material       || '', 100),
        warranty:       sanitize(b.warranty       || '', 100),
        sku:            sanitize(b.sku            || '', 50),
        tags:           Array.isArray(b.tags) ? b.tags : (b.tags ? String(b.tags).split(',').map(s => s.trim()) : []),
        desc:           sanitize(b.desc           || '', 3000),
        videoUrl:       sanitize(b.videoUrl       || '', 500),
        weight:         b.weight ? parseFloat(b.weight) : undefined,
        seoTitle:       sanitize(b.seoTitle       || '', 200),
        seoDesc:        sanitize(b.seoDesc        || '', 300),
        returnPolicy:   sanitize(b.returnPolicy   || '', 200),
        specifications: Array.isArray(b.specifications) ? b.specifications.slice(0, 20) : [],
      });

      // Cache-clear hint
      res.setHeader('X-Cache-Clear', 'products');

      return res.status(201).json({
        ok:      true,
        product: adminProduct(product.toObject()),
        message: '✅ Product সফলভাবে যোগ হয়েছে!',
      });
    }

    /* ─── PATCH: Update Product ─── */
    if (req.method === 'PATCH') {
      const pid = sanitize(req.query.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const b       = req.body || {};
      const updates = {};

      if (b.name        !== undefined) updates.name        = sanitize(b.name, 200);
      if (b.cat         !== undefined) updates.cat         = sanitize(b.cat, 50);
      if (b.price       !== undefined) updates.price       = Math.max(0, parseFloat(b.price) || 0);
      if (b.orig        !== undefined) updates.orig        = parseFloat(b.orig) || undefined;
      if (b.img         !== undefined) updates.img         = sanitize(b.img, 500);
      if (b.images      !== undefined) updates.images      = Array.isArray(b.images) ? b.images.slice(0, 10).map(i => sanitize(i, 500)) : [];
      if (b.badge       !== undefined) updates.badge       = b.badge;
      if (b.stock       !== undefined) updates.stock       = Math.max(0, parseInt(b.stock, 10) || 0);
      if (b.rating      !== undefined) updates.rating      = Math.min(5, Math.max(0, parseFloat(b.rating)));
      if (b.reviews     !== undefined) updates.reviews     = Math.max(0, parseInt(b.reviews, 10));
      if (b.viewers     !== undefined) updates.viewers     = parseInt(b.viewers, 10);
      if (b.isFeatured  !== undefined) updates.isFeatured  = Boolean(b.isFeatured);
      if (b.isNew       !== undefined) updates.isNew       = Boolean(b.isNew);
      if (b.isFlash     !== undefined) updates.isFlash     = Boolean(b.isFlash);
      if (b.isActive    !== undefined) updates.isActive    = Boolean(b.isActive);
      if (b.sizes       !== undefined) updates.sizes       = Array.isArray(b.sizes)  ? b.sizes  : [];
      if (b.colors      !== undefined) updates.colors      = Array.isArray(b.colors) ? b.colors : [];
      if (b.material    !== undefined) updates.material    = sanitize(b.material, 100);
      if (b.warranty    !== undefined) updates.warranty    = sanitize(b.warranty, 100);
      if (b.sku         !== undefined) updates.sku         = sanitize(b.sku, 50);
      if (b.tags        !== undefined) updates.tags        = Array.isArray(b.tags) ? b.tags : [];
      if (b.desc        !== undefined) updates.desc        = sanitize(b.desc, 3000);
      if (b.videoUrl    !== undefined) updates.videoUrl    = sanitize(b.videoUrl, 500);
      if (b.weight      !== undefined) updates.weight      = parseFloat(b.weight);
      if (b.seoTitle    !== undefined) updates.seoTitle    = sanitize(b.seoTitle, 200);
      if (b.seoDesc     !== undefined) updates.seoDesc     = sanitize(b.seoDesc, 300);
      if (b.returnPolicy   !== undefined) updates.returnPolicy   = sanitize(b.returnPolicy, 200);
      if (b.specifications !== undefined) updates.specifications = Array.isArray(b.specifications) ? b.specifications.slice(0, 20) : [];

      const product = await Product.findOneAndUpdate(
        { $or: [{ productId: pid }, { _id: pid.length === 24 ? pid : undefined }] },
        updates,
        { new: true }
      );
      if (!product) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

      // Low stock email alert
      if (updates.stock !== undefined && updates.stock <= LOW_STOCK_THRESHOLD && process.env.ADMIN_EMAIL) {
        sendEmail(
          process.env.ADMIN_EMAIL,
          `⚠️ Low Stock Alert — ${product.name}`,
          lowStockAlertEmail([product])
        ).catch(() => {});
      }

      res.setHeader('X-Cache-Clear', 'products');
      return res.json({
        ok:      true,
        product: adminProduct(product.toObject()),
        message: '✅ পণ্য আপডেট হয়েছে!',
      });
    }

    /* ─── POST: Toggle isActive ─── */
    if (req.method === 'POST' && action === 'toggle') {
      const pid = sanitize(req.query.id || req.body?.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const product = await Product.findOne({
        $or: [{ productId: pid }, { _id: pid.length === 24 ? pid : undefined }],
      });
      if (!product) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

      product.isActive = !product.isActive;
      await product.save();

      return res.json({
        ok:       true,
        isActive: product.isActive,
        message:  `পণ্য ${product.isActive ? 'active ✅' : 'inactive ❌'} হয়েছে`,
      });
    }

    /* ─── POST: Bulk Stock Update ─── */
    if (req.method === 'POST' && action === 'stock') {
      const updates = req.body?.updates; // [{ productId, stock }]
      if (!Array.isArray(updates) || !updates.length)
        return res.status(400).json({ ok: false, error: 'updates array দিন: [{ productId, stock }]' });

      const ops = updates.slice(0, 100).map(u => ({
        updateOne: {
          filter: { productId: u.productId },
          update: { $set: { stock: Math.max(0, parseInt(u.stock, 10) || 0) } },
        },
      }));

      const result = await Product.bulkWrite(ops);

      const lowStockItems = await Product.find({
        productId: { $in: updates.map(u => u.productId) },
        stock:     { $lte: LOW_STOCK_THRESHOLD },
        isActive:  { $ne: false },
      }).select('productId name stock img').lean();

      if (lowStockItems.length && process.env.ADMIN_EMAIL) {
        sendEmail(
          process.env.ADMIN_EMAIL,
          `⚠️ Low Stock Alert — ${lowStockItems.length}টি পণ্য`,
          lowStockAlertEmail(lowStockItems)
        ).catch(() => {});
      }

      return res.json({ ok: true, modified: result.modifiedCount, lowStockItems });
    }

    /* ─── DELETE: Soft Delete ─── */
    if (req.method === 'DELETE') {
      const pid = sanitize(req.query.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const product = await Product.findOneAndUpdate(
        { $or: [{ productId: pid }, { _id: pid.length === 24 ? pid : undefined }] },
        { $set: { isActive: false } },
        { new: true }
      );
      if (!product) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

      // Signal frontend to clear product cache
      res.setHeader('X-Cache-Clear', 'products');
      return res.json({ ok: true, message: '✅ পণ্য delete হয়েছে!' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('[Products API] Error:', err.message, '\n', err.stack?.split('\n').slice(0, 3).join('\n'));
    return res.status(500).json({ ok: false, error: 'Server error: ' + err.message });
  }
};
