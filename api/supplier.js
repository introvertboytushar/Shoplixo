/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/supplier
 *  Dropshipping + Supplier Management System
 *
 *  GET    /api/supplier               → সব suppliers
 *  GET    /api/supplier?id=xxx        → Single supplier + products
 *  POST   /api/supplier               → নতুন supplier যোগ
 *  PATCH  /api/supplier?id=xxx        → Supplier update
 *  DELETE /api/supplier?id=xxx        → Supplier delete
 *
 *  GET  /api/supplier?action=products&supplierId=xx → supplier এর products
 *  POST /api/supplier?action=restock  → Stock replenish করুন
 *  POST /api/supplier?action=pay      → Supplier payment
 *  GET  /api/supplier?action=ledger&supplierId=xx   → Payment history
 *  GET  /api/supplier?action=low-stock → Low stock products
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, Supplier, Product, InventoryLog, Order } = require('../_db');
const { handleCors, isAdmin, sanitize, generateSupplierId, checkRateLimit } = require('../_helpers');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

  try {
    await connectDB();
    const action = req.query?.action || '';

    /* ══════════════════════════════════════════════════════
       GET ACTIONS
    ══════════════════════════════════════════════════════ */
    if (req.method === 'GET') {

      /* Single supplier */
      if (req.query.id && !action) {
        const supplier = await Supplier.findById(req.query.id).lean();
        if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier পাওয়া যায়নি' });

        const products = await Product.find({ supplierId: supplier.supplierId })
          .select('productId name price supplierPrice stock cat img isActive totalSold').lean();

        const totalProfit = products.reduce((s, p) => s + (p.price - p.supplierPrice) * p.totalSold, 0);

        return res.json({ ok: true, supplier: { ...supplier, products, totalProfit } });
      }

      /* Supplier's products */
      if (action === 'products') {
        const { supplierId, page = 1, limit = 30 } = req.query;
        if (!supplierId) return res.status(400).json({ ok: false, error: 'supplierId দিন' });

        const skip    = (parseInt(page) - 1) * parseInt(limit);
        const [products, total] = await Promise.all([
          Product.find({ supplierId }).skip(skip).limit(parseInt(limit))
            .select('productId name price supplierPrice orig stock cat img badge isActive isFlash totalSold').lean(),
          Product.countDocuments({ supplierId }),
        ]);

        const enriched = products.map(p => ({
          ...p,
          margin: p.price - p.supplierPrice,
          marginPct: p.supplierPrice > 0 ? Math.round(((p.price - p.supplierPrice) / p.supplierPrice) * 100) : 0,
        }));

        return res.json({ ok: true, products: enriched, total, page: parseInt(page) });
      }

      /* Low stock products */
      if (action === 'low-stock') {
        const products = await Product.find({
          isActive: true,
          $expr: { $lte: ['$stock', '$lowStockAlert'] },
        }).select('productId name stock lowStockAlert cat supplierId supplierPrice img').lean();

        // Group by supplier
        const bySupplier = {};
        for (const p of products) {
          const key = p.supplierId || 'unknown';
          if (!bySupplier[key]) bySupplier[key] = { supplierId: key, products: [] };
          bySupplier[key].products.push(p);
        }

        return res.json({ ok: true, products, grouped: Object.values(bySupplier), total: products.length });
      }

      /* Supplier payment ledger */
      if (action === 'ledger') {
        const { supplierId, page = 1 } = req.query;
        if (!supplierId) return res.status(400).json({ ok: false, error: 'supplierId দিন' });

        const skip = (parseInt(page) - 1) * 20;
        const [logs, total] = await Promise.all([
          InventoryLog.find({ supplierId }).sort({ createdAt: -1 }).skip(skip).limit(20).lean(),
          InventoryLog.countDocuments({ supplierId }),
        ]);

        const totalCost = await InventoryLog.aggregate([
          { $match: { supplierId, type: 'in' } },
          { $group: { _id: null, total: { $sum: { $multiply: ['$qty', '$costPrice'] } } } },
        ]);

        return res.json({ ok: true, logs, total, page: parseInt(page), totalCost: totalCost[0]?.total || 0 });
      }

      /* All suppliers list */
      const { search, type, page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const query = {};
      if (type)   query.type   = type;
      if (search) query.$or    = [
        { name:    { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { phone:   { $regex: search, $options: 'i' } },
      ];

      const [suppliers, total] = await Promise.all([
        Supplier.find(query).sort({ totalOrders: -1 }).skip(skip).limit(parseInt(limit)).lean(),
        Supplier.countDocuments(query),
      ]);

      // Enrich with live stats
      const enriched = await Promise.all(suppliers.map(async s => {
        const productCount = await Product.countDocuments({ supplierId: s.supplierId });
        const lowStock     = await Product.countDocuments({
          supplierId: s.supplierId,
          $expr: { $lte: ['$stock', '$lowStockAlert'] },
        });
        return { ...s, productCount, lowStock };
      }));

      return res.json({ ok: true, suppliers: enriched, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    }

    /* ══════════════════════════════════════════════════════
       POST: Create Supplier
    ══════════════════════════════════════════════════════ */
    if (req.method === 'POST' && !action) {
      const b = req.body || {};
      if (!b.name?.trim())  return res.status(400).json({ ok: false, error: 'নাম দিন' });
      if (!b.phone?.trim()) return res.status(400).json({ ok: false, error: 'Phone দিন' });

      const supplierId = generateSupplierId();

      const supplier = await Supplier.create({
        supplierId,
        name:         sanitize(b.name, 100),
        company:      sanitize(b.company || '', 100),
        phone:        sanitize(b.phone, 20),
        email:        sanitize(b.email || '', 150),
        address:      sanitize(b.address || '', 300),
        country:      sanitize(b.country || 'Bangladesh', 50),
        website:      sanitize(b.website || '', 200),
        type:         ['local','china','india','other'].includes(b.type) ? b.type : 'local',
        paymentTerms: sanitize(b.paymentTerms || '', 200),
        deliveryTime: sanitize(b.deliveryTime || '3-7 days', 50),
        minOrder:     parseFloat(b.minOrder) || 0,
        categories:   Array.isArray(b.categories) ? b.categories : [],
        notes:        sanitize(b.notes || '', 500),
        bankInfo:     b.bankInfo || {},
        isActive:     true,
      });

      return res.status(201).json({ ok: true, supplier, message: '✅ Supplier যোগ হয়েছে!' });
    }

    /* ══════════════════════════════════════════════════════
       POST: Restock (add inventory from supplier)
    ══════════════════════════════════════════════════════ */
    if (req.method === 'POST' && action === 'restock') {
      const { productId, qty, costPrice, supplierId, note } = req.body || {};
      if (!productId || !qty) return res.status(400).json({ ok: false, error: 'productId ও qty দিন' });

      const product = await Product.findOne({ productId });
      if (!product) return res.status(404).json({ ok: false, error: 'Product পাওয়া যায়নি' });

      const stockBefore = product.stock;
      product.stock += parseInt(qty);
      if (costPrice) product.supplierPrice = parseFloat(costPrice);
      await product.save();

      await InventoryLog.create({
        productId, productName: product.name,
        type: 'in', qty: parseInt(qty),
        stockBefore, stockAfter: product.stock,
        ref: supplierId || product.supplierId,
        refType: 'purchase', note: sanitize(note || '', 200),
        supplierId: supplierId || product.supplierId,
        costPrice: parseFloat(costPrice) || product.supplierPrice,
        updatedBy: 'admin',
      });

      // Update supplier stats
      if (supplierId) {
        await Supplier.findOneAndUpdate(
          { supplierId },
          { $inc: { totalOrders: 1 } }
        );
      }

      return res.json({ ok: true, stock: product.stock, message: `✅ ${qty}টি stock যোগ হয়েছে! নতুন stock: ${product.stock}` });
    }

    /* ══════════════════════════════════════════════════════
       POST: Bulk Restock
    ══════════════════════════════════════════════════════ */
    if (req.method === 'POST' && action === 'bulk-restock') {
      const { items, supplierId } = req.body || {};
      if (!Array.isArray(items) || !items.length)
        return res.status(400).json({ ok: false, error: 'Items দিন' });

      const results = [];
      for (const item of items.slice(0, 50)) {
        try {
          const product = await Product.findOne({ productId: item.productId });
          if (!product) { results.push({ productId: item.productId, error: 'Not found' }); continue; }

          const stockBefore = product.stock;
          product.stock += parseInt(item.qty);
          if (item.costPrice) product.supplierPrice = parseFloat(item.costPrice);
          await product.save();

          await InventoryLog.create({
            productId: item.productId, productName: product.name,
            type: 'in', qty: parseInt(item.qty),
            stockBefore, stockAfter: product.stock,
            refType: 'purchase', supplierId,
            costPrice: parseFloat(item.costPrice) || product.supplierPrice,
            updatedBy: 'admin',
          });

          results.push({ productId: item.productId, added: item.qty, newStock: product.stock });
        } catch (e) {
          results.push({ productId: item.productId, error: e.message });
        }
      }

      if (supplierId) {
        await Supplier.findOneAndUpdate({ supplierId }, { $inc: { totalOrders: 1 } });
      }

      return res.json({ ok: true, results, message: `${results.filter(r => !r.error).length}টি product restock হয়েছে` });
    }

    /* ══════════════════════════════════════════════════════
       POST: Record Supplier Payment
    ══════════════════════════════════════════════════════ */
    if (req.method === 'POST' && action === 'pay') {
      const { supplierId, amount, method, ref, note } = req.body || {};
      if (!supplierId || !amount) return res.status(400).json({ ok: false, error: 'supplierId ও amount দিন' });

      await Supplier.findOneAndUpdate(
        { supplierId },
        { $inc: { totalPaid: parseFloat(amount) } }
      );

      await InventoryLog.create({
        productId: 'PAYMENT', productName: 'Supplier Payment',
        type: 'in', qty: 0,
        stockBefore: 0, stockAfter: 0,
        ref: ref || '', refType: 'purchase', supplierId,
        costPrice: parseFloat(amount),
        note: `Payment: ৳${amount} via ${method || 'bank'} — ${note || ''}`,
        updatedBy: 'admin',
      });

      return res.json({ ok: true, message: `✅ ৳${amount} payment recorded` });
    }

    /* ══════════════════════════════════════════════════════
       PATCH: Update Supplier
    ══════════════════════════════════════════════════════ */
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

      const b = req.body || {};
      const updates = {};
      const textFields = ['name','company','phone','email','address','country','website','paymentTerms','deliveryTime','notes'];
      textFields.forEach(f => { if (b[f] !== undefined) updates[f] = sanitize(b[f], 300); });
      if (b.minOrder   !== undefined) updates.minOrder   = parseFloat(b.minOrder);
      if (b.isActive   !== undefined) updates.isActive   = Boolean(b.isActive);
      if (b.isVerified !== undefined) updates.isVerified = Boolean(b.isVerified);
      if (b.rating     !== undefined) updates.rating     = parseFloat(b.rating);
      if (b.type       !== undefined) updates.type       = b.type;
      if (b.bankInfo   !== undefined) updates.bankInfo   = b.bankInfo;
      if (b.categories !== undefined) updates.categories = b.categories;

      const supplier = await Supplier.findByIdAndUpdate(id, updates, { new: true });
      if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier পাওয়া যায়নি' });

      return res.json({ ok: true, supplier, message: 'Supplier update হয়েছে' });
    }

    /* ══════════════════════════════════════════════════════
       DELETE: Remove Supplier
    ══════════════════════════════════════════════════════ */
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

      const supplier = await Supplier.findByIdAndDelete(id);
      if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier পাওয়া যায়নি' });

      // Unlink products
      await Product.updateMany(
        { supplierId: supplier.supplierId },
        { $set: { supplierId: '', isDropship: false } }
      );

      return res.json({ ok: true, message: `"${supplier.name}" delete হয়েছে` });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Supplier API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
