/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/settings  [v2.0 — UPGRADED]
 *  Site Configuration — Admin DB থেকে সবকিছু control করুন
 *
 *  ── GET ──────────────────────────────────────────────────────
 *  GET  /api/settings                     → Public normalized settings (cached 60s)
 *  GET  /api/settings?action=public       → Explicit normalized public endpoint  [UPGRADE-I2]
 *  GET  /api/settings?key=xxx             → Single setting value
 *  GET  /api/settings?group=xxx           → All settings in a group (admin)
 *  GET  /api/settings?action=export       → Full JSON export for backup (admin)
 *
 *  ── POST (admin only) ────────────────────────────────────────
 *  POST /api/settings                     → Update single setting (raw DB key)
 *  POST /api/settings?action=bulk         → Bulk update (raw DB keys object)
 *  POST /api/settings?action=admin-save   → Batch save normalized camelCase keys [UPGRADE-A1/A6]
 *  POST /api/settings?action=reset        → Reset a group back to defaults
 *  POST /api/settings?action=import       → Restore from JSON backup
 *  POST /api/settings?action=init         → First-run: insert all default rows
 *
 *  ── DELETE (admin only) ──────────────────────────────────────
 *  DELETE /api/settings?key=xxx           → Remove a custom (non-default) key
 *
 *  ── Settings Groups ──────────────────────────────────────────
 *  general · shipping · payment · loyalty · display · seo
 *  social · business · features · inventory · integrations [NEW v2]
 * ══════════════════════════════════════════════════════════════
 */

const { connectDB, SiteSettings, getSetting, setSetting, getSettings } = require('./_db');
const { handleCors, isAdmin, sanitize } = require('./_helpers');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PUBLIC SETTINGS CACHE  (60 s TTL, invalidated on every write)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let _pubCache   = null;
let _pubCacheTs = 0;
const CACHE_TTL = 60 * 1000;

