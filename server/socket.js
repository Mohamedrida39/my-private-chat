'use strict';
const auth = require('./auth');
const svc = require('./service');
const state = require('./state');

const guard = (fn) => (...args) => Promise.resolve(fn(...args)).catch((e) => console.error('[socket]', e.message));

function attach(io) {
  // المصادقة عبر الكوكي نفسه (HttpOnly) — لا توكن في JavaScript
  io.use((socket, next) => {
    if (state.locked) return next(new Error('x'));
    const user = auth.userFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next(new Error('x'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(user); // غرفة باسم المستخدم (تدعم عدة أجهزة)
    guard(svc.userConnected)(user);

    socket.on('message:send', guard(async (payload) => {
      const text = payload && typeof payload.text === 'string' ? payload.text.trim().slice(0, 4000) : '';
      if (!text) return;
      await svc.createMessage({ sender: user, type: 'text', text });
    }));

    socket.on('messages:read', guard(() => svc.markRead(user)));
    socket.on('message:delete', guard((id) => svc.deleteOwn(user, String(id))));
    socket.on('chat:clear', guard(() => svc.clearAll()));
    socket.on('bell', guard(() => svc.bell(user)));

    socket.on('disconnect', guard(() => svc.userDisconnected(user)));
  });
}

module.exports = { attach };
