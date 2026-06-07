/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — MongoDB Connection + ALL Schemas (Ultra Pro v3)
 *  নতুন: Supplier, Dropship, SiteSettings, Notification,
 *         InventoryLog, ReturnRequest, Affiliate, Category
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
    address: String, district: String, area: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  items: [{
    productId: String, name: String, price: Number, qty: Number,
    img: { type: String, default: '' }, size: String, color: String,
    supplierId: { type: String, default: '' },    // dropshipping
    supplierPrice: { type: Number, default: 0 },  // dropshipping cost
    isDropship: { type: Boolean, default: false },
  }],
  payment: {
    method: { type: String, enum: ['bkash','nagad','rocket','upay','cod','card','wallet'] },
    transactionId: { type: String, default: '' },
    status: { type: String, enum: ['pending','verified','failed','refunded'], default: 'pending' },
    verifiedAt: Date,
    verifiedBy: String,
    gatewayRef: { type: String, default: '' },
  },
  pricing: {
    subtotal: Number, shipping: { type: Number, default: 60 },
    discount: { type: Number, default: 0 }, coupon: { type: String, default: '' },
    loyaltyDiscount: { type: Number, default: 0 },
    total: Number, profit: { type: Number, default: 0 }, // auto-calculated
  },
  status: {
    type: String,
    enum: ['pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled','refunded','return_requested','returned'],
    default: 'pending', index: true,
  },
  statusHistory: [{ status: String, note: String, updatedBy: String, updatedAt: { type: Date, default: Date.now } }],
  tracking: { courier: String, trackingId: String, estimatedDelivery: Date, trackingUrl: String },
  loyaltyPointsEarned: { type: Number, default: 0 },
  loyaltyPointsRedeemed: { type: Number, default: 0 },
  referralCode: { type: String, default: '' },
  affiliateCode: { type: String, default: '' },
  affiliateCommission: { type: Number, default: 0 },
  dropshipStatus: { type: String, enum: ['none','ordered','processing','shipped'], default: 'none' },
  dropshipOrderId: { type: String, default: '' },
  ip: String, userAgent: String, source: { type: String, default: 'website' },
  invoiceUrl: { type: String, default: '' },
  adminNote: { type: String, default: '' },
}, { timestamps: true, collection: 'orders' });
orderSchema.index({ 'customer.phone': 1 });
orderSchema.index({ createdAt: -1 });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   USER SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  email: { type: String, trim: true, lowercase: true, sparse: true },
  password: { type: String, required: true, select: false },
  avatar: { type: String, default: '' },
  role: { type: String, enum: ['user','affiliate','vip'], default: 'user' },
  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: '' },
  addresses: [{
    label: String, address: String, district: String, area: String,
    phone: String, isDefault: Boolean,
  }],
  wishlist: { type: [String], default: [] },
  compareList: { type: [String], default: [] },
  totalOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  loyaltyPoints: { type: Number, default: 0 },
  loyaltyTier: { type: String, enum: ['bronze','silver','gold','platinum'], default: 'bronze' },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: String, default: '' },
  totalReferrals: { type: Number, default: 0 },
  affiliateCode: { type: String, sparse: true },
  affiliateBalance: { type: Number, default: 0 },
  totalAffiliateEarned: { type: Number, default: 0 },
  lastLogin: Date,
  loginCount: { type: Number, default: 0 },
  otp: { type: String, select: false },
  otpExpiry: { type: Date, select: false },
  resetToken: { type: String, select: false },
  resetTokenExpiry: { type: Date, select: false },
  notificationPrefs: {
    orderUpdates: { type: Boolean, default: true },
    promotions: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
  },
}, { timestamps: true, collection: 'users' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   CATEGORY SCHEMA (Dynamic categories from DB)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
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
  seoTitle:    String, seoDesc: String,
  productCount:{ type: Number, default: 0 },
}, { timestamps: true, collection: 'categories' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PRODUCT SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const productSchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  nameBn: { type: String, default: '' },
  cat: { type: String, required: true, index: true },
  subCat: { type: String, default: '' },
  brand: { type: String, default: '' },
  price: { type: Number, required: true },
  orig: Number,
  costPrice: { type: Number, default: 0 },   // for profit calculation
  img: { type: String, default: '' },
  images: { type: [String], default: [] },
  badge: { type: String, enum: ['hot','new','sale','sold','trending','exclusive'], default: 'new' },
  rating: { type: Number, default: 5, min: 0, max: 5 },
  reviews: { type: Number, default: 0 },
  stock: { type: Number, default: 100 },
  lowStockAlert: { type: Number, default: 5 },
  viewers: { type: Number, default: 5 },
  isFeatured: { type: Boolean, default: false },
  isNew: { type: Boolean, default: true },
  isFlash: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  isDropship: { type: Boolean, default: false },
  supplierId: { type: String, default: '' },
  supplierSku: { type: String, default: '' },
  supplierPrice: { type: Number, default: 0 },
  sizes: [String], colors: [String],
  material: String, warranty: String, sku: String,
  tags: [String], desc: String, descBn: String,
  totalSold: { type: Number, default: 0 },
  videoUrl: { type: String, default: '' },
  weight: Number,
  dimensions: { l: Number, w: Number, h: Number },
  seoTitle: String, seoDesc: String, seoKeywords: [String],
  bundleIds: [String],
  specifications: [{ key: String, value: String }],
  returnPolicy: { type: String, default: '7 দিনের মধ্যে return করা যাবে' },
  shippingTime: { type: String, default: 'ঢাকায় ১-২ দিন, সারাদেশে ৩-৫ দিন' },
}, { timestamps: true, collection: 'products' });
productSchema.index({ name: 'text', tags: 'text', desc: 'text', brand: 'text' });
productSchema.index({ cat: 1, isActive: 1, price: 1 });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUPPLIER SCHEMA (Dropshipping)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
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
    bankName: String, accountNo: String, accountName: String,
    branch: String, bkash: String, nagad: String,
  },
  notes:        { type: String, default: '' },
  categories:   [String],
  productCount: { type: Number, default: 0 },
}, { timestamps: true, collection: 'suppliers' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   INVENTORY LOG SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const inventoryLogSchema = new mongoose.Schema({
  productId:   { type: String, required: true, index: true },
  productName: String,
  type:        { type: String, enum: ['in','out','adjust','return','damage'], required: true },
  qty:         { type: Number, required: true },
  stockBefore: Number,
  stockAfter:  Number,
  ref:         String,    // orderId or reason
  refType:     { type: String, enum: ['order','purchase','manual','return','damage'] },
  note:        String,
  updatedBy:   { type: String, default: 'admin' },
  supplierId:  String,
  costPrice:   Number,
}, { timestamps: true, collection: 'inventory_logs' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   RETURN REQUEST SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const returnRequestSchema = new mongoose.Schema({
  returnId:     { type: String, required: true, unique: true },
  orderId:      { type: String, required: true, index: true },
  customerId:   mongoose.Schema.Types.ObjectId,
  customerPhone: String,
  customerName: String,
  items:        [{ productId: String, name: String, qty: Number, price: Number, reason: String }],
  reason:       { type: String, required: true },
  description:  { type: String, default: '' },
  images:       [String],
  status:       { type: String, enum: ['pending','approved','rejected','refunded','completed'], default: 'pending' },
  refundMethod: { type: String, enum: ['bkash','nagad','bank','wallet','store_credit'], default: 'bkash' },
  refundAmount: { type: Number, default: 0 },
  refundRef:    { type: String, default: '' },
  adminNote:    { type: String, default: '' },
  processedAt:  Date,
  processedBy:  String,
}, { timestamps: true, collection: 'return_requests' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   NOTIFICATION SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const notificationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  phone:    String,
  type:     { type: String, enum: ['order','promo','loyalty','system','return','stock'] },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  icon:     { type: String, default: '🔔' },
  link:     { type: String, default: '' },
  isRead:   { type: Boolean, default: false },
  isGlobal: { type: Boolean, default: false }, // broadcast to all users
  channel:  { type: String, enum: ['app','sms','email','all'], default: 'app' },
  metadata: mongoose.Schema.Types.Mixed,
}, { timestamps: true, collection: 'notifications' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AFFILIATE SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const affiliateSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  phone:        String,
  affiliateCode: { type: String, required: true, unique: true },
  commissionRate: { type: Number, default: 5 }, // percent
  totalClicks:  { type: Number, default: 0 },
  totalOrders:  { type: Number, default: 0 },
  totalEarned:  { type: Number, default: 0 },
  pendingAmount:{ type: Number, default: 0 },
  paidAmount:   { type: Number, default: 0 },
  isActive:     { type: Boolean, default: true },
  payouts: [{
    amount: Number, method: String, ref: String,
    paidAt: Date, paidBy: String,
  }],
}, { timestamps: true, collection: 'affiliates' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SITE SETTINGS SCHEMA (Admin controls everything)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const siteSettingsSchema = new mongoose.Schema({
  key:         { type: String, required: true, unique: true },
  value:       mongoose.Schema.Types.Mixed,
  group:       { type: String, default: 'general' },
  label:       String,
  description: String,
  type:        { type: String, enum: ['string','number','boolean','json','text'], default: 'string' },
}, { timestamps: true, collection: 'site_settings' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   COMMENT / REVIEW SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const commentSchema = new mongoose.Schema({
  productId:    { type: String, required: true, index: true },
  orderId:      { type: String, default: '' },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  customerName: { type: String, required: true },
  customerPhone:{ type: String, default: '' },
  rating:       { type: Number, required: true, min: 1, max: 5 },
  title:        { type: String, default: '' },
  body:         { type: String, required: true },
  images:       { type: [String], default: [] },
  videoUrl:     { type: String, default: '' },
  isVerifiedPurchase: { type: Boolean, default: false },
  isApproved:   { type: Boolean, default: false },
  isHidden:     { type: Boolean, default: false },
  isFeatured:   { type: Boolean, default: false },
  helpfulCount: { type: Number, default: 0 },
  helpfulVotes: { type: [String], default: [] },
  size:         String, color: String,
  reply:        { text: String, repliedAt: Date },
  adminNote:    { type: String, default: '' },
}, { timestamps: true, collection: 'comments' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FLASH SALE SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const flashSaleSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  titleBn:    { type: String, default: '' },
  startAt:    { type: Date, required: true },
  endAt:      { type: Date, required: true },
  isActive:   { type: Boolean, default: true },
  products: [{
    productId: String, salePrice: Number, origPrice: Number,
    stock: Number, soldCount: { type: Number, default: 0 },
    maxPerCustomer: { type: Number, default: 0 },
  }],
  extraDiscountPct: { type: Number, default: 0 },
  bannerImg: String, bannerMobile: String,
  description: String,
  targetCategory: String,
}, { timestamps: true, collection: 'flash_sales' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   BUNDLE SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const bundleSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: String,
  productIds:  { type: [String], required: true },
  discountType:{ type: String, enum: ['percent','flat'], default: 'percent' },
  discountValue:{ type: Number, required: true },
  isActive:    { type: Boolean, default: true },
  img:         String,
  totalSold:   { type: Number, default: 0 },
  startAt:     Date, endAt: Date,
}, { timestamps: true, collection: 'bundles' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LOYALTY TRANSACTION SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const loyaltySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  phone:    String,
  type:     { type: String, enum: ['earn','redeem','bonus','referral','expire','admin','affiliate','return'], required: true },
  points:   { type: Number, required: true },
  balance:  { type: Number, required: true },
  ref:      String,
  note:     String,
  expiresAt: Date,
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
  sessionId:  { type: String, required: true },
  phone:      String, email: String, name: String,
  items:      [{ productId: String, name: String, price: Number, qty: Number, img: String }],
  total:      Number,
  reminderSent: { type: Number, default: 0 },
  lastReminderAt: Date,
  convertedAt: Date,
  isConverted: { type: Boolean, default: false },
  ip:         String,
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
  type:        { type: String, enum: ['percent','flat','free_shipping','bogo'], default: 'percent' },
  discount:    { type: Number, required: true },
  maxDiscount: { type: Number, default: 0 }, // cap for percent coupons
  minOrder:    { type: Number, default: 0 },
  maxUses:     { type: Number, default: 0 },
  maxPerUser:  { type: Number, default: 0 },
  usedCount:   { type: Number, default: 0 },
  usedBy:      { type: [String], default: [] },
  isActive:    { type: Boolean, default: true },
  expiresAt:   Date, description: String,
  applicableCats: [String],  // category-specific coupon
  applicableProducts: [String],
  isFirstOrderOnly: { type: Boolean, default: false },
  isReferralCoupon: { type: Boolean, default: false },
}, { timestamps: true, collection: 'coupons' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SITE STATS SCHEMA (Daily counters)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const siteStatsSchema = new mongoose.Schema({
  date:        { type: String, required: true, unique: true },
  visitors:    { type: Number, default: 0 },
  orders:      { type: Number, default: 0 },
  revenue:     { type: Number, default: 0 },
  newUsers:    { type: Number, default: 0 },
  cancelledOrders: { type: Number, default: 0 },
  profit:      { type: Number, default: 0 },
}, { collection: 'site_stats' });

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MODELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const m = n => mongoose.models[n];
const Order          = m('Order')          || mongoose.model('Order',          orderSchema);
const User           = m('User')           || mongoose.model('User',           userSchema);
const Product        = m('Product')        || mongoose.model('Product',        productSchema);
const Category       = m('Category')       || mongoose.model('Category',       categorySchema);
const Comment        = m('Comment')        || mongoose.model('Comment',        commentSchema);
const FlashSale      = m('FlashSale')      || mongoose.model('FlashSale',      flashSaleSchema);
const Bundle         = m('Bundle')         || mongoose.model('Bundle',         bundleSchema);
const LoyaltyTxn     = m('LoyaltyTxn')    || mongoose.model('LoyaltyTxn',     loyaltySchema);
const Referral       = m('Referral')       || mongoose.model('Referral',       referralSchema);
const AbandonedCart  = m('AbandonedCart')  || mongoose.model('AbandonedCart',  abandonedCartSchema);
const Newsletter     = m('Newsletter')     || mongoose.model('Newsletter',     newsletterSchema);
const Coupon         = m('Coupon')         || mongoose.model('Coupon',         couponSchema);
const SiteStats      = m('SiteStats')      || mongoose.model('SiteStats',      siteStatsSchema);
const Supplier       = m('Supplier')       || mongoose.model('Supplier',       supplierSchema);
const InventoryLog   = m('InventoryLog')   || mongoose.model('InventoryLog',   inventoryLogSchema);
const ReturnRequest  = m('ReturnRequest')  || mongoose.model('ReturnRequest',  returnRequestSchema);
const Notification   = m('Notification')  || mongoose.model('Notification',   notificationSchema);
const Affiliate      = m('Affiliate')      || mongoose.model('Affiliate',      affiliateSchema);
const SiteSettings   = m('SiteSettings')  || mongoose.model('SiteSettings',   siteSettingsSchema);

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SETTINGS HELPER — get/set site settings easily
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function getSetting(key, defaultVal = null) {
  const doc = await SiteSettings.findOne({ key }).lean();
  return doc ? doc.value : defaultVal;
}
async function setSetting(key, value, meta = {}) {
  return SiteSettings.findOneAndUpdate(
    { key },
    { key, value, ...meta },
    { upsert: true, new: true }
  );
}
async function getSettings(group) {
  const query = group ? { group } : {};
  const docs  = await SiteSettings.find(query).lean();
  return Object.fromEntries(docs.map(d => [d.key, d.value]));
}

module.exports = {
  connectDB,
  Order, User, Product, Category, Comment, FlashSale, Bundle,
  LoyaltyTxn, Referral, AbandonedCart, Newsletter, Coupon, SiteStats,
  Supplier, InventoryLog, ReturnRequest, Notification, Affiliate, SiteSettings,
  getSetting, setSetting, getSettings,
};
