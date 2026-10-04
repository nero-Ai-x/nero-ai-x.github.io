<div dir="rtl">

<p align="center">
  <img src="logo.png" width="120" alt="NERO AI">
</p>

# NERO AI

مساعد ذكاء اصطناعي بالعربي والإنجليزي، بيشتغل مباشرة من المتصفح بدون تثبيت. بتسجّل دخول بحساب Google، وبتحكي معه، وبتبحث على الإنترنت، وبترفق صور وملفات، وبتولّد صور. وكل محادثاتك بتنتقل معك من جهاز لجهاز.

**[افتح الموقع](https://nero-ai-x.github.io/)** · **[سياسة الخصوصية](https://nero-ai-x.github.io/privacy.html)**

---

## شو بيقدر يعمل

- **محادثة بالعربي والإنجليزي** مع تبديل اللغة من الواجهة.
- **أكثر من نموذج:** GPT-OSS 120B وGPT-OSS 20B وQwen عبر Groq، مع Gemini وCerebras وWorkers AI كاحتياط مجاني. إذا مزود ما اشتغل أو وصل لحدّه، الموقع بيكمل على اللي بعده تلقائياً.
- **وضع التفكير:** ردود أعمق للأسئلة الصعبة.
- **بحث على الإنترنت** يتفعّل بضغطة زر.
- **مرفقات:** صور (حتى 3 بالرسالة، وكل صورة لحد 5 ميجا)، وملفات، وأرشيفات مضغوطة بيستخرج محتواها ويقراها.
- **توليد صور** بنموذجَي FLUX.1 schnell وSDXL Lightning على Cloudflare Workers AI، للمسجّلين فقط. المقاسات غير المربعة تختار SDXL تلقائيًا لأن FLUX.1 سريع يعيد صورًا مربعة.
- **محادثات مؤقتة** ما بتنحفظ، وبتقدر تحفظها يدوياً إذا حبيت.
- **ذاكرة** من محادثاتك السابقة عشان الردود تكون أقرب لسياقك.
- **حفظ ومزامنة المحادثات:** آخر 50 محادثة بتنحفظ بحسابك وبتظهر على كل أجهزتك (النص فقط، والصور بتضل على جهازها).
- **تفاصيل مريحة:** عرض Markdown، وتلوين الأكواد مع زر نسخ، وقراءة الرد بصوت عالٍ، وإعادة توليد الرد.
- **حد يومي لكل حساب** (الافتراضي 40 رسالة، بيتجدد 00:00 UTC) عشان الخدمة تضل متاحة للكل.

## كيف بيشتغل

```
المتصفح (index.html)
   │  تسجيل دخول Google  ──►  Worker الدردشة  ──►  Groq / Gemini
   │                              │
   │                              └──►  D1: الحصة اليومية + المحادثات
   │
   └──  Worker الصور  ──►  Cloudflare Workers AI
```

- الواجهة ملف واحد (`index.html`) مع Tailwind CSS وجافاسكربت عادي.
- مفاتيح Groq وGemini بتضل على السيرفر (Cloudflare Workers) ولا بتوصل للمتصفح أبداً.
- كل Worker بيقبل الطلبات من رابط الموقع بس (`ALLOWED_ORIGINS`) ومن المسجّلين بس (توكن جلسة موقّع، مدته 30 يوم).

**التقنيات:** HTML · Tailwind CSS · JavaScript · Cloudflare Workers · Cloudflare D1 · Workers AI · Groq · Google Gemini · Google Identity Services · marked · DOMPurify · highlight.js · JSZip

## الخصوصية

- نص محادثاتك بيتخزّن في قاعدة بيانات (Cloudflare D1) مربوط بحسابك عشان المزامنة، وبتقدر تحذف أي محادثة وبتنحذف من كل أجهزتك.
- الصور (المرفقة والمولَّدة) بتضل على جهازك ولا بتنتقل.
- رسائلك ومحتوى الملفات النصية المرفق/المستخرج بتنرسل لمزوّد النموذج المتاح (Groq أو Gemini أو Cerebras أو Cloudflare Workers AI) لتوليد الرد، ويُحفظ نص المحادثة في D1 عند تفعيل المزامنة. لا تكتب كلمات سر أو بيانات حساسة بالمحادثة.
- التفاصيل الكاملة بـ [سياسة الخصوصية](privacy.html).

## ملفات المشروع

| الملف | الوظيفة |
|---|---|
| `index.html` | الموقع (الواجهة والمنطق) |
| `tailwind.css` | التنسيقات (جاهزة بدون بناء) |
| `logo.png` | الشعار |
| `privacy.html` | سياسة الخصوصية |
| `_headers` | ترويسات أمان (لـ Cloudflare Pages وNetlify) |
| `cloudflare-worker/chat-worker.js` | وسيط الدردشة وتسجيل الدخول والمزامنة |
| `cloudflare-worker/worker.js` | وسيط توليد الصور |
| `cloudflare-worker/schema.sql` | جداول قاعدة البيانات (D1) |
| `tests/worker-smoke.mjs` | اختبارات سريعة للأمان وتوليد الصور وحدّ الاستخدام |

---

## للمطوّرين: الإعداد والنشر

### 1) الموقع
ارفع `index.html` و`tailwind.css` و`logo.png` و`privacy.html` و`_headers` على أي استضافة ثابتة: **GitHub Pages** أو **Cloudflare Pages** أو **Netlify**. (مجلد `cloudflare-worker` اختياري بالموقع.)

> على GitHub Pages، رابط الموقع بيكون `https://USERNAME.github.io/` فقط إذا اسم المستودع `USERNAME.github.io`. غير هيك بيصير `https://USERNAME.github.io/REPO/`.

### 2) تسجيل الدخول بـ Google
1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create Credentials → **OAuth client ID** → Web application.
2. **Authorized JavaScript origins:** رابط موقعك بدون `/` بالآخر، مثل `https://nero-ai-x.github.io`.
3. من **Audience** اعمل **Publish app** عشان أي حساب يقدر يدخل.
4. حط الـ Client ID بـ `GOOGLE_CLIENT_ID` داخل `index.html`.

### 3) قاعدة البيانات
Workers & Pages → D1 → أنشئ قاعدة اسمها `nero` → Console → نفّذ محتوى `cloudflare-worker/schema.sql`. (آمن تنفيذه أكثر من مرة.)

### 4) Worker الدردشة
1. أنشئ Worker والصق `cloudflare-worker/chat-worker.js` → Deploy.
2. **Bindings:** أضف D1 باسم `DB` على قاعدة `nero`، ويمكنك إضافة Workers AI باسم `AI` لتفعيل الاحتياطي المجاني.
3. **Variables and Secrets:**

| الاسم | النوع | الوصف |
|---|---|---|
| `GROQ_API_KEY` | Secret | مطلوب |
| `SESSION_SECRET` | Secret | مطلوب، نص عشوائي طويل (32+ حرف) |
| `GEMINI_API_KEY` | Secret | اختياري، كاحتياطي |
| `CEREBRAS_API_KEY` | Secret | اختياري |
| `ALLOWED_ORIGINS` | Text | رابط موقعك بدون `/` |
| `GOOGLE_CLIENT_ID` | Text | نفس اللي بالخطوة 2 |
| `DAILY_LIMIT` | Text | اختياري، الافتراضي 40 |

> **احتياطي مجاني بلا مفتاح خارجي:** أضف Binding باسم `AI` إلى Worker الدردشة، وسيظهر نموذج `nero/cloudflare` تلقائيًا. يمكن تخصيص النموذج عبر `CLOUDFLARE_MODEL`، والقيمة الافتراضية `@cf/meta/llama-3.1-8b-instruct`.

4. حط رابط الـ Worker بـ `CHAT_WORKER_URL` داخل `index.html`.
5. يُنصح بقاعدة Rate Limiting على الـ Worker (مثلاً 20 طلب بالدقيقة لكل IP).

### 5) Worker الصور
1. أنشئ Worker والصق `cloudflare-worker/worker.js` → Deploy.
2. **Bindings:** أضف **Workers AI** باسم `AI`.
3. **Variables and Secrets:** `ALLOWED_ORIGINS` (أصل الموقع الدقيق، بدون `/`، مثل `https://nero-ai-x.github.io`) و`SESSION_SECRET` كـ Secret **بنفس قيمة Worker الدردشة بالضبط**. لا تستخدم `*`؛ العامل يرفض العمل إذا غاب أي إعداد من هذه الإعدادات.
4. حط رابطه بـ `IMAGE_WORKER_URL` داخل `index.html`.

### 6) اختبار قبل ما تشارك الرابط
- شغّل `node tests/worker-smoke.mjs` باستخدام Node.js 20+ وPython 3 لفحص بوابات الأمان ونماذج الصور وحدّ الاستخدام الذري.
- سجّل دخول وجرّب رسالة وبحث وصورة مرفقة وتوليد صورة.
- افتح الموقع من جهازين بنفس الحساب وتأكد إن المحادثة بتظهر وإن الحذف بينتقل.
- جرّب `DAILY_LIMIT` = 2 مؤقتاً وتأكد إن الرسالة الثالثة بتعطي رسالة الحد اليومي.
- جرّب من الجوال ومن متصفح داخل تطبيق (Instagram أو Facebook)، لأن Google ممكن تمنع الدخول منها.

### ملاحظات
- حدود الخطط المجانية عند Groq وGemini وCloudflare بتتغير، تحقق منها بلوحاتهم.
- كل المستخدمين بيتشاركوا حصة مفاتيحك. لو زاد الاستخدام راقب الحدود وفكّر بإضافة مفاتيح أو خطة مدفوعة.
- كل حساب Google له حصة يومية خاصة، والتسجيل بيحدّ الاستنزاف العادي لكنه ما بيمنع مين يعمل أكثر من حساب عن قصد.

---

<p align="center">
  <b>تصميم وبرمجة:</b> أَنَــسْ الجَعَلْ| 𝑨𝒏𝒂𝒔 𝑨𝒍-𝒋𝒂𝒂𝒍𓂆
</p>

</div>
