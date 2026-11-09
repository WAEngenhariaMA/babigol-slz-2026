const { createStore, airtableConfig } = require('../server/airtable');
const { createAuth, authConfig, requireOrigin, unauthorized } = require('../server/auth');
const { Problem, record } = require('../server/domain');

const reading = new Set(['estado', 'sessao', 'backup']);
const writing = new Set(['login', 'logout', 'participantes', 'sorteio', 'placares', 'mata-mata', 'importar', 'reiniciar',
  'orcamento-adicionar', 'orcamento-editar', 'orcamento-ativo', 'orcamento-rateio', 'recuperar']);

function publicState(payload, admin) {
  if (admin) return payload;
  const { categories, items, ...settings } = payload.budget;
  return { ...payload, budget: { ...settings, items: items.filter(item => item.active) } };
}

async function body(req) {
  const max = 65_536;
  if (Number(req.headers['content-length']) > max) throw new Problem(413, 'too_large', 'Arquivo grande demais.');
  let input = req.body;
  try {
    if (input === undefined) {
      const parts = [];
      let size = 0;
      for await (const part of req) {
        size += Buffer.byteLength(part);
        if (size > max) throw new Problem(413, 'too_large', 'Arquivo grande demais.');
        parts.push(part);
      }
      input = Buffer.concat(parts).toString('utf8');
    }
    if (typeof input === 'string' || Buffer.isBuffer(input)) input = JSON.parse(input.toString());
    if (!record(input)) throw new Error();
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(400, 'invalid_json', 'JSON inválido.');
  }
  return input;
}

function handler({ env = process.env, store = createStore({ env }), now = Date.now } = {}) {
  const auth = createAuth({ env, store, now });
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const action = url.searchParams.get('acao') || 'estado';
      const get = reading.has(action);
      if (!get && !writing.has(action)) throw new Problem(404, 'not_found', 'Operação desconhecida.');
      if (req.method !== (get ? 'GET' : 'POST')) {
        res.setHeader('Allow', get ? 'GET' : 'POST');
        throw new Problem(405, 'method', 'Método inválido.');
      }
      if (!get) requireOrigin(req, env);
      if (action === 'logout') {
        res.setHeader('Set-Cookie', auth.logout());
        return send(200, { admin: false });
      }
      if (action === 'sessao') return send(200, { admin: auth.session(req) });
      if (action === 'estado') {
        const admin = auth.session(req);
        const fresh = url.searchParams.get('atualizar') === '1' ? admin || 'public' : false;
        return send(200, publicState(await store.read(fresh), admin));
      }

      if (action !== 'login' && !auth.session(req)) throw unauthorized();
      airtableConfig(env);
      authConfig(env);
      if (action === 'login') {
        const input = await body(req);
        res.setHeader('Set-Cookie', await auth.login(req, input.password));
        return send(200, { admin: true });
      }
      if (action === 'backup') {
        const payload = await store.read(true);
        res.setHeader('Content-Disposition', 'attachment; filename="babigol-slz-campeonato.json"');
        return send(200, { ...payload.state, budget: payload.budget, exportedAt: new Date(now()).toISOString() });
      }
      const input = await body(req);
      if (action === 'recuperar') {
        if (input.confirm !== true) throw new Problem(400, 'invalid', 'Confirme a recuperação.');
        return send(200, await store.recover());
      }
      if (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)) {
        throw new Problem(400, 'invalid', 'Atualize os dados antes de editar.');
      }
      return send(200, await store.mutate(action, input));
    } catch (error) {
      if (error instanceof Problem) return send(error.status, { error: error.code, message: error.message });
      return send(500, { error: 'server', message: 'O servidor não confirmou a operação. Atualize antes de tentar novamente.' });
    }
  };
}

module.exports = handler();
module.exports.handler = handler;