function invalidateCache() { _pubCache = null; _pubCacheTs = 0; }

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DEFAULT SETTINGS CATALOGUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const DEFAULT_SETTINGS = [
  // ── General ────────────────────────────────────────────────
  { key: 'site_name',        value: 'Shoplixo',                          group: 'general',  label: 'Site Name',              type: 'string'  },
  { key: 'site_tagline',     value: "Bangladesh's Premium Store",         group: 'general',  label: 'Tagline',                type: 'string'  },
  { key: 'site_logo',        value: '',                                   group: 'general',  label: 'Logo URL',               type: 'string'  },
  { key: 'site_favicon',     value: '',                                   group: 'general',  label: 'Favicon URL',            type: 'string'  },
  { key: 'site_email',       value: 'support@shoplixo.shop',              group: 'general',  label: 'Support Email',          type: 'string'  },
  { key: 'site_phone',       value: '01XXXXXXXXX',                        group: 'general',  label: 'Support Phone',          type: 'string'  },
  { key: 'site_maintenance', value: false,                                group: 'general',  label: 'Maintenance Mode',       type: 'boolean' },
  { key: 'currency',         value: 'BDT',                                group: 'general',  label: 'Currency',               type: 'string'  },

  // ── Shipping ───────────────────────────────────────────────
  { key: 'shipping_dhaka',        value: 60,   group: 'shipping', label: 'ঢাকায় Shipping (৳)',       type: 'number'  },
  { key: 'shipping_outside',      value: 120,  group: 'shipping', label: 'ঢাকার বাইরে Shipping (৳)', type: 'number'  },
  { key: 'shipping_free_above',   value: 1000, group: 'shipping', label: 'Free Shipping Minimum (৳)', type: 'number'  },
  { key: 'shipping_free_enabled', value: true, group: 'shipping', label: 'Free Shipping Enable',      type: 'boolean' },
  { key: 'shipping_express_fee',  value: 200,  group: 'shipping', label: 'Express Delivery Fee (৳)',  type: 'number'  },
  { key: 'cod_available',         value: true, group: 'shipping', label: 'Cash on Delivery',          type: 'boolean' },

  // ── Payment ────────────────────────────────────────────────
  { key: 'bkash_number',  value: '01XXXXXXXXX',                           group: 'payment', label: 'bKash Number',  type: 'string' },
  { key: 'nagad_number',  value: '01XXXXXXXXX',                           group: 'payment', label: 'Nagad Number',  type: 'string' },
  { key: 'rocket_number', value: '01XXXXXXXXX',                           group: 'payment', label: 'Rocket Number', type: 'string' },
  { key: 'upay_number',   value: '01XXXXXXXXX',                           group: 'payment', label: 'Upay Number',   type: 'string' },
  { key: 'payment_note',  value: 'Payment করার পর Transaction ID দিন।', group: 'payment', label: 'Payment Note',  type: 'text'   },

  // ── Loyalty ────────────────────────────────────────────────
  { key: 'points_per_taka',   value: 0.1,  group: 'loyalty', label: 'Points per ৳1 spent',       type: 'number'  },
  { key: 'taka_per_point',    value: 0.5,  group: 'loyalty', label: '৳ value per 1 point',       type: 'number'  },
  { key: 'min_redeem_points', value: 100,  group: 'loyalty', label: 'Minimum Redeem Points',     type: 'number'  },
  { key: 'max_redeem_pct',    value: 20,   group: 'loyalty', label: 'Max Redeem % of order',     type: 'number'  },
  { key: 'referral_points',   value: 200,  group: 'loyalty', label: 'Referral Reward Points',    type: 'number'  },
  { key: 'referral_bonus',    value: 100,  group: 'loyalty', label: 'Referred User Bonus',       type: 'number'  },
  { key: 'register_points',   value: 50,   group: 'loyalty', label: 'Registration Bonus Points', type: 'number'  },
  { key: 'loyalty_enabled',   value: true, group: 'loyalty', label: 'Loyalty Program Enable',    type: 'boolean' },

  // ── Display / Banners ──────────────────────────────────────
  { key: 'hero_banner_1',      value: '',    group: 'display', label: 'Hero Banner 1 (Desktop)', type: 'string'  },
  { key: 'hero_banner_2',      value: '',    group: 'display', label: 'Hero Banner 2 (Desktop)', type: 'string'  },
  { key: 'hero_mobile_banner', value: '',    group: 'display', label: 'Hero Banner (Mobile)',    type: 'string'  },
  { key: 'announcement_bar',   value: '🎉 বিশেষ অফার! ৳999 এর উপর order এ Free Delivery!', group: 'display', label: 'Top Announcement Bar', type: 'string' },
  { key: 'announcement_on',    value: true,  group: 'display', label: 'Show Announcement Bar',  type: 'boolean' },
  { key: 'popup_image',        value: '',    group: 'display', label: 'Popup Image URL',        type: 'string'  },
  { key: 'popup_enabled',      value: false, group: 'display', label: 'Enable Popup',           type: 'boolean' },
  { key: 'popup_delay',        value: 5,     group: 'display', label: 'Popup Delay (seconds)',  type: 'number'  },

  // ── SEO ────────────────────────────────────────────────────
  { key: 'meta_title',       value: 'Shoplixo — Bangladesh Online Shopping',                    group: 'seo', label: 'Meta Title',       type: 'string' },
  { key: 'meta_description', value: 'Bangladesh-এর সেরা online shopping store। সেরা দামে সেরা পণ্য।', group: 'seo', label: 'Meta Description', type: 'text'   },
  { key: 'meta_keywords',    value: 'online shopping bangladesh, shoplixo',                     group: 'seo', label: 'Meta Keywords',    type: 'string' },
  { key: 'og_image',         value: '',                                                         group: 'seo', label: 'OG Image URL',     type: 'string' },

  // ── Social ─────────────────────────────────────────────────
  { key: 'facebook_url',  value: 'https://facebook.com/shoplixo', group: 'social', label: 'Facebook Page',     type: 'string' },
  { key: 'instagram_url', value: '',                               group: 'social', label: 'Instagram Profile', type: 'string' },
  { key: 'youtube_url',   value: '',                               group: 'social', label: 'YouTube Channel',   type: 'string' },
  { key: 'whatsapp_no',   value: '01XXXXXXXXX',                   group: 'social', label: 'WhatsApp Number',   type: 'string' },
  { key: 'tiktok_url',    value: '',                               group: 'social', label: 'TikTok Profile',    type: 'string' },

  // ── Business ───────────────────────────────────────────────
  { key: 'business_name',      value: 'Shoplixo Ltd.',     group: 'business', label: 'Business Name',        type: 'string' },
  { key: 'business_address',   value: 'Dhaka, Bangladesh', group: 'business', label: 'Business Address',     type: 'string' },
  { key: 'trade_license',      value: '',                   group: 'business', label: 'Trade License No',     type: 'string' },
  { key: 'tin_no',             value: '',                   group: 'business', label: 'TIN Number',           type: 'string' },
  { key: 'return_policy_days', value: 7,                    group: 'business', label: 'Return Policy (days)', type: 'number' },

  // ── Features Toggle ────────────────────────────────────────
  { key: 'feature_reviews',    value: true,  group: 'features', label: 'Product Reviews',    type: 'boolean' },
  { key: 'feature_wishlist',   value: true,  group: 'features', label: 'Wishlist',            type: 'boolean' },
  { key: 'feature_compare',    value: true,  group: 'features', label: 'Product Compare',    type: 'boolean' },
  { key: 'feature_flash',      value: true,  group: 'features', label: 'Flash Sale',          type: 'boolean' },
  { key: 'feature_bundle',     value: true,  group: 'features', label: 'Bundle Offers',       type: 'boolean' },
  { key: 'feature_affiliate',  value: false, group: 'features', label: 'Affiliate Program',   type: 'boolean' },
  { key: 'feature_newsletter', value: true,  group: 'features', label: 'Newsletter',          type: 'boolean' },
  { key: 'feature_chat',       value: false, group: 'features', label: 'Live Chat Widget',    type: 'boolean' },
  { key: 'feature_tracking',   value: true,  group: 'features', label: 'Order Tracking',      type: 'boolean' },
  { key: 'feature_return',     value: true,  group: 'features', label: 'Return Request',      type: 'boolean' },

  // ── Inventory ──────────────────────────────────────────────
  { key: 'low_stock_alert',  value: 5,     group: 'inventory', label: 'Low Stock Alert Qty', type: 'number'  },
  { key: 'out_stock_hide',   value: false, group: 'inventory', label: 'Hide Out of Stock',   type: 'boolean' },
  { key: 'dropship_enabled', value: true,  group: 'inventory', label: 'Dropshipping Mode',   type: 'boolean' },

  // ── Integrations [NEW v2.0] ────────────────────────────────
  { key: 'cloudinary_cloud_name',    value: '',                  group: 'integrations', label: 'Cloudinary Cloud Name',      type: 'string' },
  { key: 'cloudinary_upload_preset', value: 'shoplixo_unsigned', group: 'integrations', label: 'Cloudinary Upload Preset',   type: 'string' },
  { key: 'fb_app_id',                value: '',                  group: 'integrations', label: 'Facebook App ID',            type: 'string' },
  { key: 'google_client_id',         value: '',                  group: 'integrations', label: 'Google Client ID',           type: 'string' },
  { key: 'google_analytics_id',      value: '',                  group: 'integrations', label: 'Google Analytics ID (GA4)',  type: 'string' },
  { key: 'facebook_pixel_id',        value: '',                  group: 'integrations', label: 'Facebook Pixel ID',          type: 'string' },
  { key: 'smtp_host',                value: '',                  group: 'integrations', label: 'SMTP Host',                  type: 'string' },
  { key: 'smtp_port',                value: 587,                 group: 'integrations', label: 'SMTP Port',                  type: 'number' },
  { key: 'smtp_user',                value: '',                  group: 'integrations', label: 'SMTP Username',              type: 'string' },
  { key: 'smtp_pass',                value: '',                  group: 'integrations', label: 'SMTP Password (encrypted)',  type: 'string' },
];

