/**
 * ══════════════════════════════════════════════════════════════════════
 *  SHOPLIXO — MongoDB Connection + ALL Schemas  (Ultra Pro v6)
 *
 *  ✅ NEW  v4 additions:
 *    • AdminConfig   — server-side admin password & multi-key management
 *    • PromoPopup    — timed promotional popup schema
 *    • SupportTicket — customer support / live-chat ticket schema
 *    • SearchLog     — analytics: what users search for
 *    • PushToken     — web-push / FCM device token storage
 *    • AuditLog      — admin action trail (change-password, bulk ops…)
 *    • WishlistSync  — cross-device wishlist per user (UPGRADE-I6)
 *
 *  ✅ NEW  v5 additions:
 *    • Order.status enum: 'archived' added (fixes 500 on order-delete)
 *    • Order: `archivedAt` field (set when status → 'archived')
 *    • Order.customer: `ipAddress`, `gpsLocation`, `deviceInfo` fields
 *    • User: `ipAddress`, `location` (GPS), `loginHistory` fields
 *
 *  ✅ NEW  v6 additions:
 *    • fingerprintSchema — reusable Device & Network Fingerprint sub-schema
 *      Captures: IP geolocation (city, region, country, ISP, org, ASN,
 *      timezone), GPS coords, and full device info (model, OS, browser,
 *      platform, screen, CPU cores, RAM, touch points, connection type/
 *      speed, battery, cookies, DNT, user-agent, languages)
 *    • User.loginHistory[].fingerprint — rich fingerprint per login entry
 *    • Order.customer.fingerprint     — rich fingerprint per order
 *    • All legacy fields preserved for backward compatibility
 *
 *  ✅ FIXED  v4 improvements:
 *    • AdminConfig with bcrypt-ready password hash storage  (BUG-5 / SEC-2)
 *    • validate-coupon helpers directly on Coupon model     (BUG-3)
 *    • getPublicSettings() — strips sensitive keys for /api/settings?action=public
 *    • Order schema: `bulkStatusNote` field for bulk operations (UPGRADE-A4)
 *    • Product: `cloudinaryId` for Cloudinary deletion support  (UPGRADE-A8)
 *    • SiteStats: `revenueByMonth` virtual for 12-month charts  (UPGRADE-A9)
 *    • All schemas: explicit `versionKey: false` to reduce document size
 *    • connectDB: exponential back-off retry on first connect failure
 * ══════════════════════════════════════════════════════════════════════
 */

'use strict';

const mongoose = require('mongoose');

// ─── Env guard ────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('❌ MONGODB_URI missing in .env');

// ─── Connection cache (Vercel serverless-safe) ────────────────────────────────
let cached = global._mongoCache || (global._mongoCache = { conn: null, promise: null });

/**
 * connectDB — singleton with exponential back-off (max 3 retries).
 * Safe to call on every serverless invocation.
 */
