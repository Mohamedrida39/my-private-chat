# محادثة خاصة لشخصين (Rida & Ines)

Express + Socket.io + MongoDB + Web Push + PWA، بواجهة JavaScript عادية (Vanilla).

## الهيكل

```
secure-chat/
├─ server/
│  ├─ index.js     تشغيل الخادم، ترويسات الأمان (CSP)، الملفات الثابتة
│  ├─ config.js    قراءة .env والتحقق من الأكواد والمفاتيح
│  ├─ crypto.js    AES-256-GCM + اشتقاق المفتاح (scrypt) من الكودين السريين
│  ├─ models.js    مخطط قاعدة البيانات (Message / PushSub / Presence) + فهرس TTL
│  ├─ files.js     تخزين الوسائط مشفّرة على القرص + الحذف بالكتابة فوق الملف
│  ├─ auth.js      JWT داخل كوكي HttpOnly + SameSite=Strict
│  ├─ routes.js    /api: enter (الدخول الصامت + كود الطوارئ)، session، media، file، push
│  ├─ service.js   منطق الرسائل، القراءة، التواجد، جرس التنبيه
│  ├─ socket.js    أحداث Socket.io
│  ├─ cleanup.js   التدمير الذاتي بعد 72 ساعة + تنظيف الملفات اليتيمة
│  ├─ panic.js     كود الطوارئ
│  └─ state.js     حالة القفل + مرجع Socket.io
├─ public/         index.html, app.js, style.css, sw.js, manifest.webmanifest, icons/
└─ scripts/        gen-keys.js (مفاتيح VAPID وغيرها), make-icons.py
```

## التشغيل

```bash
npm install
npm run keys            # انسخ الناتج إلى .env
cp .env.example .env    # ثم عدّل الأكواد الثلاثة والمفاتيح
npm start
```

شروط لازمة:
- **HTTPS إلزامي** خارج localhost (الميكروفون، الإشعارات، وتثبيت PWA كلها تتطلبه). الأسهل: خلف Nginx/Caddy أو Cloudflare، مع `TRUST_PROXY=1`.
- MongoDB شغّال (محلي أو Atlas).
- على آيفون: يجب فتح الموقع في Safari ← مشاركة ← "إضافة إلى الشاشة الرئيسية" (iOS 16.4+) قبل تفعيل الإشعارات.

## مخطط قاعدة البيانات

**messages**: `sender`, `type` (text/image/video/audio), `body` (نص مشفّر), `file {id,mime,size}`, `deliveredAt`, `readAt`, `createdAt`, `expiresAt` ← عليه فهرس TTL (`expireAfterSeconds: 0`).
**pushsubs**: `user`, `endpoint` (فريد), `keys {p256dh, auth}`.
**presences**: `user` (فريد), `lastSeen`.

## أحداث Socket.io

| من العميل | الوصف |
|---|---|
| `message:send {text}` | إرسال نص |
| `messages:read` | تعليم رسائل الطرف الآخر كمقروءة |
| `message:delete id` | حذف رسالة أرسلتها أنت (عند الطرفين) |
| `chat:clear` | مسح المحادثة كاملة عند الطرفين |
| `bell` | جرس التنبيه الصامت |

| من الخادم | الوصف |
|---|---|
| `message:new`, `message:deleted`, `messages:expired`, `chat:cleared` | تغيّرات الرسائل |
| `messages:delivered`, `messages:read` | علامات ✓ / ✓✓ / ✓✓ زرقاء |
| `presence {online,lastSeen}` | حالة الطرف الآخر |
| `bell` | تحريك الجرس داخل الواجهة |

الوسائط (صور/فيديو/صوت) تُرفع عبر `POST /api/media` ثم تصل للطرفين كـ `message:new`.

## كود الطوارئ

كتابته في خانة الدخول يقفل الموقع فوراً (كل المسارات تعيد 404)، يقطع الاتصالات، يمسح الرسائل والاشتراكات والملفات ويُسقط قاعدة البيانات.
لإعادة التشغيل: احذف الملف `data/LOCKED` وأعد تشغيل الخادم.

## ملاحظات أمنية صريحة

- **التشفير هنا تشفير على الخادم (at-rest)، وليس تشفيراً من طرف إلى طرف.** الخادم يعرف الأكواد (في `.env`) فيستطيع فك التشفير. يحمي من تسريب قاعدة البيانات/الملفات وحدها، لا من شخص يسيطر على الخادم.
- استخدم أكواداً طويلة (12 حرفاً فأكثر)؛ الحدّ المدمج 10 محاولات/دقيقة لكل IP، والدخول صامت لا يخبر المهاجم بشيء.
- "الحذف النهائي": يُحذف المستند ويُكتب فوق الملف قبل حذفه، لكن لا يمكن ضمان المحو الفيزيائي على أقراص SSD أو في نسخ MongoDB الاحتياطية/السجلات.
- الإشعار الصامت: `silent: true` يعمل على Chrome/أندرويد. أنظمة أخرى (خصوصاً iOS) قد تتجاهل الخيار ويحدد النظام الصوت، فاضبط وضع الصامت في الهاتف إن أردت ضماناً كاملاً. إن كان التطبيق مفتوحاً أمام المستلم يتحرك الجرس داخل الواجهة فقط.
- اسم التطبيق على الشاشة الرئيسية "M.R.G" بأيقونة آلة حاسبة؛ غيّره من `manifest.webmanifest` و`index.html`.
- الإشعار لا يغلق الشات: الضغط عليه يُظهر التطبيق فقط.
