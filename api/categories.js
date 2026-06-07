/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/categories
 *  Dynamic Category Management
 *
 *  GET  /api/categories           → All active categories (public)
 *  GET  /api/categories?slug=xxx  → Single category
 *  GET  /api/categories?featured=1→ Featured categories
 *  POST /api/categories (admin)   → Create category
 *  PATCH/api/categories?id=xxx    → Update category
 *  DELETE /api/categories?id=xxx  → Delete (if no products)
 *  POST /api/categories?action=reorder → Reorder categories
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, Category, Product } = require('../_db');
const { handleCors, isAdmin, sanitize, slugify } = require('../_helpers');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  try {
    await connectDB();
    const action = req.query?.action || '';

    /* ── GET: Public ──────────────────────────────────────────── */
    if (req.method === 'GET') {
      const { slug, featured, parent } = req.query;

      if (slug) {
        const cat = await Category.findOne({ slug, isActive: true }).lean();
        if (!cat) return res.status(404).json({ ok: false, error: 'Category পাওয়া যায়নি' });

        // Get product count
        const count = await Product.countDocuments({ cat: cat.slug, isActive: true });
        return res.json({ ok: true, category: { ...cat, productCount: count } });
      }

      const query = { isActive: true };
      if (featured) query.isFeatured = true;
      if (parent !== undefined) query.parentSlug = parent || '';

      const cats = await Category.find(query).sort({ sortOrder: 1, name: 1 }).lean();

      // Enrich with live product count
      const enriched = await Promise.all(cats.map(async c => {
        const count = await Product.countDocuments({ cat: c.slug, isActive: true });
        return { ...c, productCount: count };
      }));

      // Build tree structure
      const roots    = enriched.filter(c => !c.parentSlug);
      const children = enriched.filter(c => c.parentSlug);

      const tree = roots.map(r => ({
        ...r,
        children: children.filter(c => c.parentSlug === r.slug),
      }));

      return res.json({ ok: true, categories: enriched, tree, total: enriched.length });
    }

    /* Admin only below */
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

    /* ── POST: Create Category ────────────────────────────────── */
    if (req.method === 'POST' && !action) {
      const b = req.body || {};
      if (!b.name?.trim()) return res.status(400).json({ ok: false, error: 'Category নাম দিন' });

      const slug = slugify(b.slug || b.name);
      const existing = await Category.findOne({ slug });
      if (existing) return res.status(409).json({ ok: false, error: `Slug "${slug}" ইতিমধ্যে আছে` });

      const cat = await Category.create({
        slug,
        name:        sanitize(b.name, 100),
        nameBn:      sanitize(b.nameBn || '', 100),
        icon:        sanitize(b.icon || '', 100),
        img:         sanitize(b.img || '', 500),
        parentSlug:  sanitize(b.parentSlug || '', 50),
        description: sanitize(b.description || '', 500),
        isActive:    b.isActive !== false,
        isFeatured:  Boolean(b.isFeatured),
        sortOrder:   parseInt(b.sortOrder) || 0,
        seoTitle:    sanitize(b.seoTitle || '', 200),
        seoDesc:     sanitize(b.seoDesc || '', 500),
      });

      return res.status(201).json({ ok: true, category: cat, message: '✅ Category তৈরি হয়েছে!' });
    }

    /* ── PATCH: Update Category ───────────────────────────────── */
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

      const b = req.body || {};
      const updates = {};
      const textFields = ['name','nameBn','icon','img','parentSlug','description','seoTitle','seoDesc'];
      textFields.forEach(f => { if (b[f] !== undefined) updates[f] = sanitize(b[f], 500); });
      if (b.isActive   !== undefined) updates.isActive   = Boolean(b.isActive);
      if (b.isFeatured !== undefined) updates.isFeatured = Boolean(b.isFeatured);
      if (b.sortOrder  !== undefined) updates.sortOrder  = parseInt(b.sortOrder);

      const cat = await Category.findByIdAndUpdate(id, updates, { new: true });
      if (!cat) return res.status(404).json({ ok: false, error: 'Category পাওয়া যায়নি' });

      return res.json({ ok: true, category: cat, message: 'Category update হয়েছে' });
    }

    /* ── POST: Reorder ────────────────────────────────────────── */
    if (req.method === 'POST' && action === 'reorder') {
      const { order } = req.body || {};
      if (!Array.isArray(order)) return res.status(400).json({ ok: false, error: 'order array দিন' });

      await Promise.all(order.map((id, i) =>
        Category.findByIdAndUpdate(id, { sortOrder: i })
      ));

      return res.json({ ok: true, message: 'Category order আপডেট হয়েছে' });
    }

    /* ── DELETE: Remove Category ──────────────────────────────── */
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
  } catch (err) {
    console.error('Categories API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