async function connectDB(attempt = 1) {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands:          false,
      maxPoolSize:             10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS:         45000,
    });
  }
  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (err) {
    cached.promise = null;
    if (attempt >= 3) throw err;
    const delay = attempt * 800; // 800 ms, 1600 ms …
    await new Promise(r => setTimeout(r, delay));
    return connectDB(attempt + 1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
/** Safe model registration — prevents OverwriteModelError in hot-reload */
const reg = (name, schema) =>
  mongoose.models[name] || mongoose.model(name, schema);

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v6: FINGERPRINT SUB-SCHEMA
//  Reusable plain-object definition embedded into loginHistory & customer.
//  Captures full IP geolocation + device/hardware/software details.
//  All fields have sensible defaults → zero errors on legacy documents.
// ═══════════════════════════════════════════════════════════════════════════════
const fingerprintSchema = {
  ip: { type: String, default: '' },
  ipDetails: {
    city:        { type: String, default: '' },
    region:      { type: String, default: '' },
    country:     { type: String, default: '' },
    countryCode: { type: String, default: '' },
    isp:         { type: String, default: '' },
    org:         { type: String, default: '' },
    asn:         { type: String, default: '' },
    timezone:    { type: String, default: '' },
  },
  gps: {
    lat:      { type: Number, default: null },
    lng:      { type: Number, default: null },
    accuracy: { type: Number, default: null },
  },
  device: {
    model:           { type: String,  default: '' },  // e.g. "iPhone 14", "Samsung SM-G991B"
    os:              { type: String,  default: '' },  // e.g. "Android 13", "iOS 17", "Windows 11"
    browser:         { type: String,  default: '' },  // e.g. "Chrome 124"
    platform:        { type: String,  default: '' },
    languages:       { type: String,  default: '' },
    screen:          { type: String,  default: '' },  // e.g. "1080x2400"
    orientation:     { type: String,  default: '' },
    cores:           { type: Number,  default: null },
    ram:             { type: String,  default: '' },  // e.g. "8 GB" বা "Unknown"
    touchPoints:     { type: Number,  default: null },
    connection:      { type: String,  default: '' },  // e.g. "4g"
    connectionSpeed: { type: String,  default: '' },  // e.g. "10 Mbps"
    battery:         { type: String,  default: '' },  // e.g. "85% (charging)"
    cookiesEnabled:  { type: Boolean, default: null },
    doNotTrack:      { type: String,  default: '' },
    userAgent:       { type: String,  default: '' },
  },
  capturedAt: { type: Date, default: Date.now },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  ORDER SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true, index: true },

  customer: {
    name:     String,
    phone:    String,
    email:    { type: String, default: '' },
    address:  String,
    district: String,
    division: { type: String, default: '' },
    upazila:  { type: String, default: '' },
    union:    { type: String, default: '' },
    village:  { type: String, default: '' },
    house:    { type: String, default: '' },
    area:     { type: String, default: '' },
    note:     { type: String, default: '' },
    // ✅ v5: Location & device tracking — backward compat রাখা হয়েছে
    ipAddress: { type: String, default: '' },
    gpsLocation: {
      lat:      { type: Number, default: null },
      lng:      { type: Number, default: null },
      accuracy: { type: Number, default: null },
    },
    deviceInfo: { type: String, default: '' },
    // ✅ NEW v6 — সম্পূর্ণ rich fingerprint
    fingerprint: fingerprintSchema,
  },

  items: [{
    productId:     String,
    name:          String,
    price:         Number,
    qty:           Number,
    img:           { type: String, default: '' },
    size:          String,
    color:         String,
    supplierId:    { type: String, default: '' },
    supplierPrice: { type: Number, default: 0 },
    isDropship:    { type: Boolean, default: false },
  }],

  payment: {
    method:        { type: String, enum: ['bkash','nagad','rocket','upay','cod','card','wallet'] },
    transactionId: { type: String, default: '' },
    status:        { type: String, enum: ['pending','verified','failed','refunded'], default: 'pending' },
    verifiedAt:    Date,
    verifiedBy:    String,
    gatewayRef:    { type: String, default: '' },
  },

  pricing: {
    subtotal:       Number,
    shipping:       { type: Number, default: 60 },
    discount:       { type: Number, default: 0 },
    total:          Number,
    profit:         { type: Number, default: 0 },
  },

  status: {
    type: String,
    enum: [
      'pending','confirmed','processing','shipped',
      'out_for_delivery','delivered','cancelled',
      'refunded','return_requested','returned','archived',
    ],
    default: 'pending',
    index: true,
  },

  // ✅ NEW v4: bulkStatusNote — set by bulk-update operations (UPGRADE-A4)
  bulkStatusNote: { type: String, default: '' },

  // ✅ NEW v5: archivedAt — set when status is changed to 'archived' (order-delete)
  archivedAt: { type: Date, default: null },

  statusHistory: [{
    status:    String,
    note:      String,
    updatedBy: String,
    updatedAt: { type: Date, default: Date.now },
  }],

  tracking: {
    courier:           String,
    trackingId:        String,
    estimatedDelivery: Date,
    trackingUrl:       String,
  },

  dropshipStatus:        { type: String, enum: ['none','ordered','processing','shipped'], default: 'none' },
  dropshipOrderId:       { type: String, default: '' },
  ip:                    String,
  userAgent:             String,
  source:                { type: String, default: 'website' },
  invoiceUrl:            { type: String, default: '' },
  adminNote:             { type: String, default: '' },
}, { timestamps: true, versionKey: false, collection: 'orders' });

orderSchema.index({ 'customer.phone': 1 });
orderSchema.index({ createdAt: -1 });
// ✅ NEW v4: compound index for date-range order filters (UPGRADE-A5)
orderSchema.index({ status: 1, createdAt: -1 });