/* ── Keys safe for unauthenticated frontend access ────────── */
const PUBLIC_KEYS = [
  'site_name','site_tagline','site_logo','site_favicon','site_email','site_phone',
  'site_maintenance',                                                           // ← FIX: maintenanceMode was undefined in public response
  'currency','announcement_bar','announcement_on','popup_image','popup_enabled','popup_delay',
  'hero_banner_1','hero_banner_2','hero_mobile_banner',
  'meta_title','meta_description','meta_keywords','og_image',
  'facebook_url','instagram_url','youtube_url','whatsapp_no','tiktok_url',
  'shipping_dhaka','shipping_outside','shipping_free_above','shipping_free_enabled',
  'shipping_express_fee','cod_available',
  'bkash_number','nagad_number','rocket_number','upay_number','payment_note',
  'feature_reviews','feature_wishlist','feature_compare','feature_flash',
  'feature_bundle','feature_newsletter','feature_chat','feature_tracking','feature_return',
  'loyalty_enabled','return_policy_days','low_stock_alert','out_stock_hide',
  // Integrations — public app config (SEC-3: FB App ID via API)
  'cloudinary_cloud_name','cloudinary_upload_preset',
  'fb_app_id','google_client_id','google_analytics_id','facebook_pixel_id',
];

/* ── Keys NEVER returned to non-admin requests ─────────────── */
const PRIVATE_KEYS = new Set(['smtp_host','smtp_port','smtp_user','smtp_pass']);

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   NORMALIZE: snake_case DB keys → camelCase for frontend
   Used by action=public endpoint (UPGRADE-I2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function normalizeSettings(raw) {
  return {
    // General
    siteName:               raw.site_name,
    siteTagline:            raw.site_tagline,
    siteLogo:               raw.site_logo,
    siteFavicon:            raw.site_favicon,
    siteEmail:              raw.site_email,
    sitePhone:              raw.site_phone,
    maintenanceMode:        raw.site_maintenance,
    currency:               raw.currency,
    // Shipping — frontend expects shippingCost (UPGRADE-I2)
    shippingCost:           raw.shipping_dhaka,
    shippingOutside:        raw.shipping_outside,
    freeShippingMin:        raw.shipping_free_above,
    freeShippingEnabled:    raw.shipping_free_enabled,
    shippingExpressFee:     raw.shipping_express_fee,
    codAvailable:           raw.cod_available,
    // Payment — frontend expects bkashNumber etc. (UPGRADE-I2)
    bkashNumber:            raw.bkash_number,
    nagadNumber:            raw.nagad_number,
    rocketNumber:           raw.rocket_number,
    upayNumber:             raw.upay_number,
    paymentNote:            raw.payment_note,
    // Display
    announcementBar:        raw.announcement_bar,
    announcementOn:         raw.announcement_on,
    popupImage:             raw.popup_image,
    popupEnabled:           raw.popup_enabled,
    popupDelay:             raw.popup_delay,
    heroBanner1:            raw.hero_banner_1,
    heroBanner2:            raw.hero_banner_2,
    heroMobileBanner:       raw.hero_mobile_banner,
    // SEO
    metaTitle:              raw.meta_title,
    metaDescription:        raw.meta_description,
    metaKeywords:           raw.meta_keywords,
    ogImage:                raw.og_image,
    // Social — frontend expects whatsappNumber
    facebookUrl:            raw.facebook_url,
    instagramUrl:           raw.instagram_url,
    youtubeUrl:             raw.youtube_url,
    whatsappNumber:         raw.whatsapp_no,
    tiktokUrl:              raw.tiktok_url,
    // Loyalty (UPGRADE-A6)
    loyaltyEnabled:         raw.loyalty_enabled,
    pointsPerTaka:          raw.points_per_taka,
    takaPerPoint:           raw.taka_per_point,
    minRedeemPoints:        raw.min_redeem_points,
    maxRedeemPct:           raw.max_redeem_pct,
    referralPoints:         raw.referral_points,
    referralBonus:          raw.referral_bonus,
    registerPoints:         raw.register_points,
    // Features
    featureReviews:         raw.feature_reviews,
    featureWishlist:        raw.feature_wishlist,
    featureCompare:         raw.feature_compare,
    featureFlash:           raw.feature_flash,
    featureBundle:          raw.feature_bundle,
    featureAffiliate:       raw.feature_affiliate,
    featureNewsletter:      raw.feature_newsletter,
    featureChat:            raw.feature_chat,
    featureTracking:        raw.feature_tracking,
    featureReturn:          raw.feature_return,
    // Business
    returnPolicyDays:       raw.return_policy_days,
    // Inventory
    lowStockAlert:          raw.low_stock_alert,
    outStockHide:           raw.out_stock_hide,
    dropshipEnabled:        raw.dropship_enabled,
    // Integrations (UPGRADE-A8, SEC-3)
    cloudinaryCloudName:    raw.cloudinary_cloud_name,
    cloudinaryUploadPreset: raw.cloudinary_upload_preset,
    fbAppId:                raw.fb_app_id,
    googleClientId:         raw.google_client_id,
    googleAnalyticsId:      raw.google_analytics_id,
    facebookPixelId:        raw.facebook_pixel_id,
  };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ADMIN-SAVE MAP: camelCase payload key → { dbKey, group }
   Accepts the normalized payload from admin panel settings forms
   (UPGRADE-A1 Site Settings UI, UPGRADE-A6 Loyalty/Referral)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const ADMIN_SAVE_MAP = {
  siteName:               { key: 'site_name',               group: 'general'      },
  siteTagline:            { key: 'site_tagline',             group: 'general'      },
  siteLogo:               { key: 'site_logo',                group: 'general'      },
  siteFavicon:            { key: 'site_favicon',             group: 'general'      },
  siteEmail:              { key: 'site_email',               group: 'general'      },
  sitePhone:              { key: 'site_phone',               group: 'general'      },
  currency:               { key: 'currency',                 group: 'general'      },
  maintenanceMode:        { key: 'site_maintenance',         group: 'general'      },
  shippingCost:           { key: 'shipping_dhaka',           group: 'shipping'     },
  shippingOutside:        { key: 'shipping_outside',         group: 'shipping'     },
  freeShippingMin:        { key: 'shipping_free_above',      group: 'shipping'     },
  freeShippingEnabled:    { key: 'shipping_free_enabled',    group: 'shipping'     },
  shippingExpressFee:     { key: 'shipping_express_fee',     group: 'shipping'     },
  codAvailable:           { key: 'cod_available',            group: 'shipping'     },
  bkashNumber:            { key: 'bkash_number',             group: 'payment'      },
  nagadNumber:            { key: 'nagad_number',             group: 'payment'      },
  rocketNumber:           { key: 'rocket_number',            group: 'payment'      },
  upayNumber:             { key: 'upay_number',              group: 'payment'      },
  paymentNote:            { key: 'payment_note',             group: 'payment'      },
  whatsappNumber:         { key: 'whatsapp_no',              group: 'social'       },
  facebookUrl:            { key: 'facebook_url',             group: 'social'       },
  instagramUrl:           { key: 'instagram_url',            group: 'social'       },
  youtubeUrl:             { key: 'youtube_url',              group: 'social'       },
  tiktokUrl:              { key: 'tiktok_url',               group: 'social'       },
  announcementBar:        { key: 'announcement_bar',         group: 'display'      },
  announcementOn:         { key: 'announcement_on',          group: 'display'      },
  popupImage:             { key: 'popup_image',              group: 'display'      },
  popupEnabled:           { key: 'popup_enabled',            group: 'display'      },
  popupDelay:             { key: 'popup_delay',              group: 'display'      },
  heroBanner1:            { key: 'hero_banner_1',            group: 'display'      },
  heroBanner2:            { key: 'hero_banner_2',            group: 'display'      },
  heroMobileBanner:       { key: 'hero_mobile_banner',       group: 'display'      },
  metaTitle:              { key: 'meta_title',               group: 'seo'          },
  metaDescription:        { key: 'meta_description',         group: 'seo'          },
  metaKeywords:           { key: 'meta_keywords',            group: 'seo'          },
  ogImage:                { key: 'og_image',                 group: 'seo'          },
  loyaltyEnabled:         { key: 'loyalty_enabled',          group: 'loyalty'      },
  pointsPerTaka:          { key: 'points_per_taka',          group: 'loyalty'      },
  takaPerPoint:           { key: 'taka_per_point',           group: 'loyalty'      },
  minRedeemPoints:        { key: 'min_redeem_points',        group: 'loyalty'      },
  maxRedeemPct:           { key: 'max_redeem_pct',           group: 'loyalty'      },
  referralPoints:         { key: 'referral_points',          group: 'loyalty'      },
  referralBonus:          { key: 'referral_bonus',           group: 'loyalty'      },
  registerPoints:         { key: 'register_points',          group: 'loyalty'      },
  cloudinaryCloudName:    { key: 'cloudinary_cloud_name',    group: 'integrations' },
  cloudinaryUploadPreset: { key: 'cloudinary_upload_preset', group: 'integrations' },
  fbAppId:                { key: 'fb_app_id',                group: 'integrations' },
  googleClientId:         { key: 'google_client_id',         group: 'integrations' },
  googleAnalyticsId:      { key: 'google_analytics_id',      group: 'integrations' },
  facebookPixelId:        { key: 'facebook_pixel_id',        group: 'integrations' },
  smtpHost:               { key: 'smtp_host',                group: 'integrations' },
  smtpPort:               { key: 'smtp_port',                group: 'integrations' },
  smtpUser:               { key: 'smtp_user',                group: 'integrations' },
  smtpPass:               { key: 'smtp_pass',                group: 'integrations' },
};

/* ── Helper: build raw key→value map for public keys ───────── */
async function fetchPublicRaw() {
  const docs = await SiteSettings.find({ key: { $in: PUBLIC_KEYS } }).lean();
  const raw  = {};
  for (const def of DEFAULT_SETTINGS) {
    if (PUBLIC_KEYS.includes(def.key)) raw[def.key] = def.value;
  }
  for (const doc of docs) raw[doc.key] = doc.value;
  return raw;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  try {
    await connectDB();
    const action = req.query?.action || '';
    const admin  = isAdmin(req);

    /* ══════════════════════════════════════════════════════
       GET
    ══════════════════════════════════════════════════════ */
    if (req.method === 'GET') {
      const { key, group } = req.query;

      /* ── Single key ──────────────────────────────────── */
      if (key) {
        if (!admin) {
          if (!PUBLIC_KEYS.includes(key) || PRIVATE_KEYS.has(key)) {
            return res.status(403).json({ ok: false, error: 'Access denied' });
          }
        }
        const value = await getSetting(key);
        return res.json({ ok: true, key, value });
      }

      /* ── Group (admin only) ─────────────────────────── */
      if (group) {
        if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });
        const settings = await getSettings(group);
        const defs     = DEFAULT_SETTINGS.filter(d => d.group === group);
        return res.json({ ok: true, settings, defaults: defs });
      }

      /* ── Export all settings as JSON backup (admin) ──── */
      if (action === 'export') {
        if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });
        const docs = await SiteSettings.find({}).lean();
        const out  = {};
        for (const def of DEFAULT_SETTINGS) out[def.key] = def.value;
        for (const doc of docs) out[doc.key] = doc.value;
        res.setHeader('Content-Disposition', 'attachment; filename="shoplixo-settings-backup.json"');
        return res.json({
          ok: true,
          exportedAt: new Date().toISOString(),
          version:    '2.0',
          totalKeys:  Object.keys(out).length,
          settings:   out,
        });
      }

      /* ── Public settings — normalized camelCase (cached) ──
         action=public explicitly (UPGRADE-I2) OR non-admin default
         Returns data.settings.shippingCost, .bkashNumber, etc.   */
      if (!admin || action === 'public') {
        const now = Date.now();
        if (_pubCache && now - _pubCacheTs < CACHE_TTL) {
          res.setHeader('Cache-Control', 'public, max-age=60');
          return res.json({ ok: true, settings: _pubCache, cached: true });
        }
        const raw        = await fetchPublicRaw();
        const normalized = normalizeSettings(raw);
        _pubCache   = normalized;
        _pubCacheTs = now;
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.json({ ok: true, settings: normalized });
      }

      /* ── All settings — full admin view (raw DB keys) ─── */
      const docs   = await SiteSettings.find({}).lean();
      const result = {};
      for (const def of DEFAULT_SETTINGS) result[def.key] = { ...def };
      for (const doc of docs) {
        if (result[doc.key]) result[doc.key].value = doc.value;
        else result[doc.key] = { key: doc.key, value: doc.value, group: doc.group || 'general' };
      }
      return res.json({
        ok:       true,
        settings: result,
        groups:   [...new Set(DEFAULT_SETTINGS.map(d => d.group))],
        total:    Object.keys(result).length,
      });
    }

    /* ══════════════════════════════════════════════════════
       POST / DELETE — admin only from here
    ══════════════════════════════════════════════════════ */
    if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });

    /* ── Single key update ───────────────────────────────── */
    if (req.method === 'POST' && !action) {
      const { key, value, group, label, type } = req.body || {};
      if (!key) return res.status(400).json({ ok: false, error: 'key দিন' });

      const setting = await setSetting(key, value, {
        group: group || 'general',
        label: label || key,
        type:  type  || 'string',
      });
      invalidateCache();
      return res.json({ ok: true, setting, message: `✅ "${key}" updated!` });
    }

    /* ── Bulk update (raw DB keys) ───────────────────────── */
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
      invalidateCache();
      return res.json({ ok: true, updated: results, message: `✅ ${results.length}টি setting update হয়েছে!` });
    }

    /* ── Admin panel batch save — camelCase keys (UPGRADE-A1 & A6) ─
       Accepts: { siteName, shippingCost, bkashNumber, loyaltyEnabled, ... }
       Maps to DB snake_case keys automatically                           */
    if (req.method === 'POST' && action === 'admin-save') {
      const body    = req.body || {};
      const saved   = [];
      const skipped = [];

      for (const [camelKey, val] of Object.entries(body)) {
        const map = ADMIN_SAVE_MAP[camelKey];
        if (!map) { skipped.push(camelKey); continue; }
        const def = DEFAULT_SETTINGS.find(d => d.key === map.key);
        await setSetting(map.key, val, def || { group: map.group, label: camelKey, type: 'string' });
        saved.push(map.key);
      }
      invalidateCache();
      return res.json({
        ok:      true,
        saved,
        skipped,
        message: `✅ ${saved.length}টি setting save হয়েছে!${skipped.length ? ` (${skipped.length}টি unrecognized key skip করা হয়েছে)` : ''}`,
      });
    }

    /* ── Initialize defaults (first-run) ─────────────────── */
    if (req.method === 'POST' && action === 'init') {
      const existing = await SiteSettings.countDocuments();
      if (existing > 0) {
        return res.json({ ok: true, message: `Settings already initialized (${existing} entries)` });
      }
      await SiteSettings.insertMany(DEFAULT_SETTINGS.map(d => ({ ...d })));
      return res.json({ ok: true, message: `✅ ${DEFAULT_SETTINGS.length}টি default setting initialized!` });
    }

    /* ── Reset a group to defaults ───────────────────────── */
    if (req.method === 'POST' && action === 'reset') {
      const { group } = req.body || {};
      if (!group) return res.status(400).json({ ok: false, error: 'group দিন' });

      const groupDefs = DEFAULT_SETTINGS.filter(d => d.group === group);
      if (!groupDefs.length) {
        return res.status(404).json({ ok: false, error: `"${group}" group পাওয়া যায়নি` });
      }
      for (const def of groupDefs) await setSetting(def.key, def.value, def);
      invalidateCache();
      return res.json({ ok: true, message: `✅ "${group}" group reset হয়েছে! (${groupDefs.length}টি setting)` });
    }

    /* ── Import from JSON backup ─────────────────────────── */
    if (req.method === 'POST' && action === 'import') {
      const { settings: importData } = req.body || {};
      if (!importData || typeof importData !== 'object') {
        return res.status(400).json({ ok: false, error: 'settings object দিন' });
      }
      const updated = [];
      const failed  = [];
      for (const [key, value] of Object.entries(importData)) {
        try {
          const def = DEFAULT_SETTINGS.find(d => d.key === key);
          await setSetting(key, value, def || { group: 'general', label: key, type: 'string' });
          updated.push(key);
        } catch (e) {
          failed.push(key);
        }
      }
      invalidateCache();
      return res.json({
        ok:      true,
        updated,
        failed,
        message: `✅ ${updated.length}টি import হয়েছে।${failed.length ? ` ❌ ${failed.length}টি failed।` : ''}`,
      });
    }

    /* ── DELETE: remove a custom (non-default) key ───────── */
    if (req.method === 'DELETE') {
      const { key } = req.query;
      if (!key) return res.status(400).json({ ok: false, error: 'key দিন' });

      const isDefault = DEFAULT_SETTINGS.some(d => d.key === key);
      if (isDefault) {
        return res.status(400).json({ ok: false, error: 'Default setting delete করা যাবে না। Reset করুন।' });
      }
      await SiteSettings.deleteOne({ key });
      invalidateCache();
      return res.json({ ok: true, message: `"${key}" deleted` });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('[Settings API] Error:', err);
    return res.status(500).json({
      ok:      false,
      error:   'Server error',
      ...(process.env.NODE_ENV === 'development' ? { details: err.message } : {}),
    });
  }
};
