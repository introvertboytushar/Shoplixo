/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/settings
 *  Site Configuration — Admin DB থেকে সবকিছু control করুন
 *
 *  GET  /api/settings              → Public settings (frontend use)
 *  GET  /api/settings?group=xxx    → Group settings
 *  GET  /api/settings?key=xxx      → Single key
 *  POST /api/settings (admin)      → Set/Update setting
 *  POST /api/settings?action=bulk  → Bulk update
 *  POST /api/settings?action=reset → Reset to defaults
 *
 *  Settings Groups:
 *  - general    → Site name, logo, favicon, tagline
 *  - shipping   → Delivery charges, free shipping threshold
 *  - payment    → bKash/Nagad numbers, payment instructions
 *  - loyalty    → Points rates, tier thresholds
 *  - display    → Banners, announcements, popup
 *  - seo        → Meta title, description, keywords
 *  - social     → Facebook, Instagram, WhatsApp links
 *  - business   → Address, phone, email, trade license
 *  - features   → Toggle features on/off
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, SiteSettings, getSetting, setSetting, getSettings } = require('../_db');
const { handleCors, isAdmin, sanitize } = require('../_helpers');

/* Default settings — first-time setup */
const DEFAULT_SETTINGS = [
  // General
  { key: 'site_name',        value: 'Shoplixo',                  group: 'general',  label: 'Site Name',          type: 'string' },
  { key: 'site_tagline',     value: "Bangladesh's Premium Store", group: 'general',  label: 'Tagline',            type: 'string' },
  { key: 'site_logo',        value: '',                           group: 'general',  label: 'Logo URL',           type: 'string' },
  { key: 'site_favicon',     value: '',                           group: 'general',  label: 'Favicon URL',        type: 'string' },
  { key: 'site_email',       value: 'support@shoplixo.shop',     group: 'general',  label: 'Support Email',      type: 'string' },
  { key: 'site_phone',       value: '01XXXXXXXXX',               group: 'general',  label: 'Support Phone',      type: 'string' },
  { key: 'site_maintenance', value: false,                        group: 'general',  label: 'Maintenance Mode',   type: 'boolean' },
  { key: 'currency',         value: 'BDT',                       group: 'general',  label: 'Currency',           type: 'string' },

  // Shipping
  { key: 'shipping_dhaka',        value: 60,   group: 'shipping', label: 'ঢাকায় Shipping (৳)',       type: 'number' },
  { key: 'shipping_outside',      value: 120,  group: 'shipping', label: 'ঢাকার বাইরে Shipping (৳)', type: 'number' },
  { key: 'shipping_free_above',   value: 1000, group: 'shipping', label: 'Free Shipping Minimum (৳)', type: 'number' },
  { key: 'shipping_free_enabled', value: true, group: 'shipping', label: 'Free Shipping Enable',      type: 'boolean' },
  { key: 'shipping_express_fee',  value: 200,  group: 'shipping', label: 'Express Delivery Fee (৳)',  type: 'number' },
  { key: 'cod_available',         value: true, group: 'shipping', label: 'Cash on Delivery',          type: 'boolean' },

  // Payment
  { key: 'bkash_number',     value: '01XXXXXXXXX',               group: 'payment',  label: 'bKash Number',       type: 'string' },
  { key: 'nagad_number',     value: '01XXXXXXXXX',               group: 'payment',  label: 'Nagad Number',       type: 'string' },
  { key: 'rocket_number',    value: '01XXXXXXXXX',               group: 'payment',  label: 'Rocket Number',      type: 'string' },
  { key: 'upay_number',      value: '01XXXXXXXXX',               group: 'payment',  label: 'Upay Number',        type: 'string' },
  { key: 'payment_note',     value: 'Payment করার পর Transaction ID দিন।', group: 'payment', label: 'Payment Note', type: 'text' },

  // Loyalty
  { key: 'points_per_taka',     value: 0.1,  group: 'loyalty', label: 'Points per ৳1 spent',        type: 'number' },
  { key: 'taka_per_point',      value: 0.5,  group: 'loyalty', label: '৳ value per 1 point',        type: 'number' },
  { key: 'min_redeem_points',   value: 100,  group: 'loyalty', label: 'Minimum Redeem Points',      type: 'number' },
  { key: 'max_redeem_pct',      value: 20,   group: 'loyalty', label: 'Max Redeem % of order',      type: 'number' },
  { key: 'referral_points',     value: 200,  group: 'loyalty', label: 'Referral Reward Points',     type: 'number' },
  { key: 'referral_bonus',      value: 100,  group: 'loyalty', label: 'Referred User Bonus',        type: 'number' },
  { key: 'register_points',     value: 50,   group: 'loyalty', label: 'Registration Bonus Points',  type: 'number' },
  { key: 'loyalty_enabled',     value: true, group: 'loyalty', label: 'Loyalty Program Enable',     type: 'boolean' },

  // Display / Banners
  { key: 'hero_banner_1',     value: '',    group: 'display', label: 'Hero Banner 1 (Desktop)',   type: 'string' },
  { key: 'hero_banner_2',     value: '',    group: 'display', label: 'Hero Banner 2 (Desktop)',   type: 'string' },
  { key: 'hero_mobile_banner',value: '',    group: 'display', label: 'Hero Banner (Mobile)',      type: 'string' },
  { key: 'announcement_bar',  value: '🎉 বিশেষ অফার! ৳999 এর উপর order এ Free Delivery!', group: 'display', label: 'Top Announcement Bar', type: 'string' },
  { key: 'announcement_on',   value: true,  group: 'display', label: 'Show Announcement Bar',    type: 'boolean' },
  { key: 'popup_image',       value: '',    group: 'display', label: 'Popup Image URL',          type: 'string' },
  { key: 'popup_enabled',     value: false, group: 'display', label: 'Enable Popup',             type: 'boolean' },
  { key: 'popup_delay',       value: 5,     group: 'display', label: 'Popup Delay (seconds)',    type: 'number' },

  // SEO
  { key: 'meta_title',       value: 'Shoplixo — Bangladesh Online Shopping',  group: 'seo', label: 'Meta Title',       type: 'string' },
  { key: 'meta_description', value: 'Bangladesh-এর সেরা online shopping store। সেরা দামে সেরা পণ্য।', group: 'seo', label: 'Meta Description', type: 'text' },
  { key: 'meta_keywords',    value: 'online shopping bangladesh, shoplixo',    group: 'seo', label: 'Meta Keywords',    type: 'string' },
  { key: 'og_image',         value: '',                                          group: 'seo', label: 'OG Image URL',    type: 'string' },

  // Social
  { key: 'facebook_url',   value: 'https://facebook.com/shoplixo',  group: 'social', label: 'Facebook Page',      type: 'string' },
  { key: 'instagram_url',  value: '',                                group: 'social', label: 'Instagram Profile',  type: 'string' },
  { key: 'youtube_url',    value: '',                                group: 'social', label: 'YouTube Channel',    type: 'string' },
  { key: 'whatsapp_no',    value: '01XXXXXXXXX',                    group: 'social', label: 'WhatsApp Number',    type: 'string' },
  { key: 'tiktok_url',     value: '',                                group: 'social', label: 'TikTok Profile',    type: 'string' },

  // Business
  { key: 'business_name',     value: 'Shoplixo Ltd.',               group: 'business', label: 'Business Name',      type: 'string' },
  { key: 'business_address',  value: 'Dhaka, Bangladesh',           group: 'business', label: 'Business Address',   type: 'string' },
  { key: 'trade_license',     value: '',                             group: 'business', label: 'Trade License No',   type: 'string' },
  { key: 'tin_no',            value: '',                             group: 'business', label: 'TIN Number',         type: 'string' },
  { key: 'return_policy_days',value: 7,                             group: 'business', label: 'Return Policy (days)',type: 'number' },

  // Features Toggle
  { key: 'feature_reviews',   value: true,  group: 'features', label: 'Product Reviews',         type: 'boolean' },
  { key: 'feature_wishlist',  value: true,  group: 'features', label: 'Wishlist',                type: 'boolean' },
  { key: 'feature_compare',   value: true,  group: 'features', label: 'Product Compare',         type: 'boolean' },
  { key: 'feature_flash',     value: true,  group: 'features', label: 'Flash Sale',              type: 'boolean' },
  { key: 'feature_bundle',    value: true,  group: 'features', label: 'Bundle Offers',           type: 'boolean' },
  { key: 'feature_affiliate', value: false, group: 'features', label: 'Affiliate Program',       type: 'boolean' },
  { key: 'feature_newsletter',value: true,  group: 'features', label: 'Newsletter',              type: 'boolean' },
  { key: 'feature_chat',      value: false, group: 'features', label: 'Live Chat Widget',        type: 'boolean' },
  { key: 'feature_tracking',  value: true,  group: 'features', label: 'Order Tracking',          type: 'boolean' },
  { key: 'feature_return',    value: true,  group: 'features', label: 'Return Request',          type: 'boolean' },

  // Inventory
  { key: 'low_stock_alert',   value: 5,     group: 'inventory', label: 'Low Stock Alert Qty',   type: 'number' },
  { key: 'out_stock_hide',    value: false,  group: 'inventory', label: 'Hide Out of Stock',    type: 'boolean' },
  { key: 'dropship_enabled',  value: true,   group: 'inventory', label: 'Dropshipping Mode',    type: 'boolean' },
];

