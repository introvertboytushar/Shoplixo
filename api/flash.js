/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/flash
 *  Flash Sale Auto-Scheduler System
 *
 *  GET  /api/flash              → active flash sales (public)
 *  GET  /api/flash?id=xxx       → single flash sale + products
 *  GET  /api/flash?action=check → countdown timer data
 *
 *  Admin (x-admin-key):
 *  GET  /api/flash?action=all   → all flash sales (past + upcoming)
 *  POST /api/flash              → create flash sale
 *  PATCH /api/flash?id=xxx      → update flash sale
 *  DELETE /api/flash?id=xxx     → delete flash sale
 *  POST /api/flash?action=toggle&id=xxx → toggle active
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, FlashSale, Product } = require('../_db');
const { handleCors, isAdmin, sanitize } = require('../_helpers');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  try {
    await connectDB();
    const action = req.query?.action || '';
    const now    = new Date();

    /* ══════════════════════════════════════════════════════════
       GET REQUESTS
    ══════════════════════════════════════════════════════════ */
    if (req.method === 'GET') {

      /* ── Countdown timer check (public) ──────────────────── */
      if (action === 'check') {
        const sale = await FlashSale.findOne({
          isActive: true,
          startAt: { $lte: now },
          endAt:   { $gt: now },
        }).select('title endAt bannerImg description').lean();

        if (!sale) {
          // Check upcoming
          const upcoming = await FlashSale.findOne({
            isActive: true,
            startAt: { $gt: now },
          }).sort({ startAt: 1 }).select('title startAt endAt').lean();

          return res.json({ ok: true, active: false, upcoming: upcoming || null });
        }

        return res.json({
          ok: true, active: true,
          title: sale.title,
          endAt: sale.endAt,
          bannerImg: sale.bannerImg,
          description: sale.description,
          secondsLeft: Math.max(0, Math.floor((sale.endAt - now) / 1000)),
        });
      }

      /* ── Admin: All flash sales ───────────────────────────── */
      if (action === 'all') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

        const sales = await FlashSale.find({}).sort({ startAt: -1 }).lean();
        const enriched = sales.map(s => ({
          ...s,
          isLive: s.isActive && s.startAt <= now && s.endAt > now,
          isUpcoming: s.startAt > now,
          isExpired: s.endAt <= now,
        }));
        return res.json({ ok: true, sales: enriched });
      }

      /* ── Single flash sale by ID ──────────────────────────── */
      if (req.query.id) {
        const sale = await FlashSale.findById(req.query.id).lean();
        if (!sale) return res.status(404).json({ ok: false, error: 'Flash sale পাওয়া যায়নি' });

        // Get product details
        const productIds = sale.products.map(p => p.productId);
        const dbProds    = await Product.find({ productId: { $in: productIds }, isActive: true })
          .select('productId name price orig img badge rating reviews stock').lean();

        const prodMap = Object.fromEntries(dbProds.map(p => [p.productId, p]));
        const enrichedProducts = sale.products.map(sp => ({
          ...sp,
          ...(prodMap[sp.productId] || {}),
          flashPrice: sp.salePrice,
          origPrice:  sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice,
          savings:    (sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice) - sp.salePrice,
        }));

        return res.json({
          ok: true,
          sale: {
            ...sale,
            products: enrichedProducts,
            isLive: sale.isActive && sale.startAt <= now && sale.endAt > now,
            secondsLeft: sale.endAt > now ? Math.floor((sale.endAt - now) / 1000) : 0,
          },
        });
      }

      /* ── Public: Active flash sales ───────────────────────── */
      const sales = await FlashSale.find({
        isActive: true,
        startAt: { $lte: now },
        endAt:   { $gt: now },
      }).sort({ endAt: 1 }).lean();

      // Enrich each sale with product details
      const enriched = await Promise.all(sales.map(async (sale) => {
        const productIds = sale.products.map(p => p.productId);
        const dbProds    = await Product.find({ productId: { $in: productIds }, isActive: true })
          .select('productId name price img badge rating stock').lean();

        const prodMap = Object.fromEntries(dbProds.map(p => [p.productId, p]));
        const products = sale.products.map(sp => ({
          ...sp,
          name: prodMap[sp.productId]?.name || '',
          img:  prodMap[sp.productId]?.img  || '',
          currentStock: prodMap[sp.productId]?.stock || sp.stock,
          savings: (sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice) - sp.salePrice,
        }));

        return {
          ...sale,
          products,
          secondsLeft: Math.floor((sale.endAt - now) / 1000),
          totalItems:  sale.products.length,
        };
      }));

      return res.json({ ok: true, sales: enriched, count: enriched.length });
    }

    /* ══════════════════════════════════════════════════════════
       ADMIN — Create / Update / Delete / Toggle
    ══════════════════════════════════════════════════════════ */
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

    /* ── POST: Create Flash Sale ──────────────────────────── */
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

      // Validate products
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
        title:           sanitize(b.title, 200),
        description:     sanitize(b.description || '', 500),
        startAt, endAt,
        isActive:        b.isActive !== false,
        products,
        extraDiscountPct: parseFloat(b.extraDiscountPct) || 0,
        bannerImg:       sanitize(b.bannerImg || '', 500),
      });

      // Mark products as flash items if sale is active and live
      if (sale.isActive && startAt <= now && endAt > now) {
        Product.updateMany(
          { productId: { $in: products.map(p => p.productId) } },
          { $set: { isFlash: true } }
        ).catch(() => {});
      }

      return res.status(201).json({ ok: true, sale, message: 'Flash sale তৈরি হয়েছে!' });
    }

    /* ── PATCH: Update Flash Sale ─────────────────────────── */
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'Flash sale ID দিন' });

      const b = req.body || {};
      const updates = {};

      if (b.title       !== undefined) updates.title       = sanitize(b.title, 200);
      if (b.description !== undefined) updates.description = sanitize(b.description, 500);
      if (b.startAt     !== undefined) updates.startAt     = new Date(b.startAt);
      if (b.endAt       !== undefined) updates.endAt       = new Date(b.endAt);
      if (b.isActive    !== undefined) updates.isActive    = Boolean(b.isActive);
      if (b.bannerImg   !== undefined) updates.bannerImg   = sanitize(b.bannerImg, 500);
      if (b.extraDiscountPct !== undefined) updates.extraDiscountPct = parseFloat(b.extraDiscountPct) || 0;
      if (b.products    !== undefined) {
        updates.products = b.products.slice(0, 50).map(p => ({
          productId: String(p.productId || ''),
          salePrice: Math.max(0, parseFloat(p.salePrice) || 0),
          origPrice: Math.max(0, parseFloat(p.origPrice) || 0),
          stock:     Math.max(0, parseInt(p.stock) || 10),
          soldCount: parseInt(p.soldCount) || 0,
        }));
      }

      const sale = await FlashSale.findByIdAndUpdate(id, updates, { new: true });
      if (!sale) return res.status(404).json({ ok: false, error: 'Flash sale পাওয়া যায়নি' });
      return res.json({ ok: true, sale, message: 'Flash sale আপডেট হয়েছে' });
    }

    /* ── POST: Toggle Active ──────────────────────────────── */
    if (req.method === 'POST' && action === 'toggle') {
      const id = req.query.id || req.body?.id;
      if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

      const sale = await FlashSale.findById(id);
      if (!sale) return res.status(404).json({ ok: false, error: 'পাওয়া যায়নি' });

      sale.isActive = !sale.isActive;
      await sale.save();

      // Update product isFlash flags
      const pIds = sale.products.map(p => p.productId);
      if (sale.isActive && sale.startAt <= now && sale.endAt > now) {
        Product.updateMany({ productId: { $in: pIds } }, { isFlash: true }).catch(() => {});
      } else {
        Product.updateMany({ productId: { $in: pIds } }, { isFlash: false }).catch(() => {});
      }

      return res.json({ ok: true, isActive: sale.isActive });
    }

    /* ── DELETE: Delete Flash Sale ────────────────────────── */
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

      const sale = await FlashSale.findByIdAndDelete(id);
      if (!sale) return res.status(404).json({ ok: false, error: 'পাওয়া যায়নি' });

      // Remove flash flag from products
      const pIds = sale.products.map(p => p.productId);
      Product.updateMany({ productId: { $in: pIds } }, { isFlash: false }).catch(() => {});

      return res.json({ ok: true, message: 'Flash sale delete হয়েছে' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('Flash API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