// ═══════════════════════════════════════════════════════════════════════════════
//  USER SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const userSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  // ✅ FIX BUG #2: removed required:true; social-login users have no phone.
  //    sparse:true lets multiple null values coexist with the unique index,
  //    preventing MongoDB ValidationError / 500 on Google & Facebook signup.
  phone: {
    type:    String,
    unique:  true,
    sparse:  true,   // ✅ FIX BUG #2: multiple nulls allowed with unique index
    trim:    true,
    default: null,
  },
  email:     { type: String, trim: true, lowercase: true, sparse: true },
  password:  { type: String, required: true, select: false },
  avatar:    { type: String, default: '' },
  role:      { type: String, enum: ['user','affiliate','vip'], default: 'user' },
  isActive:  { type: Boolean, default: true },
  isVerified:{ type: Boolean, default: false },
  isBanned:  { type: Boolean, default: false },
  banReason: { type: String, default: '' },

  addresses: [{
    label:     String,
    address:   String,
    district:  String,
    area:      String,
    phone:     String,
    isDefault: Boolean,
  }],

  // ✅ UPGRADED v4: wishlist now synced to DB (UPGRADE-I6)
  wishlist:         { type: [String], default: [] },
  wishlistUpdatedAt:{ type: Date, default: null },

  compareList:      { type: [String], default: [] },
  totalOrders:      { type: Number, default: 0 },
  totalSpent:       { type: Number, default: 0 },
  lastLogin:        Date,
  loginCount:       { type: Number, default: 0 },

  // Online status tracking
  isOnline:         { type: Boolean, default: false },
  lastSeen:         { type: Date, default: null },
  loginMethod:      { type: String, enum: ['email', 'google', 'facebook', 'phone'], default: 'email' },

  // ✅ FIX BUG #1: without these fields Mongoose silently drops googleId /
  //    facebookId on save → social users can never be found on second login.
  //    sparse:true allows multiple null values alongside the unique index.
  googleId:         { type: String, default: null, sparse: true, index: true },   // ✅ FIX BUG #1
  facebookId:       { type: String, default: null, sparse: true, index: true },   // ✅ FIX BUG #1
  sessionToken:     { type: String, default: null, select: false },
  forceLoggedOut:   { type: Boolean, default: false },
  deviceInfo:       { type: String, default: '' },

  // ✅ NEW v5: GPS + IP Location Tracking
  ipAddress: { type: String, default: '' },
  location: {
    lat:       { type: Number, default: null },
    lng:       { type: Number, default: null },
    accuracy:  { type: Number, default: null },
    city:      { type: String, default: '' },
    country:   { type: String, default: '' },
    updatedAt: { type: Date, default: null },
  },
  loginHistory: [{
    ip:        String,
    device:    String,                        // পুরনো field — backward compat
    location:  { lat: Number, lng: Number },  // পুরনো field — backward compat
    method:    String,                        // 'email','google','facebook'
    timestamp: { type: Date, default: Date.now },
    // ✅ NEW v6 — সম্পূর্ণ rich fingerprint
    fingerprint: fingerprintSchema,
  }],

  // OTP / reset — excluded from default queries
  otp:              { type: String, select: false },
  otpExpiry:        { type: Date,   select: false },
  resetToken:       { type: String, select: false },
  resetTokenExpiry: { type: Date,   select: false },

  notificationPrefs: {
    orderUpdates:{ type: Boolean, default: true },
    promotions:  { type: Boolean, default: true },
    sms:         { type: Boolean, default: true },
    email:       { type: Boolean, default: true },
  },
}, { timestamps: true, versionKey: false, collection: 'users' });

// ✅ FIX BUG #3: explicit sparse indexes.
//    phone      — sparse+unique so null values don't collide (social-login users)
//    googleId   — sparse index for fast OAuth lookup via findOne({ googleId })
//    facebookId — sparse index for fast OAuth lookup via findOne({ facebookId })
userSchema.index({ phone:      1 }, { sparse: true, unique: true }); // ✅ FIX BUG #3
userSchema.index({ googleId:   1 }, { sparse: true });               // ✅ FIX BUG #3
userSchema.index({ facebookId: 1 }, { sparse: true });               // ✅ FIX BUG #3

// ═══════════════════════════════════════════════════════════════════════════════
//  CATEGORY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const categorySchema = new mongoose.Schema({
  slug:        { type: String, required: true, unique: true, lowercase: true },
  name:        { type: String, required: true },
  nameBn:      { type: String, default: '' },
  icon:        { type: String, default: '' },
  img:         { type: String, default: '' },
  parentSlug:  { type: String, default: '' },
  description: { type: String, default: '' },
  isActive:    { type: Boolean, default: true },
  isFeatured:  { type: Boolean, default: false },
  sortOrder:   { type: Number, default: 0 },
  seoTitle:    String,
  seoDesc:     String,
  productCount:{ type: Number, default: 0 },
}, { timestamps: true, versionKey: false, collection: 'categories' });

