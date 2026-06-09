/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/products  (Unified Public + Admin v3)
 *
 *  ── PUBLIC (No auth — সব browser, সব device) ─────────────────
 *  GET  /api/products                        → সব active products
 *  GET  /api/products?id=SL-0001             → একটি product detail
 *  GET  /api/products?cat=mens-shirts        → category filter
 *  GET  /api/products?search=shirt           → search
 *  GET  /api/products?badge=hot              → badge filter
 *  GET  /api/products?featured=true          → featured products
 *  GET  /api/products?flash=true             → flash sale products
 *  GET  /api/products?sort=newest|popular|price_asc|price_desc|rating
 *  GET  /api/products?page=1&limit=20        → pagination
 *  GET  /api/products?action=compare&ids=a,b → product comparison
 *  GET  /api/products?action=batch&ids=a,b   → batch fetch (recently viewed)
 *  GET  /api/products?action=related&id=xxx  → related products
 *  POST /api/products?action=view&id=xxx     → increment viewer count
 *
 *  ── ADMIN (x-admin-key header required) ──────────────────────
 *  POST   /api/products                      → নতুন product তৈরি
 *  PATCH  /api/products?id=xxx               → product update
 *  DELETE /api/products?id=xxx               → soft delete (isActive=false)
 *  POST   /api/products?action=toggle&id=xxx → isActive toggle
 *  POST   /api/products?action=stock         → bulk stock update
 * ══════════════════════════════════════════════════════════════
 */

const { connectDB, Product } = require('../_db');
const { handleCors, isAdmin, sanitize, sendEmail, lowStockAlertEmail } = require('../_helpers');

const LOW_STOCK_THRESHOLD = 5;

/* ── Public-safe field list (sensitive fields বাদ দেওয়া) ── */
function publicProduct(p) {
  return {
    _id:          p._id,
    productId:    p.productId,
    name:         p.name,
    cat:          p.cat,
    price:        p.price,
    orig:         p.orig,
    img:          p.img,
    images:       p.images       || [],
    badge:        p.badge,
    rating:       p.rating,
    reviews:      p.reviews      || 0,
    stock:        p.stock,
    viewers:      p.viewers      || 0,
    isFeatured:   !!p.isFeatured,
    isNew:        !!p.isNew,
    isFlash:      !!p.isFlash,
    sizes:        p.sizes        || [],
    colors:       p.colors       || [],
    tags:         p.tags         || [],
    desc:         p.desc,
    material:     p.material,
    warranty:     p.warranty,
    sku:          p.sku,
    videoUrl:     p.videoUrl,
    weight:       p.weight,
    seoTitle:     p.seoTitle,
    seoDesc:      p.seoDesc,
    returnPolicy: p.returnPolicy,
    specifications: p.specifications || [],
    totalSold:    p.totalSold    || 0,
    createdAt:    p.createdAt,
  };
}

