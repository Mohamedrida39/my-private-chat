'use strict';
const crypto = require('crypto');
const cfg = require('./config');

// مفتاح التشفير مشتق (scrypt) من الكودين السريين معاً + ملح ثابت من البيئة.
const KEY = crypto.scryptSync(`${cfg.codes.Rida}\u0000${cfg.codes.Ines}`, cfg.encSalt, 32, {
  N: 2 ** 15,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024,
});

// الصيغة: iv(12) | tag(16) | ciphertext — AES-256-GCM
function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}

function decrypt(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer || blob);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
// مقارنة ثابتة الزمن
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha(a), sha(b));
}

module.exports = { encrypt, decrypt, safeEqual };