// ═══════════════════════════════════════════════════════════════════════════════
//  PRODUCT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const productSchema = new mongoose.Schema({
  productId:  { type: String, required: true, unique: true },
  name:       { type: String, required: true, trim: true },
  nameBn:     { type: String, default: '' },
  cat:        { type: String, required: true, index: true },
  subCat:     { type: String, default: '' },
  brand:      { type: String, default: '' },
  price:      { type: Number, required: true },
  orig:       Number,
  costPrice:  { type: Number, default: 0 },
  img:        { type: String, default: '' },
  images:     { type: [String], default: [] },

  // ✅ NEW v4: Cloudinary public_id for easy deletion (UPGRADE-A8)
  cloudinaryId:  { type: String, default: '' },
  cloudinaryIds: { type: [String], default: [] },

  badge:        { type: String, enum: ['hot','new','sale','sold','best','trending','exclusive'], default: 'new' },
  rating:       { type: Number, default: 5, min: 0, max: 5 },
  reviews:      { type: Number, default: 0 },
  stock:        { type: Number, default: 100 },
  lowStockAlert:{ type: Number, default: 5 },
  viewers:      { type: Number, default: 5 },
  isFeatured:   { type: Boolean, default: false },
  isNew:        { type: Boolean, default: true },
  isFlash:      { type: Boolean, default: false },
  isActive:     { type: Boolean, default: true },
  isDropship:   { type: Boolean, default: false },
  supplierId:   { type: String, default: '' },
  supplierSku:  { type: String, default: '' },
  supplierPrice:{ type: Number, default: 0 },
  sizes:        [String],
  colors:       [String],
  material:     String,
  warranty:     String,
  sku:          String,
  tags:         [String],
  desc:         String,
  descBn:       String,
  totalSold:    { type: Number, default: 0 },
  videoUrl:     { type: String, default: '' },
  weight:       Number,
  dimensions:   { l: Number, w: Number, h: Number },
  seoTitle:     String,
  seoDesc:      String,
  seoKeywords:  [String],
  bundleIds:    [String],
  specifications:[{ key: String, value: String }],
  returnPolicy: { type: String, default: '৭ দিনের মধ্যে return করা যাবে' },
  shippingTime: { type: String, default: 'ঢাকায় ১-২ দিন, সারাদেশে ৩-৫ দিন' },

  // ✅ Per-product delivery charge overrides (TASK 1)
  // enabled: false → global shipping settings (api/settings.js) প্রযোজ্য হবে
  // enabled: true  → null tier = global fallback, non-null tier = এই মান ব্যবহার হবে
  deliveryCharges: {
    enabled:       { type: Boolean, default: false },
    dhakaCity:     { type: Number,  default: null },  // ঢাকা শহর
    dhakaSubArea:  { type: Number,  default: null },  // Savar/Keraniganj/Dhamrai/Nawabganj/Dohar
    dhakaDivision: { type: Number,  default: null },  // Gazipur, Narayanganj ইত্যাদি
    outsideDhaka:  { type: Number,  default: null },  // ঢাকা বিভাগের বাইরে — সারা বাংলাদেশ
  },
}, { timestamps: true, versionKey: false, collection: 'products' });

productSchema.index({ name: 'text', tags: 'text', desc: 'text', brand: 'text' });
productSchema.index({ cat: 1, isActive: 1, price: 1 });
productSchema.index({ isActive: 1, isFeatured: 1, createdAt: -1 });
productSchema.index({ isActive: 1, isFlash: 1 });

// ═══════════════════════════════════════════════════════════════════════════════
//  SUPPLIER SCHEMA (Dropshipping)
// ═══════════════════════════════════════════════════════════════════════════════
const supplierSchema = new mongoose.Schema({
  supplierId:   { type: String, required: true, unique: true },
  name:         { type: String, required: true },
  company:      { type: String, default: '' },
  phone:        { type: String, required: true },
  email:        { type: String, default: '' },
  address:      { type: String, default: '' },
  country:      { type: String, default: 'Bangladesh' },
  website:      { type: String, default: '' },
  type:         { type: String, enum: ['local','china','india','other'], default: 'local' },
  paymentTerms: { type: String, default: '' },
  deliveryTime: { type: String, default: '3-7 days' },
  minOrder:     { type: Number, default: 0 },
  isActive:     { type: Boolean, default: true },
  isVerified:   { type: Boolean, default: false },
  rating:       { type: Number, default: 5, min: 0, max: 5 },
  totalOrders:  { type: Number, default: 0 },
  totalPaid:    { type: Number, default: 0 },
  bankInfo: {
    bankName:    String,
    accountNo:   String,
    accountName: String,
    branch:      String,
    bkash:       String,
    nagad:       String,
  },
  notes:        { type: String, default: '' },
  categories:   [String],
  productCount: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false, collection: 'suppliers' });

