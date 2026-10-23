'use strict';
const path = require('path');
require('dotenv').config();

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] متغير البيئة ${name} مفقود. راجع .env.example`);
    process.exit(1);
  }
  return v;
}

const cfg = {
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/securechat',
  trustProxy: !!Number(process.env.TRUST_PROXY || 0),
  secureCookie: process.env.NODE_ENV === 'production',

  codes: {
    Rida: need('RIDA_CODE'),
    Ines: need('INES_CODE'),
    panic: need('PANIC_CODE'),
  },
  jwtSecret: need('JWT_SECRET'),
  encSalt: need('ENC_SALT'),

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },

  ttlMs: 72 * 60 * 60 * 1000, // 72 ساعة
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024,
};

const all = [cfg.codes.Rida, cfg.codes.Ines, cfg.codes.panic];
if (all.some((c) => c.length < 8) || new Set(all).size !== 3) {
  console.error('[config] الأكواد الثلاثة يجب أن تكون مختلفة وبطول 8 أحرف على الأقل.');
  process.exit(1);
}
if (cfg.jwtSecret.length < 32) {
  console.error('[config] JWT_SECRET قصير جداً (32 حرفاً على الأقل).');
  process.exit(1);
}

module.exports = cfg;
