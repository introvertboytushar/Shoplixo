/**
 * ══════════════════════════════════════════════════════════════
 *  SHOPLIXO — /api/notifications
 *  User Notification System
 *
 *  GET  /api/notifications              → আমার notifications
 *  POST /api/notifications?action=read  → Mark as read
 *  POST /api/notifications?action=read-all → Mark all read
 *  GET  /api/notifications?action=count → Unread count
 *
 *  Admin:
 *  POST /api/notifications?action=broadcast → সবাইকে notify
 *  GET  /api/notifications?action=all       → All notifications
 * ══════════════════════════════════════════════════════════════
 */
const { connectDB, Notification, User } = require('../_db');
const { handleCors, isAdmin, verifyToken, sanitize } = require('../_helpers');

module.exports = async (req, res) => {
  if (handleCors(req, res)) return;

  const action  = req.query?.action || '';
  const decoded = verifyToken(req);
  const admin   = isAdmin(req);

  if (!decoded && !admin) {
    return res.status(401).json({ ok: false, error: 'Login করুন' });
  }

  try {
    await connectDB();

    /* ── GET: My Notifications ────────────────────────────────── */
    if (req.method === 'GET' && !action) {
      const { page = 1 } = req.query;
      const skip = (parseInt(page) - 1) * 20;

      const query = decoded
        ? { $or: [{ userId: decoded.id }, { isGlobal: true }] }
        : { isGlobal: true };

      const [notifications, total, unread] = await Promise.all([
        Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(20).lean(),
        Notification.countDocuments(query),
        Notification.countDocuments({ ...query, isRead: false }),
      ]);

      return res.json({ ok: true, notifications, total, unread, page: parseInt(page) });
    }

    /* ── GET: Unread Count ────────────────────────────────────── */
    if (req.method === 'GET' && action === 'count') {
      const query = decoded
        ? { $or: [{ userId: decoded.id }, { isGlobal: true }], isRead: false }
        : { isGlobal: true, isRead: false };

      const count = await Notification.countDocuments(query);
      return res.json({ ok: true, count });
    }

    /* ── GET: Admin — All ─────────────────────────────────────── */
    if (req.method === 'GET' && action === 'all') {
      if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { page = 1, type } = req.query;
      const skip  = (parseInt(page) - 1) * 30;
      const query = {};
      if (type) query.type = type;

      const [notifications, total] = await Promise.all([
        Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(30).lean(),
        Notification.countDocuments(query),
      ]);
      return res.json({ ok: true, notifications, total });
    }

    /* ── POST: Mark as Read ───────────────────────────────────── */
    if (req.method === 'POST' && action === 'read') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'ID দিন' });

      const notif = await Notification.findByIdAndUpdate(id, { isRead: true }, { new: true });
      if (!notif) return res.status(404).json({ ok: false, error: 'পাওয়া যায়নি' });
      return res.json({ ok: true });
    }

    /* ── POST: Mark All Read ──────────────────────────────────── */
    if (req.method === 'POST' && action === 'read-all') {
      if (!decoded) return res.status(401).json({ ok: false, error: 'Login করুন' });

      await Notification.updateMany(
        { $or: [{ userId: decoded.id }, { isGlobal: true }], isRead: false },
        { isRead: true }
      );
      return res.json({ ok: true, message: 'সব notification পড়া হয়েছে' });
    }

    /* ── POST: Broadcast (Admin) ──────────────────────────────── */
    if (req.method === 'POST' && action === 'broadcast') {
      if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });

      const b = req.body || {};
      if (!b.title || !b.message) {
        return res.status(400).json({ ok: false, error: 'Title ও message দিন' });
      }

      const notif = await Notification.create({
        type:     b.type || 'promo',
        title:    sanitize(b.title, 100),
        message:  sanitize(b.message, 500),
        icon:     b.icon || '📢',
        link:     sanitize(b.link || '', 200),
        isGlobal: true,
        channel:  b.channel || 'app',
      });

      return res.json({ ok: true, notification: notif, message: '✅ Broadcast পাঠানো হয়েছে!' });
    }

    /* ── POST: Send to Specific User (Admin) ──────────────────── */
    if (req.method === 'POST' && action === 'send') {
      if (!admin) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { userId, title, message, type, link, icon } = req.body || {};
      if (!userId || !title || !message) {
        return res.status(400).json({ ok: false, error: 'userId, title, message দিন' });
      }

      const notif = await Notification.create({
        userId, type: type || 'system',
        title:   sanitize(title, 100),
        message: sanitize(message, 500),
        icon:    icon || '🔔',
        link:    sanitize(link || '', 200),
        isGlobal: false,
      });

      return res.json({ ok: true, notification: notif });
    }

    /* ── DELETE: Admin clear ──────────────────────────────────── */
    if (req.method === 'DELETE' && admin) {
      const { id, before } = req.query;
      if (id) {
        await Notification.findByIdAndDelete(id);
        return res.json({ ok: true });
      }
      if (before) {
        const result = await Notification.deleteMany({ createdAt: { $lt: new Date(before) }, isRead: true });
        return res.json({ ok: true, deleted: result.deletedCount });
      }
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Notifications API error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