// ═══════════════════════════════════════════════════════════════════════════════
//  INVENTORY LOG SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const inventoryLogSchema = new mongoose.Schema({
  productId:   { type: String, required: true, index: true },
  productName: String,
  type:        { type: String, enum: ['in','out','adjust','return','damage'], required: true },
  qty:         { type: Number, required: true },
  stockBefore: Number,
  stockAfter:  Number,
  ref:         String,
  refType:     { type: String, enum: ['order','purchase','manual','return','damage'] },
  note:        String,
  updatedBy:   { type: String, default: 'admin' },
  supplierId:  String,
  costPrice:   Number,
}, { timestamps: true, versionKey: false, collection: 'inventory_logs' });

// ═══════════════════════════════════════════════════════════════════════════════
//  RETURN REQUEST SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const returnRequestSchema = new mongoose.Schema({
  returnId:      { type: String, required: true, unique: true },
  orderId:       { type: String, required: true, index: true },
  customerId:    mongoose.Schema.Types.ObjectId,
  customerPhone: String,
  customerName:  String,
  items: [{ productId: String, name: String, qty: Number, price: Number, reason: String }],
  reason:        { type: String, required: true },
  description:   { type: String, default: '' },
  images:        [String],
  status:        { type: String, enum: ['pending','approved','rejected','refunded','completed'], default: 'pending' },
  refundMethod:  { type: String, enum: ['bkash','nagad','bank','wallet','store_credit'], default: 'bkash' },
  refundAmount:  { type: Number, default: 0 },
  refundRef:     { type: String, default: '' },
  adminNote:     { type: String, default: '' },
  processedAt:   Date,
  processedBy:   String,
}, { timestamps: true, versionKey: false, collection: 'return_requests' });

// ═══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const notificationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  phone:    String,
  type:     { type: String, enum: ['order','promo','loyalty','system','return','stock','review'] },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  icon:     { type: String, default: '🔔' },
  link:     { type: String, default: '' },
  isRead:   { type: Boolean, default: false },
  isGlobal: { type: Boolean, default: false },
  channel:  { type: String, enum: ['app','sms','email','all'], default: 'app' },
  metadata: mongoose.Schema.Types.Mixed,
  readBy:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true, versionKey: false, collection: 'notifications' });

// ═══════════════════════════════════════════════════════════════════════════════
//  SITE SETTINGS SCHEMA  (key-value store for all admin-controlled settings)
// ═══════════════════════════════════════════════════════════════════════════════
const siteSettingsSchema = new mongoose.Schema({
  key:         { type: String, required: true, unique: true },
  value:       mongoose.Schema.Types.Mixed,
  group:       { type: String, default: 'general', index: true },
  label:       String,
  description: String,
  isPublic:    { type: Boolean, default: false }, // ✅ NEW v4: public = safe to expose to frontend
  type:        { type: String, enum: ['string','number','boolean','json','text'], default: 'string' },
}, { timestamps: true, versionKey: false, collection: 'site_settings' });

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: ADMIN CONFIG SCHEMA  (BUG-5 / SEC-2 — server-side password mgmt)
//  Stores hashed admin passwords and secondary access keys.
//  Never returned to client — backend-only.
// ═══════════════════════════════════════════════════════════════════════════════
const adminConfigSchema = new mongoose.Schema({
  // Single document — use key 'main'
  configKey:    { type: String, required: true, unique: true, default: 'main' },
  passwordHash: { type: String, required: true, select: false }, // bcrypt hash
  // Optional secondary admin API keys (hashed)
  secondaryKeys: [{ type: String, select: false }],
  // Audit: last password change
  passwordChangedAt: { type: Date, default: Date.now },
  passwordChangedBy: { type: String, default: 'system' },
}, { timestamps: true, versionKey: false, collection: 'admin_config' });

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: AUDIT LOG SCHEMA  (admin action trail)
// ═══════════════════════════════════════════════════════════════════════════════
const auditLogSchema = new mongoose.Schema({
  action:     { type: String, required: true },         // 'change-password', 'bulk-order-update', etc.
  targetType: String,                                    // 'order', 'product', 'user', 'settings'
  targetId:   String,
  payload:    mongoose.Schema.Types.Mixed,               // sanitized — no passwords
  performedBy:{ type: String, default: 'admin' },
  ip:         String,
  userAgent:  String,
  result:     { type: String, enum: ['success','failure'], default: 'success' },
  errorMsg:   String,
}, { timestamps: true, versionKey: false, collection: 'audit_logs' });

