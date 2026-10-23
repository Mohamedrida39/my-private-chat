'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const lockFile = path.join(cfg.dataDir, 'LOCKED');

// حالة مشتركة: هل الموقع مُقفل (بعد كود الطوارئ)؟ + مرجع Socket.io
const state = {
  io: null,
  locked: fs.existsSync(lockFile),
  lock() {
    this.locked = true;
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    fs.writeFileSync(lockFile, String(Date.now()), { mode: 0o600 });
  },
};

module.exports = state;
