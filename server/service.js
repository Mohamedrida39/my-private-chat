'use strict';
const mongoose = require('mongoose');
const webpush = require('web-push');
const cfg = require('./config');
const state = require('./state');
const files = require('./files');
const { encrypt, decrypt } = require('./crypto');
const { Message, PushSub, Presence } = require('./models');

const PEER = { Rida: 'Ines', Ines: 'Rida' };
const online = { Rida: 0, Ines: 0 }; // عدد الاتصالات المفتوحة لكل مستخدم
const lastBell = {};

const pushEnabled = !!(cfg.vapid.publicKey && cfg.vapid.privateKey);
if (pushEnabled) {
  webpush.setVapidDetails(cfg.vapid.subject, cfg.vapid.publicKey, cfg.vapid.privateKey);
} else {
  console.warn('[push] مفاتيح VAPID غير مضبوطة — الإشعارات معطّلة (شغّل: npm run keys)');
}

const io = () => state.io;
const both = (event, payload) => io().to('Rida').to('Ines').emit(event, payload);
const ts = (d) => (d ? d.getTime() : null);

function toDto(m) {
  let text = '';
  if (m.body) {
    try {
      text = decrypt(m.body).toString('utf8');
    } catch (_) {
      text = '';
    }
  }
  return {
    id: String(m._id),
    sender: m.sender,
    type: m.type,
    text,
    file: m.file && m.file.id ? { mime: m.file.mime, size: m.file.size, url: `/api/file/${m.file.id}` } : null,
    createdAt: ts(m.createdAt),
    expiresAt: ts(m.expiresAt),
    deliveredAt: ts(m.deliveredAt),
    readAt: ts(m.readAt),
  };
}

async function listMessages() {
  const docs = await Message.find({ expiresAt: { $gt: new Date() } })
    .sort({ createdAt: 1 })
    .limit(1000)
    .lean();
  return docs.map(toDto);
}

async function createMessage({ sender, type, text, file }) {
  const now = new Date();
  const doc = await Message.create({
    sender,
    type,
    body: text ? encrypt(Buffer.from(text, 'utf8')) : undefined,
    file: file || undefined,
    deliveredAt: online[PEER[sender]] > 0 ? now : undefined,
    createdAt: now,
    expiresAt: new Date(now.getTime() + cfg.ttlMs),
  });
  const dto = toDto(doc.toObject());
  both('message:new', dto);
  return dto;
}

async function markRead(user) {
  const peer = PEER[user];
  const now = new Date();
  const pending = await Message.find({ sender: peer, readAt: null, expiresAt: { $gt: now } }, { _id: 1 }).lean();
  if (!pending.length) return;
  const ids = pending.map((p) => p._id);
  await Message.updateMany({ _id: { $in: ids } }, [
    { $set: { readAt: now, deliveredAt: { $ifNull: ['$deliveredAt', now] } } },
  ]);
  both('messages:read', { ids: ids.map(String), readAt: now.getTime() });
}

async function deleteOwn(user, id) {
  if (!mongoose.isValidObjectId(id)) return;
  const doc = await Message.findOneAndDelete({ _id: id, sender: user }).lean();
  if (!doc) return;
  if (doc.file && doc.file.id) await files.shred(doc.file.id);
  both('message:deleted', { id: String(doc._id) });
}

async function clearAll() {
  const withFiles = await Message.find({ 'file.id': { $exists: true } }, { 'file.id': 1 }).lean();
  await Message.deleteMany({});
  await Promise.allSettled(withFiles.map((m) => files.shred(m.file.id)));
  both('chat:cleared', {});
}

/* ------------------------- التواجد ------------------------- */

async function peerState(user) {
  const peer = PEER[user];
  const p = await Presence.findOne({ user: peer }).lean();
  return { online: online[peer] > 0, lastSeen: p ? ts(p.lastSeen) : null };
}

async function userConnected(user) {
  online[user] += 1;
  if (online[user] !== 1) return;
  const now = new Date();
  await Presence.updateOne({ user }, { $set: { lastSeen: now } }, { upsert: true });
  io().to(PEER[user]).emit('presence', { online: true, lastSeen: ts(now) });

  // أي رسائل كانت بانتظار وصولها لهذا المستخدم تصبح "واصلة"
  const undelivered = await Message.find({ sender: PEER[user], deliveredAt: null, expiresAt: { $gt: now } }, { _id: 1 }).lean();
  if (undelivered.length) {
    const ids = undelivered.map((m) => m._id);
    await Message.updateMany({ _id: { $in: ids } }, { $set: { deliveredAt: now } });
    io().to(PEER[user]).emit('messages:delivered', { ids: ids.map(String), at: ts(now) });
  }
}

async function userDisconnected(user) {
  online[user] = Math.max(0, online[user] - 1);
  if (online[user] !== 0) return;
  const now = new Date();
  await Presence.updateOne({ user }, { $set: { lastSeen: now } }, { upsert: true });
  io().to(PEER[user]).emit('presence', { online: false, lastSeen: ts(now) });
}

/* ------------------------- جرس التنبيه الصامت ------------------------- */

async function pushTo(user) {
  if (!pushEnabled) return;
  const subs = await PushSub.find({ user }).lean();
  const payload = JSON.stringify({ t: 'bell' });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 120, urgency: 'high' });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await PushSub.deleteOne({ _id: s._id });
        else console.warn('[push]', e.statusCode || e.message);
      }
    })
  );
}

async function bell(user) {
  const now = Date.now();
  if (lastBell[user] && now - lastBell[user] < 3000) return; // منع الإزعاج المتكرر
  lastBell[user] = now;
  io().to(PEER[user]).emit('bell', {});
  await pushTo(PEER[user]);
}

module.exports = {
  PEER,
  pushEnabled,
  toDto,
  listMessages,
  createMessage,
  markRead,
  deleteOwn,
  clearAll,
  peerState,
  userConnected,
  userDisconnected,
  bell,
  broadcast: both,
};