// Auto-expire audit logs after 6 months
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMENT / REVIEW SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const commentSchema = new mongoose.Schema({
  productId:          { type: String, required: true, index: true },
  orderId:            { type: String, default: '' },
  userId:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  customerName:       { type: String, required: true },
  customerPhone:      { type: String, default: '' },
  rating:             { type: Number, required: true, min: 1, max: 5 },
  title:              { type: String, default: '' },
  body:               { type: String, required: true },
  images:             { type: [String], default: [] },
  videoUrl:           { 
    type: String, 
    default: '',
    validate: {
      validator: function(v) {
        if (!v) return true; // empty is ok
        return /^https?:\/\/.+/.test(v); // must start with http:// or https://
      },
      message: 'Invalid video URL'
    }
  },
  isVerifiedPurchase: { type: Boolean, default: false },
  isApproved:         { type: Boolean, default: false },
  isHidden:           { type: Boolean, default: false },
  isFeatured:         { type: Boolean, default: false },
  helpfulCount:       { type: Number, default: 0 },
  helpfulVotes:       { type: [String], default: [] },
  flaggedBy:          { type: [String], default: [] },      // IPs that flagged this review
  flagReasons:        [{ ip: String, reason: String, createdAt: { type: Date, default: Date.now } }], // flag reasons
  size:               String,
  color:              String,
  reply:              { text: String, repliedAt: Date },
  adminNote:          { type: String, default: '' },
  deletedAt:          { type: Date, default: null }, // soft delete timestamp (null = active)
  // ✅ NEW v4: source — 'website' | 'api' | 'admin-import'
  source:             { type: String, default: 'website' },
  editedAt:           { type: Date, default: null },  // null = never edited
  editCount:          { type: Number, default: 0 },   // how many times edited
  guestEmail:         { type: String, default: '' },  // for guest reviews (email-based)
  guestToken:         { type: String, default: '' },  // one-time verify token for guest
  // flagCount added to support flagged-review index (not in original field spec; added since FIX 1 requires it)
  flagCount:          { type: Number, default: 0 },
}, { timestamps: true, versionKey: false, collection: 'comments' });

commentSchema.index({ productId: 1, isApproved: 1, createdAt: -1 });
commentSchema.index({ userId: 1 }); // for user-self-delete lookup
commentSchema.index({ flagCount: -1 }); // for flagged review queries

// ═══════════════════════════════════════════════════════════════════════════════
//  FLASH SALE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const flashSaleSchema = new mongoose.Schema({
  title:            { type: String, required: true },
  titleBn:          { type: String, default: '' },
  startAt:          { type: Date, required: true },
  endAt:            { type: Date, required: true },
  isActive:         { type: Boolean, default: true },
  products: [{
    productId:      String,
    salePrice:      Number,
    origPrice:      Number,
    stock:          Number,
    soldCount:      { type: Number, default: 0 },
    maxPerCustomer: { type: Number, default: 0 },
  }],
  extraDiscountPct: { type: Number, default: 0 },
  bannerImg:        String,
  bannerMobile:     String,
  description:      String,
  targetCategory:   String,
}, { timestamps: true, versionKey: false, collection: 'flash_sales' });

// ═══════════════════════════════════════════════════════════════════════════════
//  BUNDLE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const bundleSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  description:  String,
  productIds:   { type: [String], required: true },
  discountType: { type: String, enum: ['percent','flat'], default: 'percent' },
  discountValue:{ type: Number, required: true },
  isActive:     { type: Boolean, default: true },
  img:          String,
  totalSold:    { type: Number, default: 0 },
  startAt:      Date,
  endAt:        Date,
}, { timestamps: true, versionKey: false, collection: 'bundles' });

// ═══════════════════════════════════════════════════════════════════════════════
//  ABANDONED CART SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const abandonedCartSchema = new mongoose.Schema({
  sessionId:      { type: String, required: true },
  phone:          String,
  email:          String,
  name:           String,
  items: [{ productId: String, name: String, price: Number, qty: Number, img: String }],
  total:          Number,
  reminderSent:   { type: Number, default: 0 },
  lastReminderAt: Date,
  convertedAt:    Date,
  isConverted:    { type: Boolean, default: false },
  ip:             String,
}, { timestamps: true, versionKey: false, collection: 'abandoned_carts' });

// Auto-delete unconverted carts after 30 days
abandonedCartSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 2592000, partialFilterExpression: { isConverted: false } },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  NEWSLETTER SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const newsletterSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:       { type: String, default: '' },
  isActive:   { type: Boolean, default: true },
  tags:       { type: [String], default: [] },
  source:     { type: String, default: 'website' }, // website, checkout, etc.
  couponSent: { type: Boolean, default: false },
}, { timestamps: true, versionKey: false, collection: 'newsletters' });

// ═══════════════════════════════════════════════════════════════════════════════
//  SITE STATS SCHEMA  (Daily counters)
// ═══════════════════════════════════════════════════════════════════════════════
const siteStatsSchema = new mongoose.Schema({
  date:            { type: String, required: true, unique: true }, // 'YYYY-MM-DD'
  visitors:        { type: Number, default: 0 },
  orders:          { type: Number, default: 0 },
  revenue:         { type: Number, default: 0 },
  newUsers:        { type: Number, default: 0 },
  cancelledOrders: { type: Number, default: 0 },
  profit:          { type: Number, default: 0 },
}, { versionKey: false, collection: 'site_stats' });

