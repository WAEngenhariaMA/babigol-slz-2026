const { createHmac, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { isIP } = require('node:net');
const { Problem } = require('./domain');

const derive = promisify(scrypt);
const age = 7200;
const cookie = '__Host-babigol-admin';
const rateLimit = () => new Problem(429, 'rate_limit', 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.');
const unauthorized = () => new Problem(401, 'unauthorized', 'Entre como administrador para continuar.');

function authConfig(env) {
  const hash = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(env.ADMIN_PASSWORD_HASH || '');
  const key = env.SESSION_SECRET || '';
  if (!hash || !/^[A-Za-z0-9_-]{43,86}$/.test(key) || Buffer.from(key, 'base64url').length < 32) {
    throw new Problem(503, 'configuration', 'O acesso administrativo ainda precisa de configuração no servidor.');
  }
  return { salt: Buffer.from(hash[1], 'hex'), expected: Buffer.from(hash[2], 'hex'),
    key: Buffer.from(key, 'base64url'), audience: (env.VERCEL_ENV || 'development') + ':' + env.AIRTABLE_BASE_ID };
}

function requireOrigin(req, env) {
  const host = req.headers.host || '';
  const local = (!env.VERCEL_ENV || env.VERCEL_ENV === 'development') &&
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const expected = (local ? 'http://' : 'https://') + host;
  if (!host || req.headers.origin !== expected ||
    (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
    throw new Problem(403, 'origin', 'Origem da solicitação inválida.');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw new Problem(415, 'content_type', 'Envie dados no formato JSON.');
  }
}

const sign = (value, key) => createHmac('sha256', key).update(value).digest('base64url');
const cookieHeader = (value, seconds) => cookie + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + seconds;

function createAuth({ env = process.env, store, now = Date.now } = {}) {
  const concurrent = new Set();
  const blocked = new Map();

  function session(req) {
    const value = (req.headers.cookie || '').split(/;\s*/).find(entry => entry.startsWith(cookie + '='))?.slice(cookie.length + 1);
    if (!value || value.length > 600) return false;
    const config = authConfig(env);
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) return false;
    const actual = Buffer.from(signature);
    const expected = Buffer.from(sign(payload, config.key));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    try {
      const { exp, aud } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return Number.isSafeInteger(exp) && exp > Math.floor(now() / 1000) && aud === config.audience;
    } catch {
      return false;
    }
  }

  async function login(req, password) {
    const config = authConfig(env);
    const raw = (req.headers['x-vercel-forwarded-for'] || '').split(',')[0].trim();
    const peer = sign(isIP(raw) ? raw : req.socket?.remoteAddress || 'unknown', config.key).slice(0, 24);
    for (const [key, until] of blocked) if (until <= now()) blocked.delete(key);
    if (concurrent.has(peer) || concurrent.size >= 4 || blocked.has(peer)) throw rateLimit();
    if (typeof password !== 'string' || Buffer.byteLength(password) < 1 || Buffer.byteLength(password) > 256) {
      throw unauthorized();
    }
    concurrent.add(peer);
    try {
      const attempts = await store.loginHistory(peer);
      if (attempts.length >= 5) {
        blocked.set(peer, now() + 900_000);
        throw rateLimit();
      }
      const actual = await derive(password, config.salt, config.expected.length, { N: 32768, maxmem: 67108864 });
      if (!timingSafeEqual(actual, config.expected)) {
        await store.failedLogin(peer);
        throw unauthorized();
      }
      const payload = Buffer.from(JSON.stringify({
        exp: Math.floor(now() / 1000) + age, aud: config.audience, nonce: randomBytes(16).toString('base64url'),
      })).toString('base64url');
      return cookieHeader(payload + '.' + sign(payload, config.key), age);
    } finally {
      concurrent.delete(peer);
    }
  }

  return { session, login, logout: () => cookieHeader('', 0) };
}

module.exports = { createAuth, authConfig, requireOrigin, unauthorized };
