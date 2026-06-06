/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/auth
 *
 *  POST /api/auth?action=register   → নতুন account তৈরি
 *  POST /api/auth?action=login      → Login করুন
 *  GET  /api/auth?action=profile    → Profile দেখুন (JWT লাগবে)
 * ══════════════════════════════════════════════════════════════
 */

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { connectDB, User } = require('../_db');
const {
    handleCors, isValidBDPhone, isValidEmail,
    sanitize, checkRateLimit, sendEmail, welcomeEmail,
} = require('../_helpers');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN HANDLER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    const action = req.query?.action || '';
    const ip     = req.headers['x-forwarded-for']?.split(',')[0] || '';

    /* ── REGISTER ────────────────────────────────────────────── */
    if (action === 'register' && req.method === 'POST') {
        if (!checkRateLimit(`reg_${ip}`, 5, 300000)) {
            return res.status(429).json({ ok: false, error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });
        }

        const b        = req.body || {};
        const name     = sanitize(b.name  || '', 100);
        const phone    = sanitize(b.phone || '', 20).replace(/\s+/g, '');
        const email    = sanitize(b.email || '', 150).toLowerCase();
        const password = String(b.password || '');

        if (!name || name.length < 2)
            return res.status(400).json({ ok: false, error: 'সঠিক নাম দিন! (কমপক্ষে ২ অক্ষর)' });
        if (!isValidBDPhone(phone))
            return res.status(400).json({ ok: false, error: 'সঠিক বাংলাদেশ ফোন নম্বর দিন! (01XXXXXXXXX)' });
        if (password.length < 8)
            return res.status(400).json({ ok: false, error: 'Password কমপক্ষে ৮ অক্ষর হতে হবে!' });
        if (email && !isValidEmail(email))
            return res.status(400).json({ ok: false, error: 'সঠিক Email দিন!' });

        try {
            await connectDB();

            /* Check existing */
            const existing = await User.findOne({
                $or: [{ phone }, ...(email ? [{ email }] : [])],
            });
            if (existing) {
                const conflict = existing.phone === phone ? 'এই ফোন নম্বর' : 'এই Email';
                return res.status(409).json({ ok: false, error: `${conflict} দিয়ে ইতিমধ্যে account আছে!` });
            }

            /* Hash password */
            const hashed = await bcrypt.hash(password, 12);

            /* Save user */
            const user = await User.create({
                name, phone, email, password: hashed,
            });

            /* Generate JWT */
            const token = jwt.sign(
                { id: user._id, phone: user.phone },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES || '7d' }
            );

            /* Send welcome email (non-blocking) */
            if (email) {
                sendEmail(email, `🎉 স্বাগতম ${name}! — Shoplixo Account তৈরি হয়েছে`, welcomeEmail({ name, email }))
                    .catch(() => {});
            }

            return res.status(201).json({
                ok: true,
                token,
                user: {
                    id:    user._id,
                    name:  user.name,
                    phone: user.phone,
                    email: user.email,
                },
            });

        } catch (err) {
            console.error('Register error:', err);
            return res.status(500).json({ ok: false, error: 'Server error, আবার চেষ্টা করুন' });
        }
    }

    /* ── LOGIN ───────────────────────────────────────────────── */
    if (action === 'login' && req.method === 'POST') {
        if (!checkRateLimit(`login_${ip}`, 10, 300000)) {
            return res.status(429).json({ ok: false, error: 'অনেক চেষ্টা! ৫ মিনিট পরে আবার করুন।' });
        }

        const b          = req.body || {};
        const identifier = sanitize(b.identifier || b.phone || b.email || '', 150);
        const password   = String(b.password || '');

        if (!identifier || !password)
            return res.status(400).json({ ok: false, error: 'Phone/Email এবং Password দিন!' });

        try {
            await connectDB();

            /* Find user by phone OR email — include password field */
            const user = await User.findOne({
                $or: [
                    { phone: identifier },
                    { email: identifier.toLowerCase() },
                ],
                isActive: true,
            }).select('+password');

            if (!user) {
                return res.status(401).json({ ok: false, error: 'ভুল ID বা Password!' });
            }

            /* Compare password */
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return res.status(401).json({ ok: false, error: 'ভুল ID বা Password!' });
            }

            /* Update last login */
            user.lastLogin = new Date();
            await user.save();

            /* Generate JWT */
            const token = jwt.sign(
                { id: user._id, phone: user.phone },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES || '7d' }
            );

            return res.json({
                ok: true,
                token,
                user: {
                    id:            user._id,
                    name:          user.name,
                    phone:         user.phone,
                    email:         user.email,
                    totalOrders:   user.totalOrders,
                    loyaltyPoints: user.loyaltyPoints,
                },
            });

        } catch (err) {
            console.error('Login error:', err);
            return res.status(500).json({ ok: false, error: 'Server error, আবার চেষ্টা করুন' });
        }
    }

    /* ── PROFILE (JWT protected) ─────────────────────────────── */
    if (action === 'profile' && req.method === 'GET') {
        const auth  = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;

        if (!token) return res.status(401).json({ ok: false, error: 'Login করুন!' });

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            await connectDB();
            const user = await User.findById(decoded.id).select('-password -otp -otpExpiry');
            if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });

            return res.json({ ok: true, user });
        } catch {
            return res.status(401).json({ ok: false, error: 'Token invalid বা expire হয়ে গেছে' });
        }
    }

    /* ── UPDATE PROFILE ──────────────────────────────────────── */
    if (action === 'update' && req.method === 'POST') {
        const auth  = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
        if (!token) return res.status(401).json({ ok: false, error: 'Login করুন!' });

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const b       = req.body || {};
            const updates = {};

            if (b.name)  updates.name  = sanitize(b.name, 100);
            if (b.email) updates.email = sanitize(b.email, 150).toLowerCase();

            await connectDB();
            const user = await User.findByIdAndUpdate(decoded.id, updates, { new: true })
                .select('-password');
            return res.json({ ok: true, user });
        } catch {
            return res.status(401).json({ ok: false, error: 'Token invalid' });
        }
    }

    /* ── CHANGE PASSWORD ─────────────────────────────────────── */
    if (action === 'password' && req.method === 'POST') {
        const auth  = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
        if (!token) return res.status(401).json({ ok: false, error: 'Login করুন!' });

        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword)
            return res.status(400).json({ ok: false, error: 'পুরানো ও নতুন password দিন!' });
        if (String(newPassword).length < 8)
            return res.status(400).json({ ok: false, error: 'নতুন password কমপক্ষে ৮ অক্ষর!' });

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            await connectDB();
            const user = await User.findById(decoded.id).select('+password');
            if (!user) return res.status(404).json({ ok: false, error: 'User পাওয়া যায়নি' });

            const match = await bcrypt.compare(String(oldPassword), user.password);
            if (!match) return res.status(401).json({ ok: false, error: 'পুরানো password ভুল!' });

            user.password = await bcrypt.hash(String(newPassword), 12);
            await user.save();
            return res.json({ ok: true, message: 'Password পরিবর্তন হয়েছে!' });
        } catch {
            return res.status(401).json({ ok: false, error: 'Token invalid' });
        }
    }

    return res.status(400).json({ ok: false, error: 'Invalid action. Use: login, register, profile, update, password' });
};
