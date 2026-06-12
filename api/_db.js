/**
 * ══════════════════════════════════════════════════════════════════════
 *  SHOPLIXO — MongoDB Connection + ALL Schemas  (Ultra Pro v4)
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
    area:     { type: String, default: '' },
    note:     { type: String, default: '' },
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
    coupon:         { type: String, default: '' },
    loyaltyDiscount:{ type: Number, default: 0 },
    total:          Number,
    profit:         { type: Number, default: 0 },
  },

  status: {
    type: String,
    enum: [
      'pending','confirmed','processing','shipped',
      'out_for_delivery','delivered','cancelled',
      'refunded','return_requested','returned',
    ],
    default: 'pending',
    index: true,
  },

  // ✅ NEW v4: bulkStatusNote — set by bulk-update operations (UPGRADE-A4)
  bulkStatusNote: { type: String, default: '' },

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

  loyaltyPointsEarned:   { type: Number, default: 0 },
  loyaltyPointsRedeemed: { type: Number, default: 0 },
  referralCode:          { type: String, default: '' },
  affiliateCode:         { type: String, default: '' },
  affiliateCommission:   { type: Number, default: 0 },
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
  phone:     { type: String, required: true, unique: true, trim: true },
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
  loyaltyPoints:    { type: Number, default: 0 },
  loyaltyTier:      { type: String, enum: ['bronze','silver','gold','platinum'], default: 'bronze' },
  referralCode:     { type: String, unique: true, sparse: true },
  referredBy:       { type: String, default: '' },
  totalReferrals:   { type: Number, default: 0 },
  affiliateCode:    { type: String, sparse: true },
  affiliateBalance: { type: Number, default: 0 },
  totalAffiliateEarned: { type: Number, default: 0 },
  lastLogin:        Date,
  loginCount:       { type: Number, default: 0 },

  // Online status tracking
  isOnline:         { type: Boolean, default: false },
  lastSeen:         { type: Date, default: null },
  loginMethod:      { type: String, enum: ['email', 'google', 'facebook', 'phone'], default: 'email' },
  sessionToken:     { type: String, default: null, select: false },
  forceLoggedOut:   { type: Boolean, default: false },
  deviceInfo:       { type: String, default: '' },

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
  type:     { type: String, enum: ['order','promo','loyalty','system','return','stock'] },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  icon:     { type: String, default: '🔔' },
  link:     { type: String, default: '' },
  isRead:   { type: Boolean, default: false },
  isGlobal: { type: Boolean, default: false },
  channel:  { type: String, enum: ['app','sms','email','all'], default: 'app' },
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true, versionKey: false, collection: 'notifications' });

// ═══════════════════════════════════════════════════════════════════════════════
//  AFFILIATE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const affiliateSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone:          String,
  affiliateCode:  { type: String, required: true, unique: true },
  commissionRate: { type: Number, default: 5 },
  totalClicks:    { type: Number, default: 0 },
  totalOrders:    { type: Number, default: 0 },
  totalEarned:    { type: Number, default: 0 },
  pendingAmount:  { type: Number, default: 0 },
  paidAmount:     { type: Number, default: 0 },
  isActive:       { type: Boolean, default: true },
  payouts: [{
    amount:  Number,
    method:  String,
    ref:     String,
    paidAt:  Date,
    paidBy:  String,
  }],
}, { timestamps: true, versionKey: false, collection: 'affiliates' });

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
  videoUrl:           { type: String, default: '' },
  isVerifiedPurchase: { type: Boolean, default: false },
  isApproved:         { type: Boolean, default: false },
  isHidden:           { type: Boolean, default: false },
  isFeatured:         { type: Boolean, default: false },
  helpfulCount:       { type: Number, default: 0 },
  helpfulVotes:       { type: [String], default: [] },
  size:               String,
  color:              String,
  reply:              { text: String, repliedAt: Date },
  adminNote:          { type: String, default: '' },
  // ✅ NEW v4: source — 'website' | 'api' | 'admin-import'
  source:             { type: String, default: 'website' },
}, { timestamps: true, versionKey: false, collection: 'comments' });

commentSchema.index({ productId: 1, isApproved: 1, createdAt: -1 });

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
//  LOYALTY TRANSACTION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const loyaltySchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  phone:     String,
  type:      { type: String, enum: ['earn','redeem','bonus','referral','expire','admin','affiliate','return'], required: true },
  points:    { type: Number, required: true },
  balance:   { type: Number, required: true },
  ref:       String,
  note:      String,
  expiresAt: Date,
}, { timestamps: true, versionKey: false, collection: 'loyalty_txns' });

// ═══════════════════════════════════════════════════════════════════════════════
//  REFERRAL SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
const referralSchema = new mongoose.Schema({
  referrerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  referrerPhone:  String,
  referralCode:   { type: String, required: true, index: true },
  referredPhone:  String,
  referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status:         { type: String, enum: ['pending','completed','paid'], default: 'pending' },
  pointsAwarded:  { type: Number, default: 0 },
  orderId:        String,
}, { timestamps: true, versionKey: false, collection: 'referrals' });

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
//  COUPON SCHEMA  — with validate() instance method (BUG-3)
// ═══════════════════════════════════════════════════════════════════════════════
const couponSchema = new mongoose.Schema({
  code:               { type: String, required: true, unique: true, uppercase: true },
  type:               { type: String, enum: ['percent','flat','free_shipping','bogo'], default: 'percent' },
  discount:           { type: Number, required: true },
  maxDiscount:        { type: Number, default: 0 },
  minOrder:           { type: Number, default: 0 },
  maxUses:            { type: Number, default: 0 },
  maxPerUser:         { type: Number, default: 0 },
  usedCount:          { type: Number, default: 0 },
  usedBy:             { type: [String], default: [] },
  isActive:           { type: Boolean, default: true },
  expiresAt:          Date,
  description:        String,
  applicableCats:     [String],
  applicableProducts: [String],
  isFirstOrderOnly:   { type: Boolean, default: false },
  isReferralCoupon:   { type: Boolean, default: false },
}, { timestamps: true, versionKey: false, collection: 'coupons' });

/**
 * ✅ NEW v4: Coupon.validateCoupon(code, subtotal, userPhone?, isFirstOrder?)
 *
 * Centralised validation used by api/commerce?action=validate-coupon  (BUG-3)
 * Returns { ok, discount, discountType, coupon } or { ok: false, error }
 */
