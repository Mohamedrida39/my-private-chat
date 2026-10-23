'use strict';
const express = require('express');
const multer = require('multer');
const cfg = require('./config');
const auth = require('./auth');
const files = require('./files');
const svc = require('./service');
const panic = require('./panic');
const { safeEqual } = require('./crypto');
const { Message, PushSub } = require('./models');

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/* ---------- محدّد محاولات الدخول (صامت) ---------- */
const attempts = new Map(); // ip -> { n, reset }
function tooMany(ip) {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || a.reset < now) a = { n: 0, reset: now + 60 * 1000 };
  a.n += 1;
  attempts.set(ip, a);
  return a.n > 10;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of attempts) if (a.reset < now) attempts.delete(ip);
}, 60 * 1000).unref();

/* ---------- الدخول: لا رسائل خطأ إطلاقاً ---------- */
router.post('/enter', (req, res) => {
  const code = req.body && typeof req.body.code === 'string' ? req.body.code.slice(0, 200) : '';
  if (!code || tooMany(req.ip)) return res.status(204).end();

  // نقارن الثلاثة دائماً (بدون قطع مبكر) لتفادي فروق التوقيت
  const isRida = safeEqual(code, cfg.codes.Rida);
  const isInes = safeEqual(code, cfg.codes.Ines);
  const isPanic = safeEqual(code, cfg.codes.panic);

  if (isPanic) {
    res.status(204).end();
    panic.trigger();
    return;
  }
  if (isRida || isInes) {
    auth.issue(res, isRida ? 'Rida' : 'Ines');
    return res.status(200).json({ ok: true });
  }
  return res.status(204).end(); // كود خاطئ: لا شيء يتغير
});

router.post('/logout', (req, res) => {
  auth.clear(res);
  res.status(204).end();
});

/* ---------- الجلسة + الحالة الأولية ---------- */
router.get('/session', auth.requireAuth, async (req, res) => {
  try {
    const [messages, peer] = await Promise.all([svc.listMessages(), svc.peerState(req.user)]);
    res.json({
      user: req.user,
      peer: svc.PEER[req.user],
      state: peer,
      messages,
      vapidKey: svc.pushEnabled ? cfg.vapid.publicKey : '',
      maxUpload: cfg.maxUploadBytes,
    });
  } catch (e) {
    res.status(500).end();
  }
});

/* ---------- رفع الوسائط (صورة / فيديو / صوت) ---------- */
const ALLOWED = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/webm': 'audio',
  'audio/ogg': 'audio',
  'audio/mp4': 'audio',
  'audio/mpeg': 'audio',
  'audio/aac': 'audio',
  'audio/x-m4a': 'audio',
  'audio/wav': 'audio',
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 4, fieldSize: 8 * 1024 },
});

router.post('/media', auth.requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).end();
    if (!req.file) return res.status(400).end();
    const mime = String(req.file.mimetype || '').split(';')[0].trim().toLowerCase();
    const type = ALLOWED[mime];
    if (!type) return res.status(415).end();
    const caption = type !== 'audio' && typeof req.body.caption === 'string' ? req.body.caption.slice(0, 1000) : '';
    try {
      const id = await files.save(req.file.buffer);
      const dto = await svc.createMessage({
        sender: req.user,
        type,
        text: caption,
        file: { id, mime, size: req.file.size },
      });
      res.json(dto);
    } catch (e) {
      console.error('[media]', e.message);
      res.status(500).end();
    }
  });
});

/* ---------- تقديم الملف (يُفك تشفيره عند الطلب) مع دعم Range للفيديو ---------- */
router.get('/file/:id', auth.requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(404).end();
  try {
    const msg = await Message.findOne({ 'file.id': id, expiresAt: { $gt: new Date() } }, { file: 1 }).lean();
    if (!msg) return res.status(404).end();
    const buf = await files.read(id);

    let start = 0;
    let end = buf.length - 1;
    let status = 200;
    const m = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (m) {
      if (m[1] === '' && m[2] !== '') {
        start = Math.max(0, buf.length - parseInt(m[2], 10));
      } else {
        start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(end, parseInt(m[2], 10));
      }
      if (Number.isNaN(start) || start > end || start >= buf.length) {
        return res.status(416).set('Content-Range', `bytes */${buf.length}`).end();
      }
      status = 206;
      res.set('Content-Range', `bytes ${start}-${end}/${buf.length}`);
    }
    res.status(status).set({
      'Content-Type': msg.file.mime,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    res.end(buf.subarray(start, end + 1));
  } catch (e) {
    res.status(404).end();
  }
});

/* ---------- Web Push ---------- */
router.post('/push/subscribe', auth.requireAuth, async (req, res) => {
  const s = req.body || {};
  if (typeof s.endpoint !== 'string' || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') {
    return res.status(400).end();
  }
  await PushSub.updateOne(
    { endpoint: s.endpoint },
    { $set: { user: req.user, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } } },
    { upsert: true }
  );
  res.status(204).end();
});

router.post('/push/unsubscribe', auth.requireAuth, async (req, res) => {
  if (req.body && typeof req.body.endpoint === 'string') {
    await PushSub.deleteOne({ endpoint: req.body.endpoint, user: req.user });
  }
  res.status(204).end();
});

module.exports = router;
