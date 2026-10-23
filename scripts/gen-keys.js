'use strict';
// يولّد مفاتيح VAPID (للإشعارات) + JWT_SECRET + ENC_SALT. انسخ الناتج إلى ملف .env
const crypto = require('crypto');
const webpush = require('web-push');

const vapid = webpush.generateVAPIDKeys();
console.log(`JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`);
console.log(`ENC_SALT=${crypto.randomBytes(24).toString('hex')}`);
console.log(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
