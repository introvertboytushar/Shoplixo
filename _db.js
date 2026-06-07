/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — MongoDB Connection + ALL Schemas v2
 *  ⚠️  এটা ROOT _db.js — সব API file এখান থেকে import করে
 *  Comments, FlashSale, Bundle, Loyalty, Referral, AbandonedCart, SiteStats
 * ══════════════════════════════════════════════════════════════
 */
const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('❌ MONGODB_URI missing in .env');

let cached = global._mongoCache || (global._mongoCache = { conn: null, promise: null });

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false, maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000,
    });
  }
  try { cached.conn = await cached.promise; }
  catch (e) { cached.promise = null; throw e; }
  return cached.conn;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ORDER SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const orderSchema = new mongoose.Schema({
  orderId:  { type: String, required: true, unique: true, index: true },
  customer: {
    name: String, phone: String, email: { type: String, default: '' },
    address: String, district: String, note: { type: String, default: '' },
  },
  items: [{
    productId: String, name: String, price: Number, qty: Number,
    img: { type: String, default: '' }, size: String, color: String,
  }],
  payment: {
    method: { type: String, enum: ['bkash','nagad','rocket','upay','cod'] },
    transactionId: { type: String, default: '' },
    status: { type: String, enum: ['pending','verified','failed'], default: 'pending' },
  },
  pricing: {
    subtotal: Number, shipping: { type: Number, default: 60 },
    discount: { type: Number, default: 0 }, coupon: { type: String, default: '' },
    loyaltyDiscount: { type: Number, default: 0 },
    total: Number,
  },
  status: {
    type: String,
    enum: ['pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled','refunded'],
    default: 'pending', index: true,
  },
  statusHistory: [{ status: String, note: String, updatedBy: String, updatedAt: { type: Date, default: Date.now } }],
  tracking: { courier: String, trackingId: String, estimatedDelivery: Date },
  loyaltyPointsEarned: { type: Number, default: 0 },
  loyaltyPointsUsed:   { type: Number, default: 0 },
  referralCode: { type: String, default: '' },
  isReviewed: { type: Boolean, default: false },
  ip: String, userAgent: String, source: { type: String, default: 'website' },
}, { timestamps: true, collection: 'orders' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   USER SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  email: { type: String, trim: true, lowercase: true, sparse: true },
  password: { type: String, required: true, select: false },
  avatar: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  addresses: [{
    label: String, address: String, district: String,
    phone: String, isDefault: Boolean,
  }],
  wishlist: { type: [String], default: [] },
  compareList: { type: [String], default: [] },
  totalOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  loyaltyPoints: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: String, default: '' },
  totalReferrals: { type: Number, default: 0 },
  lastLogin: Date,
  otp: { type: String, select: false },
  otpExpiry: { type: Date, select: false },
}, { timestamps: true, collection: 'users' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PRODUCT SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const productSchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  cat: { type: String, required: true, index: true },
  price: { type: Number, required: true },
  orig: Number,
  img: { type: String, default: '' },
  images: { type: [String], default: [] },
  badge: { type: String, enum: ['hot','new','sale','sold','best'], default: 'new' },
  rating: { type: Number, default: 5, min: 0, max: 5 },
  reviews: { type: Number, default: 0 },
  stock: { type: Number, default: 100 },
  viewers: { type: Number, default: 5 },
  isFeatured: { type: Boolean, default: false },
  isNew: { type: Boolean, default: true },
  isFlash: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  sizes: [String], colors: [String],
  material: String, warranty: String, sku: String,
  tags: [String], desc: String,
  totalSold: { type: Number, default: 0 },
  videoUrl: { type: String, default: '' },
  weight: Number,
  dimensions: { l: Number, w: Number, h: Number },
  seoTitle: String, seoDesc: String,
  bundleIds: [String],
  specifications: [{ key: String, value: String }],
  returnPolicy: { type: String, default: '৭ দিনের মধ্যে ফেরত নেওয়া যাবে' },
}, { timestamps: true, collection: 'products' });
productSchema.index({ name: 'text', tags: 'text', desc: 'text' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   COMMENT / REVIEW SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const commentSchema = new mongoose.Schema({
  productId:    { type: String, required: true, index: true },
  orderId:      { type: String, default: '' },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  customerName: { type: String, required: true },
  customerPhone:{ type: String, default: '', select: false },
  rating:       { type: Number, required: true, min: 1, max: 5 },
  title:        { type: String, default: '' },
  body:         { type: String, required: true },
  images:       { type: [String], default: [] },
  videoUrl:     { type: String, default: '' },
  isVerifiedPurchase: { type: Boolean, default: false },
  isApproved:   { type: Boolean, default: false },
  isHidden:     { type: Boolean, default: false },
  helpfulCount: { type: Number, default: 0 },
  helpfulVotes: { type: [String], default: [], select: false },
  size:  String,
  color: String,
  reply: { text: String, repliedAt: Date },
}, { timestamps: true, collection: 'comments' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FLASH SALE SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const flashSaleSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  startAt:  { type: Date, required: true },
  endAt:    { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  products: [{
    productId: String, salePrice: Number, origPrice: Number,
    stock: Number, soldCount: { type: Number, default: 0 },
  }],
  extraDiscountPct: { type: Number, default: 0 },
  bannerImg: String,
  description: String,
}, { timestamps: true, collection: 'flash_sales' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   BUNDLE SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const bundleSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  description:  String,
  productIds:   { type: [String], required: true },
  discountType: { type: String, enum: ['percent','flat'], default: 'percent' },
  discountValue:{ type: Number, required: true },
  isActive:     { type: Boolean, default: true },
  img:          String,
  totalSold:    { type: Number, default: 0 },
  startAt: Date, endAt: Date,
}, { timestamps: true, collection: 'bundles' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LOYALTY TRANSACTION SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const loyaltySchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  phone:   String,
  type:    { type: String, enum: ['earn','redeem','bonus','referral','expire','admin'], required: true },
  points:  { type: Number, required: true },
  balance: { type: Number, required: true },
  ref:     String,
  note:    String,
}, { timestamps: true, collection: 'loyalty_txns' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   REFERRAL SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const referralSchema = new mongoose.Schema({
  referrerUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  referrerPhone:   String,
  referralCode:    { type: String, required: true, index: true },
  referredPhone:   String,
  referredUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status:          { type: String, enum: ['pending','completed','paid'], default: 'pending' },
  pointsAwarded:   { type: Number, default: 0 },
  orderId:         String,
}, { timestamps: true, collection: 'referrals' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ABANDONED CART SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const abandonedCartSchema = new mongoose.Schema({
  sessionId:  { type: String, required: true, unique: true },
  phone:      String, email: String, name: String,
  items:      [{ productId: String, name: String, price: Number, qty: Number, img: String }],
  total:      Number,
  reminderSent:   { type: Number, default: 0 },
  lastReminderAt: Date,
  convertedAt:    Date,
  isConverted:    { type: Boolean, default: false },
  ip: String,
}, { timestamps: true, collection: 'abandoned_carts' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   NEWSLETTER SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const newsletterSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:     { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  source:   { type: String, default: 'website' },
  couponSent: { type: Boolean, default: false },
}, { timestamps: true, collection: 'newsletters' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   COUPON SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const couponSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, uppercase: true },
  type:        { type: String, enum: ['percent','flat'], default: 'percent' },
  discount:    { type: Number, required: true },
  minOrder:    { type: Number, default: 0 },
  maxUses:     { type: Number, default: 0 },
  usedCount:   { type: Number, default: 0 },
  usedBy:      { type: [String], default: [] },
  isActive:    { type: Boolean, default: true },
  expiresAt:   Date, description: String,
}, { timestamps: true, collection: 'coupons' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SITE STATS SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const siteStatsSchema = new mongoose.Schema({
  date:     { type: String, required: true, unique: true },
  visitors: { type: Number, default: 0 },
  orders:   { type: Number, default: 0 },
  revenue:  { type: Number, default: 0 },
  newUsers: { type: Number, default: 0 },
}, { collection: 'site_stats' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MODELS (safe to call multiple times)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const m = n => mongoose.models[n];
const Order         = m('Order')         || mongoose.model('Order',         orderSchema);
const User          = m('User')          || mongoose.model('User',          userSchema);
const Product       = m('Product')       || mongoose.model('Product',       productSchema);
const Comment       = m('Comment')       || mongoose.model('Comment',       commentSchema);
const FlashSale     = m('FlashSale')     || mongoose.model('FlashSale',     flashSaleSchema);
const Bundle        = m('Bundle')        || mongoose.model('Bundle',        bundleSchema);
const LoyaltyTxn    = m('LoyaltyTxn')   || mongoose.model('LoyaltyTxn',    loyaltySchema);
const Referral      = m('Referral')      || mongoose.model('Referral',      referralSchema);
const AbandonedCart = m('AbandonedCart') || mongoose.model('AbandonedCart', abandonedCartSchema);
const Newsletter    = m('Newsletter')    || mongoose.model('Newsletter',    newsletterSchema);
const Coupon        = m('Coupon')        || mongoose.model('Coupon',        couponSchema);
const SiteStats     = m('SiteStats')     || mongoose.model('SiteStats',     siteStatsSchema);

module.exports = {
  connectDB,
  Order, User, Product, Comment, FlashSale, Bundle,
  LoyaltyTxn, Referral, AbandonedCart, Newsletter, Coupon, SiteStats,
};