/* Public settings (safe to expose to frontend) */
const PUBLIC_KEYS = [
  'site_name','site_tagline','site_logo','site_favicon','site_email','site_phone',
  'currency','announcement_bar','announcement_on','popup_image','popup_enabled','popup_delay',
  'hero_banner_1','hero_banner_2','hero_mobile_banner',
  'meta_title','meta_description','meta_keywords','og_image',
  'facebook_url','instagram_url','youtube_url','whatsapp_no','tiktok_url',
  'shipping_dhaka','shipping_outside','shipping_free_above','shipping_free_enabled',
  'shipping_express_fee','cod_available',
  'bkash_number','nagad_number','rocket_number','upay_number','payment_note',
  'feature_reviews','feature_wishlist','feature_compare','feature_flash',
  'feature_bundle','feature_newsletter','feature_chat','feature_tracking','feature_return',
  'loyalty_enabled','return_policy_days',
  'low_stock_alert','out_stock_hide',
];

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  try {
    await connectDB();
    const action = req.query?.action || '';
    const admin  = isAdmin(req);

    /* ── GET Settings ──────────────────────────────────────────── */
    if (req.method === 'GET') {
      const { key, group } = req.query;

      // Single key
      if (key) {
        if (!admin && !PUBLIC_KEYS.includes(key)) {
          return res.status(403).json({ ok: false, error: 'Access denied' });
        }
        const value = await getSetting(key);
        return res.json({ ok: true, key, value });
      }

      // Group
      if (group) {
        if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });
        const settings = await getSettings(group);
        const defs     = DEFAULT_SETTINGS.filter(d => d.group === group);
        return res.json({ ok: true, settings, defaults: defs });
      }

      // All public settings (for frontend)
      if (!admin) {
        const docs = await SiteSettings.find({ key: { $in: PUBLIC_KEYS } }).lean();
        const result = {};
        // Fill defaults for missing keys
        for (const def of DEFAULT_SETTINGS) {
          if (PUBLIC_KEYS.includes(def.key)) result[def.key] = def.value;
        }
        for (const doc of docs) result[doc.key] = doc.value;
        return res.json({ ok: true, settings: result });
      }

      // All settings (admin)
      const docs   = await SiteSettings.find({}).lean();
      const result = {};
      for (const def of DEFAULT_SETTINGS) result[def.key] = { ...def };
      for (const doc of docs) {
        if (result[doc.key]) result[doc.key].value = doc.value;
        else result[doc.key] = { key: doc.key, value: doc.value, group: doc.group || 'general' };
      }
      return res.json({
        ok: true,
        settings: result,
        groups: [...new Set(DEFAULT_SETTINGS.map(d => d.group))],
      });
    }

    /* ── POST: Update Setting (admin) ──────────────────────────── */
    if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });

    if (req.method === 'POST' && !action) {
      const { key, value, group, label, type } = req.body || {};
      if (!key) return res.status(400).json({ ok: false, error: 'key দিন' });

      const setting = await setSetting(key, value, {
        group: group || 'general',
        label: label || key,
        type:  type  || 'string',
      });

      return res.json({ ok: true, setting, message: `✅ "${key}" updated!` });
    }

    /* ── POST: Bulk Update ─────────────────────────────────────── */
    if (req.method === 'POST' && action === 'bulk') {
      const { settings } = req.body || {};
      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ ok: false, error: 'settings object দিন' });
      }

      const results = [];
      for (const [key, value] of Object.entries(settings)) {
        const def = DEFAULT_SETTINGS.find(d => d.key === key);
        await setSetting(key, value, def || { group: 'general' });
        results.push(key);
      }

      return res.json({ ok: true, updated: results, message: `✅ ${results.length}টি setting update হয়েছে!` });
    }

    /* ── POST: Initialize Defaults ─────────────────────────────── */
    if (req.method === 'POST' && action === 'init') {
      const existing = await SiteSettings.countDocuments();
      if (existing > 0) {
        return res.json({ ok: true, message: `Settings already initialized (${existing} entries)` });
      }

      await SiteSettings.insertMany(DEFAULT_SETTINGS.map(d => ({ ...d })));
      return res.json({ ok: true, message: `✅ ${DEFAULT_SETTINGS.length}টি default setting initialized!` });
    }

    /* ── POST: Reset Group to Defaults ─────────────────────────── */
    if (req.method === 'POST' && action === 'reset') {
      const { group } = req.body || {};
      if (!group) return res.status(400).json({ ok: false, error: 'group দিন' });

      const groupDefaults = DEFAULT_SETTINGS.filter(d => d.group === group);
      for (const def of groupDefaults) {
        await setSetting(def.key, def.value, def);
      }

      return res.json({ ok: true, message: `✅ "${group}" group reset হয়েছে!` });
    }

    /* ── DELETE: Remove Custom Setting ─────────────────────────── */
    if (req.method === 'DELETE') {
      const { key } = req.query;
      if (!key) return res.status(400).json({ ok: false, error: 'key দিন' });

      const isDefault = DEFAULT_SETTINGS.some(d => d.key === key);
      if (isDefault) return res.status(400).json({ ok: false, error: 'Default setting delete করা যাবে না। Reset করুন।' });

      await SiteSettings.deleteOne({ key });
      return res.json({ ok: true, message: `"${key}" deleted` });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Settings API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