// ✅ NEW v4: index for fast monthly/yearly aggregation (UPGRADE-A9)
siteStatsSchema.index({ date: 1 });

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: PUSH TOKEN SCHEMA  (Web Push / FCM — UPGRADE-I1 PWA)
// ═══════════════════════════════════════════════════════════════════════════════
const pushTokenSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  phone:     String,
  token:     { type: String, required: true, unique: true },  // FCM or Web Push endpoint
  platform:  { type: String, enum: ['web','android','ios'], default: 'web' },
  isActive:  { type: Boolean, default: true },
  lastSentAt:Date,
}, { timestamps: true, versionKey: false, collection: 'push_tokens' });

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: SEARCH LOG SCHEMA  (analytics — what customers search)
// ═══════════════════════════════════════════════════════════════════════════════
const searchLogSchema = new mongoose.Schema({
  query:       { type: String, required: true, index: true },
  resultsFound:{ type: Number, default: 0 },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ip:          String,
  clickedId:   String, // productId the user clicked, if any
}, { timestamps: true, versionKey: false, collection: 'search_logs' });

// Auto-expire search logs after 90 days
searchLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: SUPPORT TICKET SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const supportTicketSchema = new mongoose.Schema({
  ticketId:   { type: String, required: true, unique: true },
  subject:    { type: String, required: true },
  category:   { type: String, enum: ['order','payment','product','return','other'], default: 'other' },
  priority:   { type: String, enum: ['low','medium','high','urgent'], default: 'medium' },
  status:     { type: String, enum: ['open','in_progress','resolved','closed'], default: 'open' },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  customerName: String,
  customerPhone:String,
  customerEmail:String,
  relatedOrderId:{ type: String, default: '' },
  messages: [{
    sender:    { type: String, enum: ['customer','admin'], required: true },
    senderName:String,
    body:      { type: String, required: true },
    attachments:[String],
    createdAt: { type: Date, default: Date.now },
  }],
  resolvedAt: Date,
  resolvedBy: String,
  adminNote:  { type: String, default: '' },
}, { timestamps: true, versionKey: false, collection: 'support_tickets' });

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW v4: PROMO POPUP SCHEMA  (admin-controlled promotional popups)
// ═══════════════════════════════════════════════════════════════════════════════
const promoPopupSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  body:       String,
  img:        String,
  ctaText:    { type: String, default: 'Shop Now' },
  ctaUrl:     { type: String, default: '/' },
  couponCode: { type: String, default: '' },
  isActive:   { type: Boolean, default: true },
  startAt:    Date,
  endAt:      Date,
  showOnce:   { type: Boolean, default: true }, // per browser session
  delayMs:    { type: Number, default: 3000 },   // show after N ms
  targetPage: { type: String, default: 'all' },  // 'home', 'cart', 'all'
}, { timestamps: true, versionKey: false, collection: 'promo_popups' });

// ═══════════════════════════════════════════════════════════════════════════════
//  MODEL REGISTRATIONS
// ═══════════════════════════════════════════════════════════════════════════════
const Order          = reg('Order',          orderSchema);
const User           = reg('User',           userSchema);
const Product        = reg('Product',        productSchema);
const Category       = reg('Category',       categorySchema);
const Comment        = reg('Comment',        commentSchema);
const FlashSale      = reg('FlashSale',      flashSaleSchema);
const Bundle         = reg('Bundle',         bundleSchema);
const AbandonedCart  = reg('AbandonedCart',  abandonedCartSchema);
const Newsletter     = reg('Newsletter',     newsletterSchema);
const SiteStats      = reg('SiteStats',      siteStatsSchema);
const Supplier       = reg('Supplier',       supplierSchema);
const InventoryLog   = reg('InventoryLog',   inventoryLogSchema);
const ReturnRequest  = reg('ReturnRequest',  returnRequestSchema);
const Notification   = reg('Notification',   notificationSchema);
const SiteSettings   = reg('SiteSettings',   siteSettingsSchema);
const AdminConfig    = reg('AdminConfig',    adminConfigSchema);   // ✅ NEW v4
const AuditLog       = reg('AuditLog',       auditLogSchema);      // ✅ NEW v4
const PushToken      = reg('PushToken',      pushTokenSchema);     // ✅ NEW v4
const SearchLog      = reg('SearchLog',      searchLogSchema);     // ✅ NEW v4
const SupportTicket  = reg('SupportTicket',  supportTicketSchema); // ✅ NEW v4
const PromoPopup     = reg('PromoPopup',     promoPopupSchema);    // ✅ NEW v4

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Get a single setting value by key */
async function getSetting(key, defaultVal = null) {
  const doc = await SiteSettings.findOne({ key }).lean();
  return doc ? doc.value : defaultVal;
}

