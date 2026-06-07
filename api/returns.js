/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/returns
 *  Return & Refund Management System
 *
 *  POST /api/returns                → Return request submit
 *  GET  /api/returns?orderId=xxx    → My return status
 *  GET  /api/returns (admin)        → All return requests
 *  PATCH /api/returns?id=xxx (admin)→ Process return
 *  POST /api/returns?action=approve → Approve + refund
 *  POST /api/returns?action=reject  → Reject request
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, ReturnRequest, Order, User, LoyaltyTxn, InventoryLog, Notification } = require('../_db');
const {
  handleCors, isAdmin, verifyToken, sanitize, generateReturnId,
  sendEmail, sendSMS, returnApprovedEmail, smsTemplates, checkRateLimit,
} = require('../_helpers');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  const ip     = req.headers['x-forwarded-for']?.split(',')[0] || '';
  const action = req.query?.action || '';

  try {
    await connectDB();

    /* ── GET: Admin — all returns ──────────────────────────────── */
    if (req.method === 'GET' && isAdmin(req) && !req.query.orderId) {
      const { status, page = 1, search } = req.query;
      const skip  = (parseInt(page) - 1) * 20;
      const query = {};
      if (status) query.status = status;
      if (search) query.$or = [
        { returnId: { $regex: search, $options: 'i' } },
        { orderId:  { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
      ];

      const [returns, total] = await Promise.all([
        ReturnRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(20).lean(),
        ReturnRequest.countDocuments(query),
      ]);

      const stats = await ReturnRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$refundAmount' } } },
      ]);

      return res.json({ ok: true, returns, total, stats, page: parseInt(page) });
    }

    /* ── GET: Customer — my return status ─────────────────────── */
    if (req.method === 'GET') {
      const { orderId, returnId } = req.query;
      const decoded = verifyToken(req);

      if (returnId) {
        const ret = await ReturnRequest.findOne({ returnId }).lean();
        if (!ret) return res.status(404).json({ ok: false, error: 'Return পাওয়া যায়নি' });
        return res.json({ ok: true, return: ret });
      }

      if (orderId) {
        const returns = await ReturnRequest.find({ orderId }).lean();
        return res.json({ ok: true, returns });
      }

      if (decoded) {
        const returns = await ReturnRequest.find({ customerId: decoded.id })
          .sort({ createdAt: -1 }).limit(20).lean();
        return res.json({ ok: true, returns });
      }

      return res.status(400).json({ ok: false, error: 'orderId বা login করুন' });
    }

    /* ── POST: Submit Return Request ───────────────────────────── */
    if (req.method === 'POST' && !action) {
      if (!checkRateLimit(`return_${ip}`, 3, 3600000)) {
        return res.status(429).json({ ok: false, error: 'অনেক return request! পরে চেষ্টা করুন।' });
      }

      const decoded = verifyToken(req);
      const b       = req.body || {};

      const orderId    = sanitize(b.orderId || '', 20).toUpperCase();
      const reason     = sanitize(b.reason || '', 200);
      const description= sanitize(b.description || '', 1000);
      const refundMethod = b.refundMethod || 'bkash';
      const images     = Array.isArray(b.images) ? b.images.slice(0, 5).map(i => sanitize(i, 500)) : [];

      if (!orderId) return res.status(400).json({ ok: false, error: 'Order ID দিন' });
      if (!reason)  return res.status(400).json({ ok: false, error: 'কারণ লিখুন' });

      // Validate order
      const order = await Order.findOne({ orderId });
      if (!order) return res.status(404).json({ ok: false, error: 'Order পাওয়া যায়নি' });
      if (!['delivered'].includes(order.status)) {
        return res.status(400).json({ ok: false, error: 'শুধু Delivered order এ return করা যায়' });
      }

      // Check return window (7 days default)
      const deliveredAt = order.statusHistory.find(h => h.status === 'delivered')?.updatedAt;
      if (deliveredAt) {
        const daysSince = (Date.now() - new Date(deliveredAt)) / 86400000;
        if (daysSince > 7) {
          return res.status(400).json({ ok: false, error: 'Return window শেষ (৭ দিন পার হয়ে গেছে)' });
        }
      }

      // Check duplicate
      const existing = await ReturnRequest.findOne({ orderId, status: { $in: ['pending','approved'] } });
      if (existing) return res.status(409).json({ ok: false, error: 'এই order এ ইতিমধ্যে return request আছে' });

      const returnReq = await ReturnRequest.create({
        returnId:      generateReturnId(),
        orderId,
        customerId:    decoded?.id || null,
        customerPhone: order.customer.phone,
        customerName:  order.customer.name,
        items:         (b.items || order.items).map(i => ({
          productId: i.productId,
          name:      i.name,
          qty:       parseInt(i.qty) || 1,
          price:     parseFloat(i.price) || 0,
          reason:    sanitize(i.reason || reason, 100),
        })),
        reason, description, images,
        refundMethod,
        refundAmount: order.pricing.total,
        status: 'pending',
      });

      // Update order status
      order.status = 'return_requested';
      order.statusHistory.push({ status: 'return_requested', note: reason, updatedBy: 'customer' });
      await order.save();

      // Notify admin (via DB notification)
      await Notification.create({
        type: 'return',
        title: `Return Request — ${orderId}`,
        message: `${order.customer.name} ফেরত চেয়েছেন। কারণ: ${reason}`,
        icon: '📬',
        isGlobal: false,
        metadata: { returnId: returnReq.returnId, orderId },
      }).catch(() => {});

      return res.status(201).json({
        ok: true,
        returnId: returnReq.returnId,
        message: '✅ Return request পাঠানো হয়েছে। Admin ২৪ ঘণ্টার মধ্যে review করবে।',
      });
    }

    /* Admin only below */
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

    /* ── PATCH: Update Return ──────────────────────────────────── */
    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

      const b = req.body || {};
      const updates = {};
      if (b.status        !== undefined) updates.status        = b.status;
      if (b.refundAmount  !== undefined) updates.refundAmount  = parseFloat(b.refundAmount);
      if (b.refundMethod  !== undefined) updates.refundMethod  = b.refundMethod;
      if (b.refundRef     !== undefined) updates.refundRef     = sanitize(b.refundRef, 100);
      if (b.adminNote     !== undefined) updates.adminNote     = sanitize(b.adminNote, 500);

      const ret = await ReturnRequest.findByIdAndUpdate(id, updates, { new: true });
      if (!ret) return res.status(404).json({ ok: false, error: 'Return পাওয়া যায়নি' });
      return res.json({ ok: true, return: ret });
    }

    /* ── POST: Approve Return + Process Refund ─────────────────── */
    if (req.method === 'POST' && action === 'approve') {
      const { id, refundAmount, refundMethod, refundRef, restockItems, note } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

      const ret = await ReturnRequest.findById(id);
      if (!ret) return res.status(404).json({ ok: false, error: 'Return পাওয়া যায়নি' });
      if (ret.status !== 'pending') {
        return res.status(400).json({ ok: false, error: 'এই request ইতিমধ্যে process হয়েছে' });
      }

      const amt = parseFloat(refundAmount) || ret.refundAmount;

      ret.status       = 'approved';
      ret.refundAmount = amt;
      ret.refundMethod = refundMethod || ret.refundMethod;
      ret.refundRef    = sanitize(refundRef || '', 100);
      ret.adminNote    = sanitize(note || '', 300);
      ret.processedAt  = new Date();
      ret.processedBy  = 'admin';
      await ret.save();

      // Update order
      await Order.findOneAndUpdate(
        { orderId: ret.orderId },
        { status: 'refunded', $push: { statusHistory: { status: 'refunded', note: `Refunded ৳${amt}`, updatedBy: 'admin' } } }
      );

      // Restock items if requested
      if (restockItems && Array.isArray(ret.items)) {
        for (const item of ret.items) {
          const product = await (require('../_db')).Product.findOne({ productId: item.productId });
          if (product) {
            const before = product.stock;
            product.stock += item.qty;
            await product.save();
            await InventoryLog.create({
              productId: item.productId, productName: item.name,
              type: 'return', qty: item.qty,
              stockBefore: before, stockAfter: product.stock,
              ref: ret.returnId, refType: 'return', updatedBy: 'admin',
            });
          }
        }
      }

      // Notify customer
      sendEmail(
        ret.customerPhone + '@customer.shoplixo.shop', // placeholder
        `✅ Return Approved — ${ret.returnId}`,
        returnApprovedEmail(ret, amt)
      ).catch(() => {});

      if (ret.customerPhone) {
        sendSMS(ret.customerPhone, smsTemplates.returnApproved(ret.returnId, amt)).catch(() => {});
      }

      return res.json({ ok: true, return: ret, message: `✅ Return approved! ৳${amt} refund দেওয়া হবে।` });
    }

    /* ── POST: Reject Return ───────────────────────────────────── */
    if (req.method === 'POST' && action === 'reject') {
      const { id, note } = req.body || {};
      const ret = await ReturnRequest.findByIdAndUpdate(
        id,
        { status: 'rejected', adminNote: sanitize(note || '', 300), processedAt: new Date(), processedBy: 'admin' },
        { new: true }
      );
      if (!ret) return res.status(404).json({ ok: false, error: 'Return পাওয়া যায়নি' });

      // Revert order status
      await Order.findOneAndUpdate(
        { orderId: ret.orderId },
        { status: 'delivered', $push: { statusHistory: { status: 'delivered', note: 'Return rejected', updatedBy: 'admin' } } }
      );

      if (ret.customerPhone) {
        sendSMS(ret.customerPhone, `আপনার return request (${ret.returnId}) reject হয়েছে। কারণ: ${note || 'Policy অনুযায়ী'}। Shoplixo`).catch(() => {});
      }

      return res.json({ ok: true, return: ret, message: 'Return request reject করা হয়েছে' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Returns API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
