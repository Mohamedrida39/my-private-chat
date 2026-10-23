'use strict';
const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const { encrypt, decrypt } = require('./crypto');

const dir = path.join(cfg.dataDir, 'uploads');
fssync.mkdirSync(dir, { recursive: true, mode: 0o700 });

const ID_RE = /^[a-f0-9]{32}$/;
const pathOf = (id) => path.join(dir, `${id}.bin`);

async function save(buffer) {
  const id = crypto.randomBytes(16).toString('hex');
  await fs.writeFile(pathOf(id), encrypt(buffer), { mode: 0o600 });
  return id;
}

async function read(id) {
  if (!ID_RE.test(id)) throw new Error('bad id');
  return decrypt(await fs.readFile(pathOf(id)));
}

// يكتب بيانات عشوائية فوق الملف ثم يحذفه (أفضل جهد؛ لا يضمن شيئاً على أقراص SSD)
async function shred(id) {
  if (!ID_RE.test(id)) return;
  const p = pathOf(id);
  try {
    const st = await fs.stat(p);
    await fs.writeFile(p, crypto.randomBytes(st.size));
  } catch (_) {
    /* غير موجود */
  }
  await fs.rm(p, { force: true });
}

async function listIds() {
  const names = await fs.readdir(dir);
  const out = [];
  for (const n of names) {
    const m = /^([a-f0-9]{32})\.bin$/.exec(n);
    if (!m) continue;
    try {
      const st = await fs.stat(path.join(dir, n));
      out.push({ id: m[1], mtimeMs: st.mtimeMs });
    } catch (_) {}
  }
  return out;
}

async function wipeAll() {
  const items = await listIds();
  await Promise.allSettled(items.map((i) => shred(i.id)));
}

module.exports = { save, read, shred, listIds, wipeAll };
