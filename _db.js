/**
 * ══════════════════════════════════════════════════════
 *  SHOPLIXO — MongoDB Connection Helper
 *  Vercel Serverless Functions-এ connection reuse করে
 *  প্রতিটি function invocation-এ নতুন connection খোলে না
 * ══════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('❌ MONGODB_URI is not defined in environment variables');
}

// ── Connection Cache (Vercel-এ hot reuse) ──────────────
let cached = global._mongoCache;
if (!cached) {
  cached = global._mongoCache = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };
    cached.promise = mongoose.connect(MONGODB_URI, opts).then(m => m);
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SCHEMAS & MODELS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Order Schema ──────────────────────────────────────
const orderItemSchema = new mongoose.Schema({
  productId:  { type: String, required: true },
  name:       { type: String, required: true },
  price:      { type: Number, required: true },
  qty:        { type: Number, required: true, min: 1 },
  img:        { type: String, default: '' },
  size:       { type: String, default: '' },
  color:      { type: String, default: '' },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId:    { type: String, required: true, unique: true, index: true },
  customer: {
    name:     { type: String, required: true, trim: true },
    phone:    { type: String, required: true, trim: true },
    email:    { type: String, trim: true, lowercase: true, default: '' },
    address:  { type: String, required: true, trim: true },
    district: { type: String, required: true },
    note:     { type: String, default: '' },
  },
  items:      { type: [orderItemSchema], required: true },
  payment: {
    method:       { type: String, enum: ['bkash','nagad','rocket','upay','cod'], required: true },
    transactionId:{ type: String, default: '' },
    status:       { type: String, enum: ['pending','verified','failed'], default: 'pending' },
  },
  pricing: {
    subtotal:   { type: Number, required: true },
    shipping:   { type: Number, default: 60 },
    discount:   { type: Number, default: 0 },
    coupon:     { type: String, default: '' },
    total:      { type: Number, required: true },
  },
  status: {
    type: String,
    enum: ['pending','confirmed','processing','shipped','delivered','cancelled','refunded'],
    default: 'pending',
    index: true,
  },
  statusHistory: [{
    status:    String,
    note:      String,
    updatedBy: String,
    updatedAt: { type: Date, default: Date.now },
  }],
  tracking: {
    courier:    { type: String, default: '' },
    trackingId: { type: String, default: '' },
    estimatedDelivery: Date,
  },
  source:    { type: String, default: 'website' },
  ip:        { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, {
  timestamps: true,
  collection: 'orders',
});

// ── User Schema ────────────────────────────────────────
const addressSchema = new mongoose.Schema({
  label:    { type: String, default: 'Home' },
  address:  { type: String, required: true },
  district: { type: String, required: true },
  phone:    { type: String, default: '' },
  isDefault:{ type: Boolean, default: false },
}, { _id: true });

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  phone:    { type: String, required: true, unique: true, trim: true, index: true },
  email:    { type: String, trim: true, lowercase: true, sparse: true, index: true },
  password: { type: String, required: true, select: false },
  avatar:   { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  isVerified:{ type: Boolean, default: false },
  addresses:{ type: [addressSchema], default: [] },
  wishlist: { type: [String], default: [] },
  totalOrders:  { type: Number, default: 0 },
  totalSpent:   { type: Number, default: 0 },
  loyaltyPoints:{ type: Number, default: 0 },
  lastLogin:    { type: Date },
  otp:          { type: String, select: false },
  otpExpiry:    { type: Date, select: false },
}, {
  timestamps: true,
  collection: 'users',
});

// ── Newsletter Schema ──────────────────────────────────
const newsletterSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:      { type: String, trim: true, default: '' },
  isActive:  { type: Boolean, default: true },
  source:    { type: String, default: 'website' },
  couponSent:{ type: Boolean, default: false },
}, {
  timestamps: true,
  collection: 'newsletters',
});

// ── Coupon Schema ──────────────────────────────────────
const couponSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, uppercase: true, trim: true },
  type:        { type: String, enum: ['percent','flat'], default: 'percent' },
  discount:    { type: Number, required: true },
  minOrder:    { type: Number, default: 0 },
  maxUses:     { type: Number, default: 0 }, // 0 = unlimited
  usedCount:   { type: Number, default: 0 },
  usedBy:      { type: [String], default: [] },
  isActive:    { type: Boolean, default: true },
  expiresAt:   { type: Date },
  description: { type: String, default: '' },
}, {
  timestamps: true,
  collection: 'coupons',
});

// ── Product Schema (dynamic products) ─────────────────
const productSchema = new mongoose.Schema({
  productId:  { type: String, required: true, unique: true },
  name:       { type: String, required: true, trim: true },
  cat:        { type: String, required: true },
  price:      { type: Number, required: true },
  orig:       { type: Number },
  img:        { type: String, default: '' },
  images:     { type: [String], default: [] },
  badge:      { type: String, enum: ['hot','new','sale','sold'], default: 'new' },
  rating:     { type: Number, default: 5, min: 0, max: 5 },
  reviews:    { type: Number, default: 0 },
  stock:      { type: Number, default: 100 },
  viewers:    { type: Number, default: 5 },
  isFeatured: { type: Boolean, default: false },
  isNew:      { type: Boolean, default: true },
  isFlash:    { type: Boolean, default: false },
  isActive:   { type: Boolean, default: true },
  sizes:      { type: [String], default: [] },
  colors:     { type: [String], default: [] },
  material:   { type: String, default: '' },
  warranty:   { type: String, default: '' },
  sku:        { type: String, default: '' },
  tags:       { type: [String], default: [] },
  desc:       { type: String, default: '' },
  totalSold:  { type: Number, default: 0 },
}, {
  timestamps: true,
  collection: 'products',
});

// ── Models (Mongoose caches, safe to call multiple times) ─
const Order      = mongoose.models.Order      || mongoose.model('Order', orderSchema);
const User       = mongoose.models.User       || mongoose.model('User', userSchema);
const Newsletter = mongoose.models.Newsletter || mongoose.model('Newsletter', newsletterSchema);
const Coupon     = mongoose.models.Coupon     || mongoose.model('Coupon', couponSchema);
const Product    = mongoose.models.Product    || mongoose.model('Product', productSchema);

module.exports = { connectDB, Order, User, Newsletter, Coupon, Product };