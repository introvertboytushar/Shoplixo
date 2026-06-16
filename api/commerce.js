/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/commerce
 *  Merged: Newsletter · Bundle · Flash Sale
 *
 *  ── NEWSLETTER ───────────────────────────────────────────────
 *  POST /api/commerce?module=newsletter          → Subscribe
 *
 *  ── BUNDLE ───────────────────────────────────────────────────
 *  GET    /api/commerce?module=bundle            → All active bundles
 *  GET    /api/commerce?module=bundle&id=xxx     → Single bundle
 *  GET    /api/commerce?module=bundle&productId=xx→ Bundles by product
 *  POST   /api/commerce?module=bundle (admin)    → Create bundle
 *  PATCH  /api/commerce?module=bundle&id=xx      → Update bundle
 *  DELETE /api/commerce?module=bundle&id=xx      → Delete bundle
 *
 *  ── SHURJOPAY ─────────────────────────────────────────────
 *  POST /api/commerce?module=shurjopay&action=token     → Get token
 *  POST /api/commerce?module=shurjopay&action=init      → Payment initiate
 *  POST /api/commerce?module=shurjopay&action=verify    → Payment verify
 *
 *  ── FLASH ────────────────────────────────────────────────────
 *  GET  /api/commerce?module=flash               → Active flash sales
 *  GET  /api/commerce?module=flash&id=xxx        → Single flash sale
 *  GET  /api/commerce?module=flash&action=check  → Countdown timer
 *  GET  /api/commerce?module=flash&action=all    → All (admin)
 *  POST /api/commerce?module=flash (admin)       → Create flash sale
 *  PATCH /api/commerce?module=flash&id=xxx       → Update
 *  POST /api/commerce?module=flash&action=toggle&id=xxx → Toggle
 *  DELETE /api/commerce?module=flash&id=xxx      → Delete
 * ══════════════════════════════════════════════════════════════
 */

const {
  connectDB, Newsletter, User,
  Bundle, Product, FlashSale,
} = require('./_db');
const {
  handleCors, isAdmin, verifyToken, sanitize, checkRateLimit,
  isValidEmail, sendEmail,
} = require('./_helpers');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   NEWSLETTER WELCOME EMAIL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function newsletterWelcomeEmail(email, name) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#1A1A2E,#2D1B6E);padding:32px;text-align:center">
    <div style="font-size:28px;font-weight:800;color:#fff">Shop<span style="color:#FFB800">lixo</span></div>
  </div>
  <div style="background:#fff;padding:32px;text-align:center">
    <div style="font-size:40px;margin-bottom:12px">🎁</div>
    <h2 style="color:#1A1A2E;margin-bottom:8px">ধন্যবাদ Subscribe করার জন্য!</h2>
    ${name ? `<p style="color:#666">স্বাগতম, ${name}!</p>` : ''}
    <p style="color:#666;margin-top:8px">এখন থেকে exclusive offers ও নতুন product update সবার আগে পাবেন।</p>
    <a href="${process.env.SITE_URL || 'https://shoplixo.shop'}"
       style="display:inline-block;background:#E41E26;color:#fff;padding:12px 32px;border-radius:999px;font-weight:700;text-decoration:none">
      এখনই Shop করুন →
    </a>
  </div>