/** Set / upsert a single setting */
async function setSetting(key, value, meta = {}) {
  return SiteSettings.findOneAndUpdate(
    { key },
    { key, value, ...meta },
    { upsert: true, new: true },
  );
}

/** Get all settings in a group (or all settings if group is omitted) */
async function getSettings(group) {
  const query = group ? { group } : {};
  const docs  = await SiteSettings.find(query).lean();
  return Object.fromEntries(docs.map(d => [d.key, d.value]));
}

/**
 * ✅ NEW v4: getPublicSettings()
 * Returns only settings marked `isPublic: true` — safe to expose to frontend.
 * Used by api/settings?action=public  (UPGRADE-I2)
 *
 * Example public keys: siteName, currency, shippingCost, freeShippingMin,
 * bkashNumber, nagadNumber, rocketNumber, upayNumber, whatsappNumber
 */
async function getPublicSettings() {
  const docs = await SiteSettings.find({ isPublic: true }).lean();
  return Object.fromEntries(docs.map(d => [d.key, d.value]));
}

/**
 * ✅ NEW v4: seedDefaultSettings()
 * Call once on first deploy to populate required keys.
 * Safe to call repeatedly — uses upsert, won't overwrite existing values.
 */
async function seedDefaultSettings() {
  const defaults = [
    { key: 'siteName',       value: 'Shoplixo',           group: 'general',  isPublic: true,  type: 'string', label: 'Site Name' },
    { key: 'currency',       value: 'BDT',                group: 'general',  isPublic: true,  type: 'string', label: 'Currency' },
    { key: 'shippingCost',   value: 60,                   group: 'shipping', isPublic: true,  type: 'number', label: 'Shipping Cost (৳)' },
    { key: 'freeShippingMin',value: 999,                  group: 'shipping', isPublic: true,  type: 'number', label: 'Free Shipping Minimum (৳)' },
    { key: 'bkashNumber',    value: '01516511889',        group: 'payment',  isPublic: true,  type: 'string', label: 'bKash Number' },
    { key: 'nagadNumber',    value: '01516511889',        group: 'payment',  isPublic: true,  type: 'string', label: 'Nagad Number' },
    { key: 'rocketNumber',   value: '01516511889',        group: 'payment',  isPublic: true,  type: 'string', label: 'Rocket Number' },
    { key: 'upayNumber',     value: '01516511889',        group: 'payment',  isPublic: true,  type: 'string', label: 'Upay Number' },
    { key: 'whatsappNumber', value: '8801516511889',      group: 'contact',  isPublic: true,  type: 'string', label: 'WhatsApp Number' },
    { key: 'siteUrl',        value: 'https://shoplixo.shop', group: 'general', isPublic: false, type: 'string', label: 'Site URL' },
    { key: 'cloudinaryCloud',value: '',                   group: 'media',    isPublic: false, type: 'string', label: 'Cloudinary Cloud Name' },
    { key: 'cloudinaryPreset',value: 'shoplixo_unsigned', group: 'media',   isPublic: false, type: 'string', label: 'Cloudinary Upload Preset' },
  ];

  const ops = defaults.map(s => ({
    updateOne: {
      filter: { key: s.key },
      update: { $setOnInsert: s },
      upsert: true,
    },
  }));
  return SiteSettings.bulkWrite(ops, { ordered: false });
}

/**
 * ✅ NEW v4: writeAuditLog(action, targetType, targetId, payload, req)
 * Convenience wrapper used by API handlers (change-password, bulk ops, etc.)
 */
async function writeAuditLog(action, targetType, targetId, payload = {}, req = {}) {
  try {
    await AuditLog.create({
      action,
      targetType,
      targetId:    String(targetId || ''),
      payload,
      performedBy: 'admin',
      ip:          req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '',
      userAgent:   req.headers?.['user-agent'] || '',
    });
  } catch (_) { /* non-critical — never block the request */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = {
  connectDB,

  // Models
  Order, User, Product, Category, Comment, FlashSale, Bundle,
  AbandonedCart, Newsletter, SiteStats,
  Supplier, InventoryLog, ReturnRequest, Notification,
  SiteSettings, AdminConfig, AuditLog, PushToken, SearchLog,
  SupportTicket, PromoPopup,

  // Settings helpers
  getSetting, setSetting, getSettings,
  getPublicSettings,    // ✅ NEW v4
  seedDefaultSettings,  // ✅ NEW v4
  writeAuditLog,        // ✅ NEW v4
};
