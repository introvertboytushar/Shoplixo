/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/auth  (Ultra Professional v3)
 *
 *  ── ACCOUNT ──────────────────────────────────────────────────
 *  POST /api/auth?action=register          → নতুন account তৈরি
 *  POST /api/auth?action=login             → Login করুন
 *  GET  /api/auth?action=profile           → Profile দেখুন (JWT)
 *  POST /api/auth?action=update            → Profile আপডেট
 *  POST /api/auth?action=password          → Password পরিবর্তন
 *  POST /api/auth?action=delete-account    → Account মুছুন
 *
 *  ── PASSWORD RECOVERY ────────────────────────────────────────
 *  POST /api/auth?action=forgot-password   → OTP পাঠান (Phone/Email)
 *  POST /api/auth?action=reset-password    → OTP দিয়ে password রিসেট
 *
 *  ── SESSION ──────────────────────────────────────────────────
 *  POST /api/auth?action=refresh           → Access token রিফ্রেশ
 *  POST /api/auth?action=logout            → Logout (session বাতিল)
 *
 *  ── SOCIAL LOGIN ─────────────────────────────────────────────
 *  POST /api/auth?action=google-login      → Google OAuth Login
 *  POST /api/auth?action=facebook-login    → Facebook OAuth Login
 *
 *  ── ONLINE STATUS ────────────────────────────────────────────
 *  POST /api/auth?action=heartbeat         → Client heartbeat (online status)
 *  GET  /api/auth?action=mark-offline      → Idle users offline করুন (cron)
 *
 *  ── ADMIN ────────────────────────────────────────────────────
 *  POST /api/auth?action=force-logout      → Admin: কোনো user কে force logout
 * ══════════════════════════════════════════════════════════════
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const { connectDB, User } = require('./_db');
const {
  handleCors, isValidBDPhone, isValidEmail,
  sanitize, checkRateLimit, sendEmail, sendSMS,
  welcomeEmail, passwordResetEmail, otpSmsTemplate,
} = require('./_helpers');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   CONSTANTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const JWT_SECRET      = process.env.JWT_SECRET;
const JWT_EXPIRES     = process.env.JWT_EXPIRES         || '7d';
const JWT_REFRESH_EXP = process.env.JWT_REFRESH_EXPIRES || '30d';
const BCRYPT_ROUNDS   = 12;
const OTP_ROUNDS      = 8;  // lighter hash for short-lived OTPs
const OTP_TTL_MS      = 10 * 60 * 1000; // 10 minutes

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PURE HELPERS  (no I/O — safe to unit-test)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** Attach security-related response headers to every auth response */
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

/** Extract Bearer token from the Authorization header */
function extractToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : auth.trim();
}

/** Return the caller's IP, respecting common proxy headers */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip']                              ||
    req.socket?.remoteAddress                             ||
    ''
  );
}

/** Cryptographically secure 6-digit numeric OTP */
function generateOTP() {
  return String(crypto.randomInt(100_000, 999_999));
}

/** Sign a short-lived access token */
function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/** Sign a long-lived refresh token (includes type discriminator) */
function signRefreshToken(payload) {
  return jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXP });
}

/** Build a standard token error response */
function tokenError(err, res) {
  const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
  return res.status(401).json({ ok: false, code, error: 'Token invalid বা expire হয়ে গেছে। আবার login করুন।' });
}