</body></html>`;
}

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
       MODULE: NEWSLETTER
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'newsletter') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!checkRateLimit(`nl_${ip}`, 5, 60000)) {
        return res.status(429).json({ ok: false, error: 'অনেক request!' });
      }

      const email = sanitize(req.body?.email || '', 150).toLowerCase();
      const name  = sanitize(req.body?.name  || '', 100);
      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ ok: false, error: 'সঠিক Email দিন!' });
      }

      const existing = await Newsletter.findOne({ email });
      if (existing) {
        if (!existing.isActive) {
          existing.isActive = true;
          await existing.save();
          return res.json({ ok: true, message: 'আপনি আবার subscribe হয়েছেন!' });
        }
        return res.json({ ok: true, message: 'আপনি ইতিমধ্যে subscriber!' });
      }

      await Newsletter.create({ email, name, source: 'website' });

      sendEmail(email, '🎁 আপনার Welcome Gift — Shoplixo', newsletterWelcomeEmail(email, name))
        .catch(() => {});

      return res.status(201).json({
        ok: true,
        message: '🎉 Subscribe সফল হয়েছে!',
      });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: BUNDLE
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'bundle') {
      /* GET */
      if (req.method === 'GET') {
        const { id, productId } = req.query;

        if (id) {
          const bundle = await Bundle.findById(id);
          if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
          const products = await Product.find({ productId: { $in: bundle.productIds }, isActive: true })
            .select('productId name price orig img rating reviews stock badge').lean();
          const subtotal    = products.reduce((s, p) => s + p.price, 0);
          const discount    = bundle.discountType === 'percent'
            ? Math.round(subtotal * bundle.discountValue / 100) : bundle.discountValue;
          const bundlePrice = Math.max(0, subtotal - discount);
          return res.json({ ok: true, bundle: { ...bundle.toObject(), products, subtotal, discount, bundlePrice } });
        }

        const now   = new Date();
        const query = { isActive: true, $or: [{ startAt: { $exists: false } }, { startAt: { $lte: now } }] };
        if (productId) query.productIds = productId;

        const bundles  = await Bundle.find(query).sort({ createdAt: -1 }).limit(20).lean();
        const enriched = await Promise.all(bundles.map(async (b) => {
          const prods    = await Product.find({ productId: { $in: b.productIds }, isActive: true })
            .select('productId name price img stock').lean();
          const subtotal = prods.reduce((s, p) => s + p.price, 0);
          const discount = b.discountType === 'percent'
            ? Math.round(subtotal * b.discountValue / 100) : b.discountValue;
          return { ...b, products: prods, subtotal, discount, bundlePrice: Math.max(0, subtotal - discount) };
        }));
        return res.json({ ok: true, bundles: enriched });
      }

      /* POST: Create */
      if (req.method === 'POST') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { title, description, productIds, discountType, discountValue, img, startAt, endAt } = req.body || {};
        if (!title?.trim())          return res.status(400).json({ ok: false, error: 'Title দিন' });
        if (!Array.isArray(productIds) || productIds.length < 2)
          return res.status(400).json({ ok: false, error: 'কমপক্ষে ২টি product লাগবে' });
        if (!discountValue || discountValue < 1)
          return res.status(400).json({ ok: false, error: 'Discount amount দিন' });
        const products = await Product.find({ productId: { $in: productIds } });
        if (products.length < productIds.length)
          return res.status(400).json({ ok: false, error: 'কিছু product পাওয়া যায়নি' });
        const bundle = await Bundle.create({
          title: sanitize(title, 200), description: sanitize(description || '', 500),
          productIds, discountType: discountType || 'percent',
          discountValue: parseFloat(discountValue), img: sanitize(img || '', 500),
          startAt: startAt ? new Date(startAt) : undefined,
          endAt:   endAt   ? new Date(endAt)   : undefined,
          isActive: true,
        });
        await Product.updateMany({ productId: { $in: productIds } }, { $addToSet: { bundleIds: bundle._id.toString() } });
        return res.status(201).json({ ok: true, bundle, message: 'Bundle তৈরি হয়েছে' });
      }

      /* PATCH: Update */
      if (req.method === 'PATCH') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { id } = req.query;
        if (!id) return res.status(400).json({ ok: false, error: 'Bundle ID দিন' });
        const updates = {};
        const b = req.body || {};
        if (b.title         !== undefined) updates.title         = sanitize(b.title, 200);
        if (b.description   !== undefined) updates.description   = sanitize(b.description, 500);
        if (b.discountValue !== undefined) updates.discountValue = parseFloat(b.discountValue);
        if (b.discountType  !== undefined) updates.discountType  = b.discountType;
        if (b.isActive      !== undefined) updates.isActive      = Boolean(b.isActive);
        if (b.productIds    !== undefined) updates.productIds    = b.productIds;
        const bundle = await Bundle.findByIdAndUpdate(id, updates, { new: true });
        if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
        return res.json({ ok: true, bundle, message: 'Bundle update হয়েছে' });
      }

      /* DELETE */
      if (req.method === 'DELETE') {
        if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
        const { id } = req.query;
        const bundle = await Bundle.findByIdAndDelete(id);
        if (!bundle) return res.status(404).json({ ok: false, error: 'Bundle পাওয়া যায়নি' });
        return res.json({ ok: true, message: 'Bundle delete হয়েছে' });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: FLASH
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'flash') {
      const now = new Date();

      if (req.method === 'GET') {
        /* Countdown check */
        if (action === 'check') {
          const sale = await FlashSale.findOne({
            isActive: true, startAt: { $lte: now }, endAt: { $gt: now },
          }).select('title endAt bannerImg description').lean();
          if (!sale) {
            const upcoming = await FlashSale.findOne({ isActive: true, startAt: { $gt: now } })
              .sort({ startAt: 1 }).select('title startAt endAt').lean();
            return res.json({ ok: true, active: false, upcoming: upcoming || null });
          }
          return res.json({
            ok: true, active: true, title: sale.title, endAt: sale.endAt,
            bannerImg: sale.bannerImg, description: sale.description,
            secondsLeft: Math.max(0, Math.floor((sale.endAt - now) / 1000)),
          });
        }

        /* Admin: All */
        if (action === 'all') {
          if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });
          const sales = await FlashSale.find({}).sort({ startAt: -1 }).lean();
          return res.json({
            ok: true,
            sales: sales.map(s => ({
              ...s, isLive: s.isActive && s.startAt <= now && s.endAt > now,
              isUpcoming: s.startAt > now, isExpired: s.endAt <= now,
            })),
          });
        }

        /* Single flash sale */
        if (req.query.id) {
          const sale = await FlashSale.findById(req.query.id).lean();
          if (!sale) return res.status(404).json({ ok: false, error: 'Flash sale পাওয়া যায়নি' });
          const productIds = sale.products.map(p => p.productId);
          const dbProds    = await Product.find({ productId: { $in: productIds }, isActive: true })
            .select('productId name price orig img badge rating reviews stock').lean();
          const prodMap = Object.fromEntries(dbProds.map(p => [p.productId, p]));
          return res.json({
            ok: true,
            sale: {
              ...sale,
              products: sale.products.map(sp => ({
                ...sp, ...(prodMap[sp.productId] || {}),
                flashPrice: sp.salePrice,
                origPrice:  sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice,
                savings:    (sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice) - sp.salePrice,
              })),
              isLive: sale.isActive && sale.startAt <= now && sale.endAt > now,
              secondsLeft: sale.endAt > now ? Math.floor((sale.endAt - now) / 1000) : 0,
            },
          });
        }

        /* Public: Active flash sales */
        const sales    = await FlashSale.find({ isActive: true, startAt: { $lte: now }, endAt: { $gt: now } })
          .sort({ endAt: 1 }).lean();
        const enriched = await Promise.all(sales.map(async (sale) => {
          const productIds = sale.products.map(p => p.productId);
          const dbProds    = await Product.find({ productId: { $in: productIds }, isActive: true })
            .select('productId name price img badge rating stock').lean();
          const prodMap = Object.fromEntries(dbProds.map(p => [p.productId, p]));
          return {
            ...sale,
            products: sale.products.map(sp => ({
              ...sp,
              name: prodMap[sp.productId]?.name || '',
              img:  prodMap[sp.productId]?.img  || '',
              currentStock: prodMap[sp.productId]?.stock || sp.stock,
              savings: (sp.origPrice || prodMap[sp.productId]?.price || sp.salePrice) - sp.salePrice,
            })),
            secondsLeft: Math.floor((sale.endAt - now) / 1000),
            totalItems:  sale.products.length,
          };
        }));
        return res.json({ ok: true, sales: enriched, count: enriched.length });
      }

      /* Admin-only write operations */
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Admin only' });

      /* POST: Create */
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
          title: sanitize(b.title, 200), description: sanitize(b.description || '', 500),
          startAt, endAt, isActive: b.isActive !== false, products,
          extraDiscountPct: parseFloat(b.extraDiscountPct) || 0,
          bannerImg: sanitize(b.bannerImg || '', 500),
        });

        if (sale.isActive && startAt <= now && endAt > now) {
          Product.updateMany({ productId: { $in: products.map(p => p.productId) } }, { $set: { isFlash: true } }).catch(() => {});
        }
        return res.status(201).json({ ok: true, sale, message: 'Flash sale তৈরি হয়েছে!' });
      }

      /* PATCH: Update */
      if (req.method === 'PATCH') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ ok: false, error: 'Flash sale ID দিন' });
        const b = req.body || {};
        const updates = {};
        if (b.title        !== undefined) updates.title       = sanitize(b.title, 200);
        if (b.description  !== undefined) updates.description = sanitize(b.description, 500);
        if (b.startAt      !== undefined) updates.startAt     = new Date(b.startAt);
        if (b.endAt        !== undefined) updates.endAt       = new Date(b.endAt);
        if (b.isActive     !== undefined) updates.isActive    = Boolean(b.isActive);
        if (b.bannerImg    !== undefined) updates.bannerImg   = sanitize(b.bannerImg, 500);
        if (b.extraDiscountPct !== undefined) updates.extraDiscountPct = parseFloat(b.extraDiscountPct) || 0;
        if (b.products     !== undefined) {
          updates.products = b.products.slice(0, 50).map(p => ({
            productId: String(p.productId || ''), salePrice: Math.max(0, parseFloat(p.salePrice) || 0),
            origPrice: Math.max(0, parseFloat(p.origPrice) || 0),
            stock: Math.max(0, parseInt(p.stock) || 10), soldCount: parseInt(p.soldCount) || 0,
          }));
        }
        const sale = await FlashSale.findByIdAndUpdate(id, updates, { new: true });
        if (!sale) return res.status(404).json({ ok: false, error: 'Flash sale পাওয়া যায়নি' });
        return res.json({ ok: true, sale, message: 'Flash sale আপডেট হয়েছে' });
      }

      /* POST: Toggle */
      if (req.method === 'POST' && action === 'toggle') {
        const id = req.query.id || req.body?.id;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const sale = await FlashSale.findById(id);
        if (!sale) return res.status(404).json({ ok: false, error: 'পাওয়া যায়নি' });
        sale.isActive = !sale.isActive;
        await sale.save();
        const pIds = sale.products.map(p => p.productId);
        if (sale.isActive && sale.startAt <= now && sale.endAt > now) {
          Product.updateMany({ productId: { $in: pIds } }, { isFlash: true }).catch(() => {});
        } else {
          Product.updateMany({ productId: { $in: pIds } }, { isFlash: false }).catch(() => {});
        }
        return res.json({ ok: true, isActive: sale.isActive });
      }

      /* DELETE */
      if (req.method === 'DELETE') {
        const id = req.query.id;
        if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });
        const sale = await FlashSale.findByIdAndDelete(id);
        if (!sale) return res.status(404).json({ ok: false, error: 'পাওয়া যায়নি' });
        Product.updateMany({ productId: { $in: sale.products.map(p => p.productId) } }, { isFlash: false }).catch(() => {});
        return res.json({ ok: true, message: 'Flash sale delete হয়েছে' });
      }

      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    /* ══════════════════════════════════════════════════════════
       MODULE: SHURJOPAY  [NEW]
       Utility endpoints for ShurjoPay payment gateway operations.
       Main payment flow is handled in api/orders.js (payment-init / payment-verify).
       These endpoints provide token management and sandbox testing support.
    ══════════════════════════════════════════════════════════ */
    if (module_ === 'shurjopay') {
      if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'POST only' });
      }
      if (!checkRateLimit(`sp_${ip}`, 20, 60000)) {
        return res.status(429).json({ ok: false, error: 'অনেক request! একটু অপেক্ষা করুন।' });
      }

      const spBase = process.env.SHURJOPAY_SANDBOX === 'true'
        ? 'https://sandbox.shurjopayment.com'
        : 'https://engine.shurjopayment.com';

      /* Helper: get a fresh ShurjoPay token */
      async function getSpToken() {
        const r = await fetch(`${spBase}/api/get_token`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            username: process.env.SHURJOPAY_USERNAME,
            password: process.env.SHURJOPAY_PASSWORD,
          }),
        }).then(res => res.json());
        if (!r.token) throw new Error('ShurjoPay token পাওয়া যায়নি');
        return r;
      }

      /* ── action=token : fetch a fresh merchant token ── */
      if (action === 'token') {
        try {
          const t = await getSpToken();
          return res.json({ ok: true, token: t.token, storeId: t.store_id });
        } catch (err) {
          console.error('[ShurjoPay token]', err);
          return res.status(500).json({ ok: false, error: err.message });
        }
      }

      /* ── action=init : initiate a payment ── */
      if (action === 'init') {
        const {
          amount, currency, customerName, customerPhone,
          customerEmail, customerAddress, items, returnUrl, cancelUrl,
        } = req.body || {};

        if (!amount || !customerName || !customerPhone || !returnUrl || !cancelUrl) {
          return res.status(400).json({
            ok: false,
            error: 'amount, customerName, customerPhone, returnUrl, cancelUrl দিন',
          });
        }

        try {
          const tokenData = await getSpToken();
          const orderId   = 'SL-' + Date.now().toString().slice(-8);

          const payRes = await fetch(`${spBase}/api/secret-pay`, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tokenData.token}`,
            },
            body: JSON.stringify({
              prefix:           process.env.SHURJOPAY_MERCHANT_KEY_PREFIX || 'sp',
              token:            tokenData.token,
              return_url:       returnUrl,
              cancel_url:       cancelUrl,
              amount,
              currency:         currency || 'BDT',
              order_id:         orderId,
              discsount_amount: 0,
              disc_percent:     0,
              customer_name:    customerName,
              customer_addr:    customerAddress || '',
              customer_phone:   customerPhone,
              customer_email:   customerEmail   || '',
              client_ip:        ip || '127.0.0.1',
              product_details:  JSON.stringify(items || []),
              value1:           'shoplixo',
              value2: '', value3: '', value4: '',
            }),
          }).then(r => r.json());

          if (payRes.checkout_url) {
            return res.json({
              ok:          true,
              checkoutUrl: payRes.checkout_url,
              orderId,
              spOrderId:   payRes.sp_order_id,
            });
          }

          console.error('[ShurjoPay init]', payRes);
          return res.status(500).json({ ok: false, error: 'Payment initiate সমস্যা' });

        } catch (err) {
          console.error('[ShurjoPay init]', err);
          return res.status(500).json({ ok: false, error: 'Server error' });
        }
      }

      /* ── action=verify : verify a payment ── */
      if (action === 'verify') {
        const { spOrderId } = req.body || {};
        if (!spOrderId) {
          return res.status(400).json({ ok: false, error: 'spOrderId দিন' });
        }

        try {
          const tokenData = await getSpToken();
          const verifyRes = await fetch(`${spBase}/api/verification`, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tokenData.token}`,
            },
            body: JSON.stringify({ order_id: spOrderId }),
          }).then(r => r.json());

          const payment = verifyRes?.[0];
          return res.json({
            ok:      payment?.sp_code === '1000',
            status:  payment?.sp_code === '1000' ? 'paid' : 'failed',
            spCode:  payment?.sp_code,
            bankTrxId: payment?.bank_trx_id || null,
            raw:     payment || null,
          });

        } catch (err) {
          console.error('[ShurjoPay verify]', err);
          return res.status(500).json({ ok: false, error: 'Server error' });
        }
      }

      return res.status(400).json({
        ok:    false,
        error: 'Invalid ShurjoPay action. Use: token, init, verify',
      });
    }

    /* ── Unknown module ────────────────────────────────────────── */
    return res.status(400).json({
      ok: false,
      error: 'Invalid module. Use: newsletter, bundle, flash, shurjopay',
    });

  } catch (err) {
    console.error('Commerce API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
