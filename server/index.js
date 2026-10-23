'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const cfg = require('./config');
const state = require('./state');
const routes = require('./routes');
const socket = require('./socket');
const cleanup = require('./cleanup');

const app = express();
app.disable('x-powered-by');
if (cfg.trustProxy) app.set('trust proxy', 1);

// بعد كود الطوارئ: كل شيء 404 وبدون أي محتوى
app.use((req, res, next) => (state.locked ? res.status(404).end() : next()));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

app.use('/api', express.json({ limit: '2kb' }), routes);

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, file) {
      if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
app.use((req, res) => res.status(404).end());

async function main() {
  await mongoose.connect(cfg.mongoUri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // يبني فهرس TTL وغيره

  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 1e5 });
  state.io = io;
  socket.attach(io);
  cleanup.start();

  server.listen(cfg.port, () => {
    console.log(`[server] يعمل على المنفذ ${cfg.port}${state.locked ? ' (مقفل: data/LOCKED)' : ''}`);
  });

  const shutdown = () => {
    server.close();
    mongoose.disconnect().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
