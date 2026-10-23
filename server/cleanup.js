'use strict';
const files = require('./files');
const svc = require('./service');
const state = require('./state');
const { Message } = require('./models');

/**
 * التدمير الذاتي: كل 30 ثانية نحذف الرسائل التي مضى عليها 72 ساعة (مع ملفاتها).
 * فهرس TTL في MongoDB شبكة أمان إضافية (يعمل كل ~60 ثانية).
 */
async function sweepExpired() {
  if (state.locked) return;
  const expired = await Message.find({ expiresAt: { $lte: new Date() } }, { 'file.id': 1 }).lean();
  if (!expired.length) return;
  await Promise.allSettled(expired.filter((m) => m.file && m.file.id).map((m) => files.shred(m.file.id)));
  await Message.deleteMany({ _id: { $in: expired.map((m) => m._id) } });
  svc.broadcast('messages:expired', { ids: expired.map((m) => String(m._id)) });
}

/** حذف أي ملف على القرص لا ترتبط به رسالة (مثلاً إذا حذف TTL المستند أولاً). */
async function sweepOrphans() {
  if (state.locked) return;
  const onDisk = await files.listIds();
  if (!onDisk.length) return;
  const referenced = new Set(await Message.distinct('file.id'));
  const cutoff = Date.now() - 5 * 60 * 1000; // لا نلمس ملفات حديثة (قد يكون رفعها جارياً)
  await Promise.allSettled(onDisk.filter((f) => !referenced.has(f.id) && f.mtimeMs < cutoff).map((f) => files.shred(f.id)));
}

function start() {
  const safe = (fn) => () => fn().catch((e) => console.error('[cleanup]', e.message));
  safe(sweepOrphans)();
  setInterval(safe(sweepExpired), 30 * 1000);
  setInterval(safe(sweepOrphans), 10 * 60 * 1000);
}

module.exports = { start, sweepExpired, sweepOrphans };
