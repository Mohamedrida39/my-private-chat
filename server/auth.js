'use strict';
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const cfg = require('./config');

const COOKIE = 'sid';
const MAX_AGE_S = 30 * 24 * 3600;

function issue(res, user) {
  const token = jwt.sign({ u: user }, cfg.jwtSecret, { algorithm: 'HS256', expiresIn: MAX_AGE_S });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: cfg.secureCookie,
    maxAge: MAX_AGE_S * 1000,
    path: '/',
  });
}

function clear(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

function userFromCookieHeader(header) {
  try {
    const token = cookie.parse(header || '')[COOKIE];
    if (!token) return null;
    const p = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] });
    return p.u === 'Rida' || p.u === 'Ines' ? p.u : null;
  } catch (_) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const u = userFromCookieHeader(req.headers.cookie);
  if (!u) return res.status(401).end();
  req.user = u;
  next();
}

module.exports = { issue, clear, userFromCookieHeader, requireAuth };
