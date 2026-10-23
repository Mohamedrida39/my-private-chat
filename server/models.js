'use strict';
const mongoose = require('mongoose');

/**
 * Message — مخطط الرسائل
 *  sender      : 'Rida' | 'Ines'
 *  type        : text | image | video | audio
 *  body        : النص/التعليق مشفّراً (AES-256-GCM)  [Buffer]
 *  file        : بيانات الملف المشفّر على القرص (الملف نفسه خارج Mongo)
 *  deliveredAt : وقت وصول الرسالة لجهاز الطرف الآخر
 *  readAt      : وقت قراءتها (يحوّل علامتي ✓✓ للون الأزرق)
 *  createdAt   : وقت الإرسال
 *  expiresAt   : createdAt + 72 ساعة — فهرس TTL يحذف المستند تلقائياً
 */
const messageSchema = new mongoose.Schema(
  {
    sender: { type: String, enum: ['Rida', 'Ines'], required: true },
    type: { type: String, enum: ['text', 'image', 'video', 'audio'], required: true },
    body: { type: Buffer },
    file: {
      id: { type: String },
      mime: { type: String },
      size: { type: Number },
    },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);
messageSchema.index({ createdAt: 1 });
messageSchema.index({ sender: 1, readAt: 1 });
messageSchema.index({ sender: 1, deliveredAt: 1 });
messageSchema.index({ 'file.id': 1 }, { sparse: true });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL

/** اشتراكات Web Push لكل مستخدم (قد يملك أكثر من جهاز) */
const pushSubSchema = new mongoose.Schema(
  {
    user: { type: String, enum: ['Rida', 'Ines'], required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

/** آخر ظهور لكل مستخدم */
const presenceSchema = new mongoose.Schema(
  {
    user: { type: String, enum: ['Rida', 'Ines'], required: true, unique: true },
    lastSeen: { type: Date, required: true },
  },
  { versionKey: false }
);

module.exports = {
  Message: mongoose.model('Message', messageSchema),
  PushSub: mongoose.model('PushSub', pushSubSchema),
  Presence: mongoose.model('Presence', presenceSchema),
};
