/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/bundle
 *  Bundle Offers — একসাথে কিনলে বেশি ছাড়!
 *
 *  GET  /api/bundle              → সব active bundles
 *  GET  /api/bundle?id=xxx       → single bundle
 *  GET  /api/bundle?productId=xx → এই product এর bundles
 *  POST /api/bundle (admin)      → নতুন bundle তৈরি
 *  PATCH /api/bundle?id=xx (admin) → update
 *  DELETE /api/bundle?id=xx (admin) → delete
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, Bundle, Product } = require('../_db');
const { handleCors, isAdmin, sanitize } = require('../_helpers');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  try {
    await connectDB();

    /* ── GET: Bundles ─────────────────────────────────────────── */
    if (req.method === 'GET') {
      const { id, productId } = req.query;

      // Single bundle
      if (id) {
        const bundle = await Bundle.findById(id);
        if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });

        // Get product details
        const products = await Product.find({ productId: { $in: bundle.productIds }, isActive: true })
          .select('productId name price orig img rating reviews stock badge').lean();

        const subtotal  = products.reduce((s, p) => s + p.price, 0);
        const discount  = bundle.discountType === 'percent'
          ? Math.round(subtotal * bundle.discountValue / 100)
          : bundle.discountValue;
        const bundlePrice = Math.max(0, subtotal - discount);

        return res.json({ ok: true, bundle: { ...bundle.toObject(), products, subtotal, discount, bundlePrice } });
      }

      // Bundles by product
      const query = { isActive: true };
      if (productId) query.productIds = productId;

      // Check date validity
      const now = new Date();
      query.$or = [
        { startAt: { $exists: false } },
        { startAt: { $lte: now } },
      ];

      const bundles = await Bundle.find(query).sort({ createdAt: -1 }).limit(20).lean();

      // Enrich with product data
      const enriched = await Promise.all(bundles.map(async (b) => {
        const prods = await Product.find({ productId: { $in: b.productIds }, isActive: true })
          .select('productId name price img stock').lean();
        const subtotal  = prods.reduce((s, p) => s + p.price, 0);
        const discount  = b.discountType === 'percent'
          ? Math.round(subtotal * b.discountValue / 100)
          : b.discountValue;
        return { ...b, products: prods, subtotal, discount, bundlePrice: Math.max(0, subtotal - discount) };
      }));

      return res.json({ ok: true, bundles: enriched });
    }

    /* ── POST: Create Bundle (Admin) ─────────────────────────── */
    if (req.method === 'POST') {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

      const { title, description, productIds, discountType, discountValue, img, startAt, endAt } = req.body || {};

      if (!title?.trim())          return res.status(400).json({ ok: false, error: 'Title দিন' });
      if (!Array.isArray(productIds) || productIds.length < 2)
        return res.status(400).json({ ok: false, error: 'কমপক্ষে ২টি product লাগবে' });
      if (!discountValue || discountValue < 1)
        return res.status(400).json({ ok: false, error: 'Discount amount দিন' });

      // Verify products exist
      const products = await Product.find({ productId: { $in: productIds } });
      if (products.length < productIds.length)
        return res.status(400).json({ ok: false, error: 'কিছু product পাওয়া যায়নি' });

      const bundle = await Bundle.create({
        title: sanitize(title, 200),
        description: sanitize(description || '', 500),
        productIds,
        discountType: discountType || 'percent',
        discountValue: parseFloat(discountValue),
        img: sanitize(img || '', 500),
        startAt: startAt ? new Date(startAt) : undefined,
        endAt:   endAt   ? new Date(endAt)   : undefined,
        isActive: true,
      });

      // Update products with bundle reference
      await Product.updateMany(
        { productId: { $in: productIds } },
        { $addToSet: { bundleIds: bundle._id.toString() } }
      );

      return res.status(201).json({ ok: true, bundle, message: 'Bundle তৈরি হয়েছে' });
    }

    /* ── PATCH: Update Bundle (Admin) ────────────────────────── */
    if (req.method === 'PATCH') {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { id } = req.query;
      if (!id) return res.status(400).json({ ok: false, error: 'Bundle ID দিন' });

      const updates = {};
      const b = req.body || {};
      if (b.title !== undefined)         updates.title         = sanitize(b.title, 200);
      if (b.description !== undefined)   updates.description   = sanitize(b.description, 500);
      if (b.discountValue !== undefined) updates.discountValue = parseFloat(b.discountValue);
      if (b.discountType !== undefined)  updates.discountType  = b.discountType;
      if (b.isActive !== undefined)      updates.isActive      = Boolean(b.isActive);
      if (b.productIds !== undefined)    updates.productIds    = b.productIds;

      const bundle = await Bundle.findByIdAndUpdate(id, updates, { new: true });
      if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
      return res.json({ ok: true, bundle, message: 'Bundle update হয়েছে' });
    }

    /* ── DELETE: Bundle (Admin) ───────────────────────────────── */
    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { id } = req.query;
      const bundle = await Bundle.findByIdAndDelete(id);
      if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
      return res.json({ ok: true, message: 'Bundle delete হয়েছে' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Bundle API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};