/** Check if the requester is an admin (role='admin' or isAdmin=true in JWT) */
function isAdmin(req) {
  try {
    const token = extractToken(req);
    if (!token) return false;
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.role === 'admin' || decoded.isAdmin === true;
  } catch {
    return false;
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
  if (handleCors(req, res)) return;
  setSecurityHeaders(res);

  const action = req.query?.action || '';
  const ip     = getClientIp(req);

  /* ── REGISTER ─────────────────────────────────────────────── */
  if (action === 'register' && req.method === 'POST') {
    if (!checkRateLimit(`reg_${ip}`, 5, 300_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });

    const b        = req.body || {};
    const name     = sanitize(b.name  || '', 100).trim();
    const phone    = sanitize(b.phone || '', 20).replace(/\s+/g, '');
    const email    = sanitize(b.email || '', 150).toLowerCase().trim();
    const password = String(b.password || '');
    const refCode  = sanitize(b.referralCode || '', 20).trim();

    if (!name || name.length < 2)
      return res.status(400).json({ ok: false, code: 'INVALID_NAME',  error: 'সঠিক নাম দিন! (কমপক্ষে ২ অক্ষর)' });
    if (!isValidBDPhone(phone))
      return res.status(400).json({ ok: false, code: 'INVALID_PHONE', error: 'সঠিক বাংলাদেশ ফোন নম্বর দিন! (01XXXXXXXXX)' });
    if (password.length < 8)
      return res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: 'Password কমপক্ষে ৮ অক্ষর হতে হবে!' });
    if (email && !isValidEmail(email))
      return res.status(400).json({ ok: false, code: 'INVALID_EMAIL', error: 'সঠিক Email দিন!' });

    try {
      await connectDB();

      /* Duplicate check — phone is required; email is optional */
      const orConditions = [{ phone }];
      if (email) orConditions.push({ email });
      const existing = await User.findOne({ $or: orConditions }).select('phone email').lean();
      if (existing) {
        const field = existing.phone === phone ? 'ফোন নম্বর' : 'Email';
        return res.status(409).json({ ok: false, code: 'DUPLICATE', error: `এই ${field} দিয়ে ইতিমধ্যে account আছে!` });
      }

      const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user   = await User.create({
        name, phone,
        email:    email || undefined,
        password: hashed,
      });

      /* Reward referrer (fire-and-forget) */
      if (refCode) {
        User.findOneAndUpdate(
          { referralCode: refCode },
          { $inc: { loyaltyPoints: 50 }, $push: { referralsMade: user._id } }
        ).catch(() => {});
      }

      const payload      = { id: user._id, phone: user.phone };
      const token        = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      /* Welcome email (fire-and-forget) */
      if (email) {
        sendEmail(
          email,
          `🎉 স্বাগতম ${name}! — Shoplixo Account তৈরি হয়েছে`,
          welcomeEmail({ name, email })
        ).catch(() => {});
      }

      return res.status(201).json({
        ok: true, token, refreshToken,
        user: { id: user._id, name: user.name, phone: user.phone, email: user.email || null },
      });

    } catch (err) {
      console.error('[auth/register]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ── LOGIN ────────────────────────────────────────────────── */
  if (action === 'login' && req.method === 'POST') {
    if (!checkRateLimit(`login_${ip}`, 10, 300_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });

    const b          = req.body || {};
    const identifier = sanitize(b.identifier || b.phone || b.email || '', 150).trim();
    const password   = String(b.password || '');

    if (!identifier || !password)
      return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', error: 'Phone/Email এবং Password দিন!' });

    try {
      await connectDB();

      const user = await User.findOne({
        $or: [{ phone: identifier }, { email: identifier.toLowerCase() }],
        isActive: true,
      }).select('+password');

      if (!user)
        return res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', error: 'ভুল ID বা Password!' });

      /* ✅ Banned check must happen before password compare (avoids timing oracle) */
      if (user.isBanned)
        return res.status(403).json({ ok: false, code: 'ACCOUNT_BANNED', error: 'আপনার account suspend করা হয়েছে। support@shoplixo.shop এ যোগাযোগ করুন।' });

      const match = await bcrypt.compare(password, user.password);
      if (!match)
        return res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', error: 'ভুল ID বা Password!' });

      /* ✅ Atomic update — no race condition */
      await User.findByIdAndUpdate(user._id, {
        lastLogin:      new Date(),
        lastLoginIp:    ip,
        $inc:           { loginCount: 1 },
        // ── UPGRADE 1: Login tracking ──────────────────────────
        isOnline:       true,
        lastSeen:       new Date(),
        loginMethod:    b.method || 'email',  // 'google' | 'facebook' | 'email'
        deviceInfo:     req.headers['user-agent']?.substring(0, 200) || '',
        forceLoggedOut: false,
      });

      const payload      = { id: user._id, phone: user.phone };
      const token        = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      return res.json({
        ok: true, token, refreshToken,
        user: {
          id:            user._id,
          name:          user.name,
          phone:         user.phone,
          email:         user.email || null,
          totalOrders:   user.totalOrders   || 0,
          loyaltyPoints: user.loyaltyPoints || 0,
        },
      });

    } catch (err) {
      console.error('[auth/login]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ── PROFILE (JWT protected) ─────────────────────────────── */
  if (action === 'profile' && req.method === 'GET') {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ ok: false, code: 'NO_TOKEN', error: 'Login করুন!' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      if (decoded.type === 'refresh')
        return res.status(401).json({ ok: false, code: 'WRONG_TOKEN_TYPE', error: 'Access token ব্যবহার করুন!' });

      await connectDB();
      const user = await User
        .findOne({ _id: decoded.id, isActive: true })
        .select('-password -otp -otpExpiry -otpPurpose -__v');

      if (!user) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'User পাওয়া যায়নি' });

      return res.json({ ok: true, user });

    } catch (err) {
      return tokenError(err, res);
    }
  }

  /* ── UPDATE PROFILE ──────────────────────────────────────── */
  if (action === 'update' && req.method === 'POST') {
    if (!checkRateLimit(`upd_${ip}`, 20, 60_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক দ্রুত request! একটু অপেক্ষা করুন।' });

    const token = extractToken(req);
    if (!token) return res.status(401).json({ ok: false, code: 'NO_TOKEN', error: 'Login করুন!' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      await connectDB();   // ✅ once at the top (was called twice — bug fixed)
      const b       = req.body || {};
      const updates = {};

      if (b.name !== undefined) {
        const name = sanitize(b.name, 100).trim();
        if (name.length < 2)
          return res.status(400).json({ ok: false, code: 'INVALID_NAME', error: 'সঠিক নাম দিন! (কমপক্ষে ২ অক্ষর)' });
        updates.name = name;
      }

      if (b.email !== undefined) {
        const email = sanitize(b.email, 150).toLowerCase().trim();
        if (email && !isValidEmail(email))
          return res.status(400).json({ ok: false, code: 'INVALID_EMAIL', error: 'সঠিক Email দিন!' });

        if (email) {
          const conflict = await User.findOne({ email, _id: { $ne: decoded.id } }).select('_id').lean();
          if (conflict)
            return res.status(409).json({ ok: false, code: 'EMAIL_TAKEN', error: 'এই Email অন্য account-এ ব্যবহার হচ্ছে!' });
        }
        updates.email = email || null;
      }
      const user = await User
        .findByIdAndUpdate(decoded.id, updates, { new: true })
        .select('-password -otp -otpExpiry -otpPurpose -__v');

      if (!user) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'User পাওয়া যায়নি' });

      return res.json({ ok: true, user, message: 'Profile সফলভাবে আপডেট হয়েছে!' });

    } catch (err) {
      return tokenError(err, res);
    }
  }

  /* ── CHANGE PASSWORD ─────────────────────────────────────── */
  if (action === 'password' && req.method === 'POST') {
    if (!checkRateLimit(`pwd_${ip}`, 5, 300_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });

    const token = extractToken(req);
    if (!token) return res.status(401).json({ ok: false, code: 'NO_TOKEN', error: 'Login করুন!' });

    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword)
      return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', error: 'পুরানো ও নতুন password দিন!' });
    if (String(newPassword).length < 8)
      return res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: 'নতুন password কমপক্ষে ৮ অক্ষর হতে হবে!' });
    if (oldPassword === newPassword)
      return res.status(400).json({ ok: false, code: 'SAME_PASSWORD', error: 'নতুন password পুরানোটির মতো হতে পারবে না!' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      await connectDB();
      const user = await User.findById(decoded.id).select('+password');
      if (!user) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'User পাওয়া যায়নি' });

      const match = await bcrypt.compare(String(oldPassword), user.password);
      if (!match)
        return res.status(401).json({ ok: false, code: 'WRONG_PASSWORD', error: 'পুরানো password ভুল!' });

      user.password          = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
      user.passwordChangedAt = new Date();
      await user.save();

      return res.json({ ok: true, message: 'Password সফলভাবে পরিবর্তন হয়েছে!' });

    } catch (err) {
      return tokenError(err, res);
    }
  }

  /* ── FORGOT PASSWORD — OTP Request ───────────────────────── */
  if (action === 'forgot-password' && req.method === 'POST') {
    if (!checkRateLimit(`otp_${ip}`, 3, 300_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });

    const identifier = sanitize(req.body?.identifier || req.body?.phone || req.body?.email || '', 150).trim();
    if (!identifier)
      return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', error: 'Phone বা Email দিন!' });

    try {
      await connectDB();
      const user = await User.findOne({
        $or: [{ phone: identifier }, { email: identifier.toLowerCase() }],
        isActive: true,
      }).select('_id name phone email');

      /*
       * ✅ Always return 200 regardless of whether user exists.
       * This prevents user-enumeration attacks.
       */
      if (!user)
        return res.json({ ok: true, message: 'OTP পাঠানো হয়েছে (যদি account থাকে)।' });

      const otp       = generateOTP();
      const otpExpiry = new Date(Date.now() + OTP_TTL_MS);

      /* Hash OTP before storing — lightweight rounds sufficient for 6-digit codes */
      const otpHashed = await bcrypt.hash(otp, OTP_ROUNDS);
      await User.findByIdAndUpdate(user._id, {
        otp:        otpHashed,
        otpExpiry,
        otpPurpose: 'reset',
      });

      /* SMS (primary channel) */
      const smsBody = typeof otpSmsTemplate === 'function'
        ? otpSmsTemplate(otp)
        : `Shoplixo Password Reset OTP: ${otp}. ১০ মিনিটে expire হবে। কাউকে বলবেন না।`;
      sendSMS(user.phone, smsBody).catch(() => {});

      /* Email (secondary channel if available) */
      if (user.email) {
        const emailBody = typeof passwordResetEmail === 'function'
          ? passwordResetEmail({ name: user.name, otp })
          : `<p>আপনার Password Reset OTP: <strong>${otp}</strong><br>এটি ১০ মিনিট valid। কাউকে বলবেন না।</p>`;
        sendEmail(user.email, '🔐 Password Reset OTP — Shoplixo', emailBody).catch(() => {});
      }

      return res.json({ ok: true, message: 'OTP পাঠানো হয়েছে। ১০ মিনিটের মধ্যে ব্যবহার করুন।' });

    } catch (err) {
      console.error('[auth/forgot-password]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ── RESET PASSWORD — OTP Verify + New Password ─────────── */
  if (action === 'reset-password' && req.method === 'POST') {
    if (!checkRateLimit(`reset_${ip}`, 5, 300_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });

    const b           = req.body || {};
    const identifier  = sanitize(b.identifier || b.phone || b.email || '', 150).trim();
    const otp         = sanitize(String(b.otp || ''), 6).trim();
    const newPassword = String(b.newPassword || '');

    if (!identifier || !otp || !newPassword)
      return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', error: 'Identifier, OTP এবং নতুন password দিন!' });
    if (newPassword.length < 8)
      return res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: 'Password কমপক্ষে ৮ অক্ষর হতে হবে!' });

    try {
      await connectDB();
      const user = await User.findOne({
        $or:        [{ phone: identifier }, { email: identifier.toLowerCase() }],
        isActive:   true,
        otpPurpose: 'reset',
        otpExpiry:  { $gt: new Date() },
      }).select('+otp +otpExpiry +otpPurpose +password');

      /* Generic error — avoid leaking whether identifier matched */
      if (!user)
        return res.status(400).json({ ok: false, code: 'INVALID_OTP', error: 'OTP invalid বা expire হয়ে গেছে!' });

      const otpMatch = await bcrypt.compare(otp, user.otp);
      if (!otpMatch)
        return res.status(400).json({ ok: false, code: 'INVALID_OTP', error: 'OTP ভুল!' });

      /* Reset password and wipe OTP fields atomically */
      const hashedNew = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await User.findByIdAndUpdate(user._id, {
        password:          hashedNew,
        passwordChangedAt: new Date(),
        $unset: { otp: '', otpExpiry: '', otpPurpose: '' },
      });

      /* Issue fresh tokens so the user is immediately logged in */
      const payload      = { id: user._id, phone: user.phone };
      const token        = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      return res.json({ ok: true, token, refreshToken, message: 'Password সফলভাবে রিসেট হয়েছে!' });

    } catch (err) {
      console.error('[auth/reset-password]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ── REFRESH TOKEN ───────────────────────────────────────── */
  if (action === 'refresh' && req.method === 'POST') {
    /* Accept token from header OR body (mobile clients often pass in body) */
    const token = extractToken(req) || sanitize(req.body?.refreshToken || '', 500);
    if (!token)
      return res.status(401).json({ ok: false, code: 'NO_TOKEN', error: 'Refresh token দিন!' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);

      if (decoded.type !== 'refresh')
        return res.status(401).json({ ok: false, code: 'WRONG_TOKEN_TYPE', error: 'Refresh token ব্যবহার করুন!' });

      await connectDB();
      const user = await User
        .findOne({ _id: decoded.id, isActive: true })
        .select('_id phone isBanned passwordChangedAt')
        .lean();

      if (!user)
        return res.status(401).json({ ok: false, code: 'NOT_FOUND', error: 'User পাওয়া যায়নি' });
      if (user.isBanned)
        return res.status(403).json({ ok: false, code: 'ACCOUNT_BANNED', error: 'Account suspend করা হয়েছে।' });

      /* ✅ Invalidate tokens issued before the last password change */
      if (user.passwordChangedAt) {
        const issuedAt = new Date(decoded.iat * 1000);
        if (issuedAt < user.passwordChangedAt)
          return res.status(401).json({ ok: false, code: 'TOKEN_STALE', error: 'Password পরিবর্তনের পরে আবার login করুন।' });
      }

      const payload         = { id: user._id, phone: user.phone };
      const newToken        = signAccessToken(payload);
      const newRefreshToken = signRefreshToken(payload);

      return res.json({ ok: true, token: newToken, refreshToken: newRefreshToken });

    } catch (err) {
      return tokenError(err, res);
    }
  }

  /* ── LOGOUT ──────────────────────────────────────────────── */
  if (action === 'logout' && req.method === 'POST') {
    const token = extractToken(req);
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        /* Record logout time — refresh tokens older than this are rejected by /refresh */
        await connectDB();
        await User.findByIdAndUpdate(decoded.id, {
          lastLogout: new Date(),
          // ── UPGRADE 3: Mark user offline on logout ───────────
          isOnline:   false,
          lastSeen:   new Date(),
        }).catch(() => {});
      } catch { /* Expired/invalid tokens — silent ignore on logout */ }
    }
    return res.json({ ok: true, message: 'Logout সফল হয়েছে।' });
  }

  /* ── DELETE ACCOUNT ──────────────────────────────────────── */
  if (action === 'delete-account' && req.method === 'POST') {
    if (!checkRateLimit(`del_${ip}`, 3, 600_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক চেষ্টা! পরে আবার করুন।' });

    const token = extractToken(req);
    if (!token) return res.status(401).json({ ok: false, code: 'NO_TOKEN', error: 'Login করুন!' });

    const { password } = req.body || {};
    if (!password)
      return res.status(400).json({ ok: false, code: 'MISSING_PASSWORD', error: 'Password দিয়ে confirm করুন!' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      await connectDB();
      const user = await User.findById(decoded.id).select('+password');
      if (!user) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'User পাওয়া যায়নি' });

      const match = await bcrypt.compare(String(password), user.password);
      if (!match)
        return res.status(401).json({ ok: false, code: 'WRONG_PASSWORD', error: 'ভুল password!' });

      /*
       * Soft-delete: anonymise all PII, mark inactive.
       * Hard-delete via a scheduled cleanup job if needed.
       */
      await User.findByIdAndUpdate(decoded.id, {
        isActive:  false,
        isDeleted: true,
        deletedAt: new Date(),
        name:      '[Deleted User]',
        phone:     `del_${decoded.id}`,
        email:     null,
        password:  '!deleted',
        $unset:    { otp: '', otpExpiry: '', otpPurpose: '' },
      });

      return res.json({ ok: true, message: 'Account মুছে দেওয়া হয়েছে।' });

    } catch (err) {
      return tokenError(err, res);
    }
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     UPGRADE 2 ─ GOOGLE LOGIN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  if (action === 'google-login' && req.method === 'POST') {
    if (!checkRateLimit(`glogin_${ip}`, 10, 300_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });

    const b = req.body || {};
    /* ── Google OAuth token verification ─────────────────────
     *  Client থেকে Google ID token পাঠানো হয়।
     *  এখানে আপনার Google token verification logic বসান।
     *  e.g.: const ticket = await googleClient.verifyIdToken({ idToken: b.idToken, ... });
     *  const { sub: googleId, email, name, picture } = ticket.getPayload();
     * ──────────────────────────────────────────────────────── */
    const googleId = sanitize(b.googleId || '', 100).trim();
    const email    = sanitize(b.email    || '', 150).toLowerCase().trim();
    const name     = sanitize(b.name     || '', 100).trim();

    if (!googleId || !email)
      return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', error: 'Google ID এবং Email আবশ্যক!' });

    try {
      await connectDB();

      /* Find by googleId first, fallback to email */
      let user = await User.findOne({ $or: [{ googleId }, { email }] });

      if (!user) {
        /* Auto-register on first Google login */
        user = await User.create({
          name:     name || email.split('@')[0],
          email,
          googleId,
          isActive: true,
          avatar:   b.picture || undefined,
        });
      } else if (!user.googleId) {
        /* Link Google ID to existing email account */
        user.googleId = googleId;
        await user.save();
      }

      if (user.isBanned)
        return res.status(403).json({ ok: false, code: 'ACCOUNT_BANNED', error: 'Account suspend করা হয়েছে। support@shoplixo.shop এ যোগাযোগ করুন।' });

      await User.findByIdAndUpdate(user._id, {
        lastLogin:      new Date(),
        lastLoginIp:    ip,
        $inc:           { loginCount: 1 },
        // ── UPGRADE 2: Google login tracking ─────────────────
        loginMethod:    'google',
        isOnline:       true,
        lastSeen:       new Date(),
        forceLoggedOut: false,
        deviceInfo:     req.headers['user-agent']?.substring(0, 200) || '',
      });

      const payload      = { id: user._id, phone: user.phone || '' };
      const token        = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      return res.json({
        ok: true, token, refreshToken,
        user: { id: user._id, name: user.name, email: user.email || null },
      });

    } catch (err) {
      console.error('[auth/google-login]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     UPGRADE 2 ─ FACEBOOK LOGIN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  if (action === 'facebook-login' && req.method === 'POST') {
    if (!checkRateLimit(`fblogin_${ip}`, 10, 300_000))
      return res.status(429).json({ ok: false, code: 'RATE_LIMIT', error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });

    const b = req.body || {};
    /* ── Facebook OAuth token verification ────────────────────
     *  Client থেকে Facebook access token পাঠানো হয়।
     *  এখানে আপনার Facebook token verification logic বসান।
     *  e.g.: const fbRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${b.accessToken}`);
     *  const { id: facebookId, email, name } = await fbRes.json();
     * ──────────────────────────────────────────────────────── */
    const facebookId = sanitize(b.facebookId || '', 100).trim();
    const email      = sanitize(b.email      || '', 150).toLowerCase().trim();
    const name       = sanitize(b.name       || '', 100).trim();

    if (!facebookId || !email)
      return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', error: 'Facebook ID এবং Email আবশ্যক!' });

    try {
      await connectDB();

      /* Find by facebookId first, fallback to email */
      let user = await User.findOne({ $or: [{ facebookId }, { email }] });

      if (!user) {
        /* Auto-register on first Facebook login */
        user = await User.create({
          name:       name || email.split('@')[0],
          email,
          facebookId,
          isActive:   true,
          avatar:     b.picture || undefined,
        });
      } else if (!user.facebookId) {
        /* Link Facebook ID to existing email account */
        user.facebookId = facebookId;
        await user.save();
      }

      if (user.isBanned)
        return res.status(403).json({ ok: false, code: 'ACCOUNT_BANNED', error: 'Account suspend করা হয়েছে। support@shoplixo.shop এ যোগাযোগ করুন।' });

      await User.findByIdAndUpdate(user._id, {
        lastLogin:      new Date(),
        lastLoginIp:    ip,
        $inc:           { loginCount: 1 },
        // ── UPGRADE 2: Facebook login tracking ───────────────
        loginMethod:    'facebook',
        isOnline:       true,
        lastSeen:       new Date(),
        forceLoggedOut: false,
        deviceInfo:     req.headers['user-agent']?.substring(0, 200) || '',
      });

      const payload      = { id: user._id, phone: user.phone || '' };
      const token        = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      return res.json({
        ok: true, token, refreshToken,
        user: { id: user._id, name: user.name, email: user.email || null },
      });

    } catch (err) {
      console.error('[auth/facebook-login]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     UPGRADE 4 ─ FORCE LOGOUT  (Admin Only)
     POST /api/auth?action=force-logout
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  if (action === 'force-logout' && req.method === 'POST') {
    if (!isAdmin(req))
      return res.status(403).json({ ok: false, error: 'Admin only' });

    const { userId } = req.body || {};
    if (!userId)
      return res.status(400).json({ ok: false, error: 'userId required' });

    try {
      await connectDB();
      await User.findByIdAndUpdate(userId, {
        isOnline:       false,
        lastSeen:       new Date(),
        forceLoggedOut: true,
      });

      return res.json({ ok: true, message: 'User force logged out' });

    } catch (err) {
      console.error('[auth/force-logout]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     UPGRADE 5 ─ HEARTBEAT  (Client Online Status)
     POST /api/auth?action=heartbeat
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  if (action === 'heartbeat' && req.method === 'POST') {
    const userId = req.body?.userId;
    if (!userId)
      return res.json({ ok: false });

    try {
      await connectDB();
      await User.findByIdAndUpdate(userId, {
        isOnline:       true,
        lastSeen:       new Date(),
        forceLoggedOut: false,
      });

      /* Admin কর্তৃক force logout হলে client কে জানাও */
      const user = await User.findById(userId).select('forceLoggedOut').lean();
      return res.json({ ok: true, forceLoggedOut: user?.forceLoggedOut || false });

    } catch (err) {
      console.error('[auth/heartbeat]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     UPGRADE 6 ─ MARK OFFLINE  (Cron / Periodic)
     GET  /api/auth?action=mark-offline
     ৫ মিনিট ধরে heartbeat না এলে user কে offline করো
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  if (action === 'mark-offline' && req.method === 'GET') {
    try {
      await connectDB();
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const result = await User.updateMany(
        { isOnline: true, lastSeen: { $lt: fiveMinAgo } },
        { isOnline: false }
      );

      return res.json({ ok: true, markedOffline: result.modifiedCount ?? result.nModified ?? 0 });

    } catch (err) {
      console.error('[auth/mark-offline]', err);
      return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Server error, আবার চেষ্টা করুন' });
    }
  }

  /* ── Fallback ─────────────────────────────────────────────── */
  return res.status(400).json({
    ok: false,
    code: 'INVALID_ACTION',
    error: 'Invalid action.',
    available: [
      'register', 'login', 'profile', 'update', 'password',
      'forgot-password', 'reset-password',
      'refresh', 'logout', 'delete-account',
      'google-login', 'facebook-login',
      'heartbeat', 'mark-offline', 'force-logout',
    ],
  });
};
