(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const gate = $('#gate'), codeInput = $('#code'), chat = $('#chat'), list = $('#list');
  const textEl = $('#text'), sendBtn = $('#send'), micBtn = $('#mic'), fileEl = $('#file');
  const menu = $('#menu'), bellBtn = $('#bell'), toastEl = $('#toast');

  let me = '', socket = null, vapidKey = '', maxUpload = 0, firstConnect = true;
  const msgs = new Map(); // id -> { dto, el, tick }
  let lastDay = null;
  const DAY_MS = 86400000;

  /* ---------------- أدوات ---------------- */
  const fmtFull = (t) =>
    new Date(t).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
  const fmtShort = (t) =>
    new Date(t).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', ' ·');
  const dayKey = (t) => new Date(t).toDateString();
  const dayLabel = (t) => new Date(t).toLocaleDateString('ar-DZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  let toastTimer;
  function toast(s) {
    toastEl.textContent = s;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2500);
  }

  /* ---------------- الدخول الصامت ---------------- */
  codeInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const code = codeInput.value;
    codeInput.value = '';
    if (!code) return;
    try {
      const r = await fetch('/api/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (r.status === 200) await openChat(); // أي استجابة أخرى: لا شيء يتغير
    } catch (_) {}
  });

  /* ---------------- فتح المحادثة ---------------- */
  async function fetchSession() {
    const r = await fetch('/api/session');
    return r.status === 200 ? r.json() : null;
  }

  async function openChat() {
    const s = await fetchSession();
    if (!s) return false;
    me = s.user;
    vapidKey = s.vapidKey;
    maxUpload = s.maxUpload;
    gate.hidden = true;
    chat.hidden = false;
    $('#peerName').textContent = s.peer;
    setPeer(s.state);
    list.textContent = '';
    msgs.clear();
    lastDay = null;
    s.messages.forEach((m) => addMessage(m));
    scrollBottom(true);
    connectSocket();
    setInterval(expireLocal, 20000);
    if ('Notification' in window && Notification.permission === 'granted') ensurePush().catch(() => {});
    return true;
  }

  function showGate() {
    chat.hidden = true;
    gate.hidden = false;
    if (socket) socket.disconnect();
    codeInput.focus();
  }

  /* ---------------- الرسائل ---------------- */
  function build(m) {
    const mine = m.sender === me;
    const div = document.createElement('div');
    div.className = 'msg ' + (mine ? 'mine' : 'theirs');
    div.dataset.id = m.id;

    if (m.file && m.type === 'image') {
      const img = new Image();
      img.className = 'media';
      img.alt = '';
      img.loading = 'lazy';
      img.src = m.file.url;
      img.addEventListener('click', () => openLightbox(m.file.url));
      div.append(img);
    } else if (m.file && m.type === 'video') {
      const v = document.createElement('video');
      v.className = 'media';
      v.controls = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.src = m.file.url;
      div.append(v);
    } else if (m.file && m.type === 'audio') {
      const a = document.createElement('audio');
      a.controls = true;
      a.preload = 'metadata';
      a.src = m.file.url;
      div.append(a);
    }
    if (m.text) {
      const p = document.createElement('p');
      p.dir = 'auto';
      p.textContent = m.text; // textContent: آمن من XSS
      div.append(p);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('span');
    t.textContent = fmtShort(m.createdAt);
    t.title = fmtFull(m.createdAt);
    meta.append(t);

    let tick = null;
    if (mine) {
      tick = document.createElement('span');
      tick.className = 'tick';
      meta.append(tick);
      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.textContent = '🗑';
      del.addEventListener('click', () => {
        if (confirm('حذف هذه الرسالة عند الطرفين؟')) socket.emit('message:delete', m.id);
      });
      meta.append(del);
    }
    div.append(meta);
    return { dto: m, el: div, tick };
  }

  function paint(entry) {
    if (!entry.tick) return;
    const d = entry.dto;
    entry.tick.textContent = d.deliveredAt || d.readAt ? '✓✓' : '✓';
    entry.tick.classList.toggle('read', !!d.readAt);
  }

  function nearBottom() {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  }
  function scrollBottom(force) {
    if (force) list.scrollTop = list.scrollHeight;
  }

  function addMessage(m) {
    if (msgs.has(m.id)) return;
    const stick = nearBottom() || m.sender === me;
    const k = dayKey(m.createdAt);
    if (k !== lastDay) {
      const d = document.createElement('div');
      d.className = 'day';
      d.textContent = dayLabel(m.createdAt);
      list.append(d);
      lastDay = k;
    }
    const entry = build(m);
    paint(entry);
    msgs.set(m.id, entry);
    list.append(entry.el);
    if (stick) {
      scrollBottom(true);
      // الوسائط تتحمّل لاحقاً وتغيّر الارتفاع
      entry.el.querySelectorAll('img').forEach((i) => i.addEventListener('load', () => scrollBottom(true), { once: true }));
    }
  }

  function tidyDays() {
    [...list.querySelectorAll('.day')].forEach((d) => {
      const n = d.nextElementSibling;
      if (!n || n.classList.contains('day')) d.remove();
    });
    const lastMsg = [...msgs.values()].pop();
    lastDay = lastMsg ? dayKey(lastMsg.dto.createdAt) : null;
  }

  function removeMessage(id) {
    const e = msgs.get(id);
    if (!e) return;
    e.el.remove();
    msgs.delete(id);
    tidyDays();
  }

  function expireLocal() {
    const now = Date.now();
    let changed = false;
    for (const [id, e] of msgs) {
      if (e.dto.expiresAt <= now) {
        e.el.remove();
        msgs.delete(id);
        changed = true;
      }
    }
    if (changed) tidyDays();
  }

  function clearAllLocal() {
    msgs.clear();
    list.textContent = '';
    lastDay = null;
  }

  /* ---------------- التواجد ---------------- */
  function setPeer(s) {
    const el = $('#peerStatus');
    if (s.online) el.textContent = '🟢 متصل الآن';
    else el.textContent = s.lastSeen ? `⚪ غير متصل · آخر ظهور ${fmtFull(s.lastSeen)}` : '⚪ غير متصل';
  }

  /* ---------------- Socket.io ---------------- */
  function markRead() {
    if (socket && socket.connected && document.visibilityState === 'visible') socket.emit('messages:read');
  }

  function connectSocket() {
    if (socket) socket.disconnect();
    firstConnect = true;
    socket = io({ withCredentials: true });

    socket.on('connect', async () => {
      if (firstConnect) {
        firstConnect = false;
      } else {
        // انقطع الاتصال ثم عاد: نزامن ما فاتنا
        const s = await fetchSession();
        if (s) resync(s);
      }
      markRead();
    });
    socket.on('connect_error', async () => {
      const s = await fetchSession().catch(() => null);
      if (!s) showGate(); // الجلسة انتهت أو الموقع مُقفل
    });

    socket.on('message:new', (m) => {
      addMessage(m);
      if (m.sender !== me) markRead();
    });
    socket.on('messages:read', ({ ids, readAt }) =>
      ids.forEach((id) => {
        const e = msgs.get(id);
        if (e) { e.dto.readAt = readAt; e.dto.deliveredAt = e.dto.deliveredAt || readAt; paint(e); }
      })
    );
    socket.on('messages:delivered', ({ ids, at }) =>
      ids.forEach((id) => {
        const e = msgs.get(id);
        if (e) { e.dto.deliveredAt = at; paint(e); }
      })
    );
    socket.on('message:deleted', ({ id }) => removeMessage(id));
    socket.on('messages:expired', ({ ids }) => ids.forEach(removeMessage));
    socket.on('chat:cleared', clearAllLocal);
    socket.on('presence', setPeer);
    socket.on('bell', ring);
  }

  function resync(s) {
    setPeer(s.state);
    const ids = new Set(s.messages.map((m) => m.id));
    for (const id of [...msgs.keys()]) if (!ids.has(id)) removeMessage(id);
    s.messages.forEach((m) => {
      const e = msgs.get(m.id);
      if (e) { e.dto = m; paint(e); } else addMessage(m);
    });
  }

  document.addEventListener('visibilitychange', markRead);
  window.addEventListener('focus', markRead);

  /* ---------------- الجرس ---------------- */
  function ring() {
    bellBtn.classList.remove('ring');
    void bellBtn.offsetWidth;
    bellBtn.classList.add('ring');
  }
  bellBtn.addEventListener('click', () => {
    if (socket) socket.emit('bell');
    ring();
  });

  /* ---------------- الإرسال ---------------- */
  function syncButtons() {
    const has = textEl.value.trim().length > 0;
    sendBtn.hidden = !has;
    micBtn.hidden = has;
    textEl.style.height = 'auto';
    textEl.style.height = Math.min(textEl.scrollHeight, 120) + 'px';
  }
  function sendText() {
    const text = textEl.value.trim();
    if (!text || !socket) return;
    socket.emit('message:send', { text });
    textEl.value = '';
    syncButtons();
    textEl.focus();
  }
  textEl.addEventListener('input', syncButtons);
  textEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      sendText();
    }
  });
  sendBtn.addEventListener('click', sendText);

  async function uploadBlob(blob, name) {
    if (maxUpload && blob.size > maxUpload) return toast('الملف كبير جداً');
    const fd = new FormData();
    fd.append('file', blob, name);
    toast('جارٍ الإرسال…');
    try {
      const r = await fetch('/api/media', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(r.status);
      toastEl.hidden = true;
    } catch (_) {
      toast('تعذّر الإرسال');
    }
  }
  $('#attach').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => {
    const f = fileEl.files[0];
    fileEl.value = '';
    if (f) uploadBlob(f, f.name);
  });

  /* ---------------- التسجيل الصوتي ---------------- */
  let rec = null, recStream = null, recChunks = [], recTimer = null, recStart = 0, recSendOnStop = false;
  const EXT = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' };

  async function startRec() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return toast('التسجيل غير مدعوم في هذا المتصفح');
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      return toast('لا يوجد إذن للميكروفون');
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
    rec = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
    recChunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && recChunks.push(e.data);
    rec.onstop = () => {
      recStream.getTracks().forEach((t) => t.stop());
      const type = (rec.mimeType || 'audio/webm').split(';')[0];
      if (recSendOnStop && recChunks.length) uploadBlob(new Blob(recChunks, { type }), `voice.${EXT[type] || 'webm'}`);
    };
    rec.start();
    recStart = Date.now();
    $('#rec').hidden = false;
    $('#recTime').textContent = '0:00';
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $('#recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= 300) stopRec(true); // حد أقصى 5 دقائق
    }, 250);
  }
  function stopRec(send) {
    clearInterval(recTimer);
    $('#rec').hidden = true;
    recSendOnStop = send;
    if (rec && rec.state !== 'inactive') rec.stop();
  }
  micBtn.addEventListener('click', startRec);
  $('#recCancel').addEventListener('click', () => stopRec(false));
  $('#recSend').addEventListener('click', () => stopRec(true));

  /* ---------------- معاينة الصور ---------------- */
  function openLightbox(src) {
    const lb = $('#lightbox');
    lb.textContent = '';
    const img = new Image();
    img.src = src;
    lb.append(img);
    lb.hidden = false;
  }
  $('#lightbox').addEventListener('click', () => ($('#lightbox').hidden = true));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && ($('#lightbox').hidden = true));

  /* ---------------- القائمة ---------------- */
  $('#menuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', () => (menu.hidden = true));

  $('#clearChat').addEventListener('click', () => {
    if (confirm('مسح المحادثة بالكامل عند الطرفين؟ لا يمكن التراجع.')) socket.emit('chat:clear');
  });
  $('#enablePush').addEventListener('click', async () => {
    try {
      await ensurePush();
      toast(Notification.permission === 'granted' ? '🔔 ✓' : '✗');
    } catch (_) {
      toast('✗');
    }
  });
  $('#logout').addEventListener('click', async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
    } catch (_) {}
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  /* ---------------- Web Push ---------------- */
  const b64 = (s) => {
    const p = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  async function ensurePush() {
    if (!vapidKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapidKey) });
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
  }
  // أول لمسة داخل المحادثة تطلب إذن الإشعارات (يتطلب تفاعل المستخدم)
  chat.addEventListener('click', () => {
    if ('Notification' in window && Notification.permission === 'default') ensurePush().catch(() => {});
  }, { once: true });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => e.data && e.data.t === 'bell' && ring());
  }

  /* ---------------- البدء ---------------- */
  (async () => {
    try {
      if (!(await openChat())) codeInput.focus();
    } catch (_) {
      codeInput.focus();
    }
  })();
})();
