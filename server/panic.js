'use strict';
const mongoose = require('mongoose');
const state = require('./state');
const files = require('./files');
const { Message, PushSub, Presence } = require('./models');

let running = false;

/**
 * كود الطوارئ: يقفل الموقع فوراً (كل المسارات تعيد 404)، يقطع كل الاتصالات،
 * ثم يمسح الرسائل والاشتراكات وكل الملفات المرفوعة ويُسقط قاعدة البيانات.
 * لإعادة التشغيل لاحقاً: احذف الملف data/LOCKED وأعد تشغيل الخادم.
 */
async function trigger() {
  if (running) return;
  running = true;
  try {
    state.lock();
    if (state.io) state.io.disconnectSockets(true);
    await Promise.allSettled([Message.deleteMany({}), PushSub.deleteMany({}), Presence.deleteMany({})]);
    await files.wipeAll();
    await mongoose.connection.dropDatabase().catch(() => {});
  } catch (e) {
    console.error('[panic]', e.message);
  }
}

module.exports = { trigger };