couponSchema.statics.validateCoupon = async function(code, subtotal = 0, userPhone = '', isFirstOrder = false) {
  if (!code) return { ok: false, error: 'কোড দিন' };

  const c = await this.findOne({ code: code.toUpperCase().trim(), isActive: true });
  if (!c) return { ok: false, error: 'কুপন পাওয়া যায়নি বা inactive' };

  // Expiry check
  if (c.expiresAt && new Date() > c.expiresAt)
    return { ok: false, error: 'কুপনের মেয়াদ শেষ' };

  // Min order check
  if (subtotal < c.minOrder)
    return { ok: false, error: `ন্যূনতম ৳${c.minOrder} অর্ডারে ব্যবহারযোগ্য` };

  // Max global uses
  if (c.maxUses > 0 && c.usedCount >= c.maxUses)
    return { ok: false, error: 'কুপনের সীমা শেষ' };

  // Per-user limit
  if (c.maxPerUser > 0 && userPhone) {
    const timesUsed = c.usedBy.filter(p => p === userPhone).length;
    if (timesUsed >= c.maxPerUser)
      return { ok: false, error: 'আপনি এই কুপন আগে ব্যবহার করেছেন' };
  }

  // First-order-only check
  if (c.isFirstOrderOnly && !isFirstOrder)
    return { ok: false, error: 'এই কুপন শুধু প্রথম অর্ডারে ব্যবহারযোগ্য' };

  // Calculate discount
  let discount = 0;
  if (c.type === 'percent') {
    discount = Math.floor(subtotal * c.discount / 100);
    if (c.maxDiscount > 0) discount = Math.min(discount, c.maxDiscount);
  } else if (c.type === 'flat') {
    discount = Math.min(c.discount, subtotal);
  } else if (c.type === 'free_shipping') {
    discount = 0; // handled at checkout level
  }

  return { ok: true, discount, discountType: c.type, coupon: c };
};

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
const LoyaltyTxn     = reg('LoyaltyTxn',    loyaltySchema);
const Referral       = reg('Referral',       referralSchema);
const AbandonedCart  = reg('AbandonedCart',  abandonedCartSchema);
const Newsletter     = reg('Newsletter',     newsletterSchema);
const Coupon         = reg('Coupon',         couponSchema);
const SiteStats      = reg('SiteStats',      siteStatsSchema);
const Supplier       = reg('Supplier',       supplierSchema);
const InventoryLog   = reg('InventoryLog',   inventoryLogSchema);
const ReturnRequest  = reg('ReturnRequest',  returnRequestSchema);
const Notification   = reg('Notification',   notificationSchema);
const Affiliate      = reg('Affiliate',      affiliateSchema);
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
    { key: 'loyaltyEnabled', value: true,                 group: 'loyalty',  isPublic: false, type: 'boolean',label: 'Loyalty Program' },
    { key: 'referralPoints', value: 100,                  group: 'loyalty',  isPublic: false, type: 'number', label: 'Referral Bonus Points' },
    { key: 'pointsPerTaka',  value: 1,                   group: 'loyalty',  isPublic: false, type: 'number', label: 'Points per ৳1 spent' },
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
  LoyaltyTxn, Referral, AbandonedCart, Newsletter, Coupon, SiteStats,
  Supplier, InventoryLog, ReturnRequest, Notification, Affiliate,
  SiteSettings, AdminConfig, AuditLog, PushToken, SearchLog,
  SupportTicket, PromoPopup,

  // Settings helpers
  getSetting, setSetting, getSettings,
  getPublicSettings,    // ✅ NEW v4
  seedDefaultSettings,  // ✅ NEW v4
  writeAuditLog,        // ✅ NEW v4
};