module.exports = async (req, res) => {
  /* ── CORS: সব browser/device থেকে access করা যাবে ── */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (handleCors(req, res)) return;

  try {
    await connectDB();
    const action = req.query?.action || '';

    /* ══════════════════════════════════════════════════════════
       GET REQUESTS — সব public, কোনো auth লাগে না
    ══════════════════════════════════════════════════════════ */
    if (req.method === 'GET') {

      /* ── Single product by productId ── */
      if (req.query.id && !action) {
        const pid = sanitize(req.query.id, 50);
        const product = await Product.findOne({
          $or: [
            { productId: pid },
            { _id: pid.length === 24 ? pid : undefined },
          ],
          isActive: { $ne: false },
        }).lean();

        if (!product) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

        // Viewer count increment (fire & forget)
        Product.findOneAndUpdate({ productId: product.productId }, { $inc: { viewers: 1 } }).catch(() => {});

        return res.json({ ok: true, product: publicProduct(product) });
      }

      /* ── Compare Products ── */
      if (action === 'compare') {
        const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
        if (ids.length < 2) return res.status(400).json({ ok: false, error: 'কমপক্ষে ২টি product ID দিন' });

        const products = await Product.find({ productId: { $in: ids }, isActive: { $ne: false } })
          .select('productId name cat price orig img badge rating reviews stock sizes colors material warranty desc specifications')
          .lean();

        const allKeys = ['price', 'rating', 'stock', 'material', 'warranty', 'sizes', 'colors'];
        const comparison = allKeys.reduce((acc, key) => {
          acc[key] = products.map(p => ({
            productId: p.productId,
            value: Array.isArray(p[key]) ? p[key].join(', ') : p[key],
          }));
          return acc;
        }, {});

        return res.json({ ok: true, products: products.map(publicProduct), comparison });
      }

      /* ── Batch Fetch (Recently Viewed) ── */
      if (action === 'batch') {
        const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
        if (!ids.length) return res.json({ ok: true, products: [] });

        const products = await Product.find({ productId: { $in: ids }, isActive: { $ne: false } })
          .select('productId name cat price orig img badge rating reviews stock viewers')
          .lean();

        const ordered = ids.map(id => products.find(p => p.productId === id)).filter(Boolean);
        return res.json({ ok: true, products: ordered.map(publicProduct) });
      }

      /* ── Related Products ── */
      if (action === 'related') {
        const pid = sanitize(req.query.id || '', 50);
        if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

        const base = await Product.findOne({ productId: pid }).select('cat tags').lean();
        if (!base) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

        const related = await Product.find({
          isActive: { $ne: false },
          productId: { $ne: pid },
          $or: [
            { cat: base.cat },
            { tags: { $in: base.tags || [] } },
          ],
        }).limit(8).select('productId name price orig img badge rating reviews stock').lean();

        return res.json({ ok: true, products: related.map(publicProduct) });
      }

      /* ── Products List (main public endpoint) ── */
      const {
        cat, featured, flash, badge,
        limit   = 100,
        page    = 1,
        sort    = 'newest',
        minPrice, maxPrice, minRating, inStock,
        search,
      } = req.query;

      const query = { isActive: { $ne: false } };

      if (cat)                  query.cat        = cat;
      if (featured === 'true')  query.isFeatured = true;
      if (flash    === 'true')  query.isFlash    = true;
      if (req.query.isNew === 'true') query.isNew = true;
      if (badge)                query.badge      = badge;
      if (inStock  === 'true')  query.stock      = { $gt: 0 };
      if (minRating)            query.rating     = { $gte: parseFloat(minRating) };

      if (minPrice || maxPrice) {
        query.price = {};
        if (minPrice) query.price.$gte = parseFloat(minPrice);
        if (maxPrice) query.price.$lte = parseFloat(maxPrice);
      }

      if (search) {
        const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [
          { name:  re },
          { tags:  { $in: [re] } },
          { desc:  re },
          { sku:   re },
          { productId: re },
        ];
      }

      const sortMap = {
        newest:     { createdAt: -1 },
        oldest:     { createdAt:  1 },
        popular:    { totalSold: -1 },
        sold:       { totalSold: -1 },
        price_asc:  { price:  1 },
        price_lo:   { price:  1 },
        price_desc: { price: -1 },
        price_hi:   { price: -1 },
        rating:     { rating: -1 },
        viewers:    { viewers: -1 },
        featured:   { isFeatured: -1, createdAt: -1 },
      };

      const lim     = Math.min(parseInt(limit) || 100, 200);
      const skip    = (Math.max(parseInt(page), 1) - 1) * lim;
      const sortOpt = sortMap[sort] || { createdAt: -1 };

      const [items, total] = await Promise.all([
        Product.find(query).sort(sortOpt).skip(skip).limit(lim).lean(),
        Product.countDocuments(query),
      ]);

      const mapped = items.map(publicProduct);

      return res.status(200).json({
        ok:       true,
        products: mapped,          // ✅ index.html এর syncProductsFromAPI() এটা ব্যবহার করে
        data:     mapped,          // ✅ backward-compatibility
        count:    mapped.length,
        total,
        page:     parseInt(page),
        pages:    Math.ceil(total / lim),
        hasMore:  parseInt(page) * lim < total,
      });
    }

    /* ══════════════════════════════════════════════════════════
       POST: Increment Viewer Count (public, no auth)
    ══════════════════════════════════════════════════════════ */
    if (req.method === 'POST' && action === 'view') {
      const pid = sanitize(req.query.id || req.body?.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      await Product.findOneAndUpdate({ productId: pid }, { $inc: { viewers: 1 } });
      return res.json({ ok: true });
    }

    /* ══════════════════════════════════════════════════════════
       ADMIN ONLY — x-admin-key header লাগবে
    ══════════════════════════════════════════════════════════ */
    if (!isAdmin(req)) {
      return res.status(403).json({ ok: false, error: 'Admin access required. x-admin-key header দিন।' });
    }

    /* ── POST: Create Product ── */
    if (req.method === 'POST' && !action) {
      const b = req.body || {};

      if (!b.name || !b.cat || !b.price)
        return res.status(400).json({ ok: false, error: 'name, cat, price দিন' });

      const productId = sanitize(b.productId || '', 50) || `SL-${Date.now().toString(36).toUpperCase()}`;

      const existing = await Product.findOne({ productId });
      if (existing) return res.status(409).json({ ok: false, error: `ProductId "${productId}" আগে থেকেই আছে` });

      const product = await Product.create({
        productId,
        name:          sanitize(b.name,      200),
        cat:           sanitize(b.cat,       50),
        price:         Math.max(0, parseFloat(b.price) || 0),
        orig:          b.orig ? parseFloat(b.orig) : undefined,
        img:           sanitize(b.img || '', 500),
        images:        Array.isArray(b.images) ? b.images.slice(0, 10).map(i => sanitize(i, 500)) : [],
        badge:         ['hot','new','sale','sold','best','trending','exclusive'].includes(b.badge) ? b.badge : 'new',
        stock:         Math.max(0, parseInt(b.stock) || 100),
        rating:        parseFloat(b.rating) || 5,
        reviews:       parseInt(b.reviews)  || 0,
        viewers:       parseInt(b.viewers)  || Math.floor(Math.random() * 20 + 5),
        isFeatured:    Boolean(b.isFeatured),
        isNew:         b.isNew !== false,
        isFlash:       Boolean(b.isFlash),
        isActive:      b.isActive !== false,
        sizes:         Array.isArray(b.sizes)  ? b.sizes  : (b.sizes  ? String(b.sizes).split(',').map(s => s.trim())  : []),
        colors:        Array.isArray(b.colors) ? b.colors : (b.colors ? String(b.colors).split(',').map(s => s.trim()) : []),
        material:      sanitize(b.material      || '', 100),
        warranty:      sanitize(b.warranty      || '', 100),
        sku:           sanitize(b.sku           || '', 50),
        tags:          Array.isArray(b.tags) ? b.tags : (b.tags ? String(b.tags).split(',').map(s => s.trim()) : []),
        desc:          sanitize(b.desc          || '', 3000),
        videoUrl:      sanitize(b.videoUrl      || '', 500),
        weight:        b.weight ? parseFloat(b.weight) : undefined,
        seoTitle:      sanitize(b.seoTitle      || '', 200),
        seoDesc:       sanitize(b.seoDesc       || '', 300),
        returnPolicy:  sanitize(b.returnPolicy  || '', 200),
        specifications: Array.isArray(b.specifications) ? b.specifications.slice(0, 20) : [],
      });

      return res.status(201).json({ ok: true, product, message: '✅ Product সফলভাবে যোগ হয়েছে!' });
    }

    /* ── PATCH: Update Product ── */
    if (req.method === 'PATCH') {
      const pid = sanitize(req.query.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const b       = req.body || {};
      const updates = {};

      if (b.name      !== undefined) updates.name      = sanitize(b.name, 200);
      if (b.cat       !== undefined) updates.cat       = sanitize(b.cat, 50);
      if (b.price     !== undefined) updates.price     = Math.max(0, parseFloat(b.price) || 0);
      if (b.orig      !== undefined) updates.orig      = parseFloat(b.orig) || undefined;
      if (b.img       !== undefined) updates.img       = sanitize(b.img, 500);
      if (b.images    !== undefined) updates.images    = Array.isArray(b.images) ? b.images.slice(0, 10) : [];
      if (b.badge     !== undefined) updates.badge     = b.badge;
      if (b.stock     !== undefined) updates.stock     = Math.max(0, parseInt(b.stock) || 0);
      if (b.rating    !== undefined) updates.rating    = parseFloat(b.rating);
      if (b.reviews   !== undefined) updates.reviews   = parseInt(b.reviews);
      if (b.viewers   !== undefined) updates.viewers   = parseInt(b.viewers);
      if (b.isFeatured!== undefined) updates.isFeatured= Boolean(b.isFeatured);
      if (b.isNew     !== undefined) updates.isNew     = Boolean(b.isNew);
      if (b.isFlash   !== undefined) updates.isFlash   = Boolean(b.isFlash);
      if (b.isActive  !== undefined) updates.isActive  = Boolean(b.isActive);
      if (b.sizes     !== undefined) updates.sizes     = Array.isArray(b.sizes)  ? b.sizes  : [];
      if (b.colors    !== undefined) updates.colors    = Array.isArray(b.colors) ? b.colors : [];
      if (b.material  !== undefined) updates.material  = sanitize(b.material, 100);
      if (b.warranty  !== undefined) updates.warranty  = sanitize(b.warranty, 100);
      if (b.sku       !== undefined) updates.sku       = sanitize(b.sku, 50);
      if (b.tags      !== undefined) updates.tags      = Array.isArray(b.tags) ? b.tags : [];
      if (b.desc      !== undefined) updates.desc      = sanitize(b.desc, 3000);
      if (b.videoUrl  !== undefined) updates.videoUrl  = sanitize(b.videoUrl, 500);
      if (b.weight    !== undefined) updates.weight    = parseFloat(b.weight);
      if (b.seoTitle  !== undefined) updates.seoTitle  = sanitize(b.seoTitle, 200);
      if (b.seoDesc   !== undefined) updates.seoDesc   = sanitize(b.seoDesc, 300);
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

      return res.json({ ok: true, product, message: '✅ পণ্য আপডেট হয়েছে!' });
    }

    /* ── POST: Toggle isActive ── */
    if (req.method === 'POST' && action === 'toggle') {
      const pid = sanitize(req.query.id || req.body?.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const product = await Product.findOne({
        $or: [{ productId: pid }, { _id: pid.length === 24 ? pid : undefined }],
      });
      if (!product) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });

      product.isActive = !product.isActive;
      await product.save();
      return res.json({ ok: true, isActive: product.isActive, message: `পণ্য ${product.isActive ? 'active ✅' : 'inactive ❌'} হয়েছে` });
    }

    /* ── POST: Bulk Stock Update ── */
    if (req.method === 'POST' && action === 'stock') {
      const updates = req.body?.updates; // [{ productId, stock }]
      if (!Array.isArray(updates) || !updates.length)
        return res.status(400).json({ ok: false, error: 'updates array দিন: [{ productId, stock }]' });

      const ops = updates.slice(0, 100).map(u => ({
        updateOne: {
          filter: { productId: u.productId },
          update: { $set: { stock: Math.max(0, parseInt(u.stock) || 0) } },
        },
      }));

      const result = await Product.bulkWrite(ops);

      // Check for low stock after update
      const lowStockItems = await Product.find({
        productId: { $in: updates.map(u => u.productId) },
        stock:     { $lte: LOW_STOCK_THRESHOLD },
        isActive:  { $ne: false },
      }).select('productId name stock').lean();

      if (lowStockItems.length && process.env.ADMIN_EMAIL) {
        sendEmail(
          process.env.ADMIN_EMAIL,
          `⚠️ Low Stock Alert — ${lowStockItems.length}টি পণ্য`,
          lowStockAlertEmail(lowStockItems)
        ).catch(() => {});
      }

      return res.json({ ok: true, modified: result.modifiedCount, lowStockItems });
    }

    /* ── DELETE: Soft Delete ── */
    if (req.method === 'DELETE') {
      const pid = sanitize(req.query.id || '', 50);
      if (!pid) return res.status(400).json({ ok: false, error: 'Product ID দিন' });

      const product = await Product.findOneAndUpdate(
        { $or: [{ productId: pid }, { _id: pid.length === 24 ? pid : undefined }] },
        { isActive: false },
        { new: true }
      );
      if (!product) return res.status(404).json({ ok: false, error: 'পণ্য পাওয়া যায়নি' });
      return res.json({ ok: true, message: '✅ পণ্য delete হয়েছে!' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('Products API error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
