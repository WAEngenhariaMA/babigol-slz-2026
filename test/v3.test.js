const assert = require('node:assert/strict');
const { scryptSync } = require('node:crypto');
const { createServer } = require('node:http');
const test = require('node:test');
const rules = require('../rules');
const { handler } = require('../api/campeonato');
const { createStore, bases } = require('../server/airtable');
const { backup, money } = require('../server/domain');
const { mockAirtable } = require('./fixtures/airtable.cjs');

const password = 'fixture-tests-only';
const salt = Buffer.alloc(16, 1);
const env = {
  VERCEL_ENV: 'development', AIRTABLE_BASE_ID: bases.development, AIRTABLE_TOKEN: 'mock-token',
  ADMIN_PASSWORD_HASH: 'scrypt$' + salt.toString('hex') + '$' +
    scryptSync(password, salt, 32, { N: 32768, maxmem: 67108864 }).toString('hex'),
  SESSION_SECRET: Buffer.alloc(32, 2).toString('base64url'),
};

async function fixture(t, overrides = {}) {
  let time = Date.now();
  const now = () => time;
  const mock = mockAirtable(now);
  const config = { ...env, ...overrides };
  const store = createStore({ env: config, fetcher: mock.fetcher, requestInterval: 0, now });
  const server = createServer(handler({ env: config, store, now }));
  t.after(() => server.close());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  function client() {
    let cookie = '';
    return async (action, input, options = {}) => {
      const response = await fetch(origin + '/api/campeonato?acao=' + action + (options.fresh ? '&atualizar=1' : ''), {
        ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }),
        headers: { 'Content-Type': 'application/json', Origin: options.origin ?? origin, Cookie: cookie },
      });
      const set = response.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: response.status, value: await response.json(), set };
    };
  }
  return { ...mock, store, now, advance(ms) { time += ms; }, client,
    origin, async login(who) { assert.equal((await who('login', { password })).status, 200); } };
}

function unitFixtures() {
  const original = rules.defaults();
  const groups = rules.drawGroupsFromSeed(original.players, 123);
  const scores = Object.fromEntries(rules.fixtures({ groups }).map(game => [game.key, { a: '2', b: '0' }]));
  return { ...original, groups, scores, draw: { code: rules.drawCode(123), seed: 123 } };
}

test('regras compartilhadas, valores monetários e backups legados', () => {
  const state = unitFixtures();
  assert.equal(rules.fixtures(state).length, 18);
  assert.deepEqual(state.groups.map(group => group.length), [4, 4, 4]);
  assert.equal(new Set(state.groups.flat()).size, 12);
  assert.deepEqual(rules.qualifiers(state).groups.map(group => group.map(row => row.p)), Array(3).fill([9, 6, 3, 0]));
  const quarters = rules.knockout(rules.qualifiers(state), {}).slice(0, 4);
  assert.equal(new Set(quarters.flatMap(game => [game.a, game.b])).size, 8);
  assert.deepEqual(backup(state), state);
  const { draw, ...legacy } = state;
  assert.equal(backup(legacy).draw, null);
  assert.equal(money('130,05'), 13005);
  assert.equal(money('0'), 0);
  for (const value of ['1.234', '-0.01', '-1', '', '1e5', null]) assert.throws(() => money(value));
  assert.throws(() => backup({ ...legacy, scores: { '0-0': { a: [1], b: '2' } } }));
});

test('leitura pública, login/logout, CSRF, sessão e limite de tentativas', async t => {
  const fx = await fixture(t);
  const visitor = fx.client();
  const publicState = await visitor('estado');
  assert.equal(publicState.status, 200);
  assert.equal(publicState.value.budget.items.length, 15);
  assert.equal(publicState.value.budget.categories, undefined);
  assert.equal((await visitor('orcamento-adicionar', { version: publicState.value.version })).status, 401);
  assert.equal((await visitor('backup')).status, 401);

  const admin = fx.client();
  const login = await admin('login', { password });
  assert.equal(login.status, 200);
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(login.set.includes(flag));
  assert.equal((await admin('sessao')).value.admin, true);
  assert.equal((await admin('reiniciar', { confirm: true }, { origin: 'https://outro.example' })).status, 403);
  assert.equal((await admin('logout', {})).status, 200);
  assert.equal((await admin('sessao')).value.admin, false);
  assert.equal((await admin('reiniciar', { confirm: true })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await visitor('login', { password: 'errada' })).status, 401);
  assert.equal((await visitor('login', { password })).status, 429);
});

test('campeonato compartilhado, sorteio, placares, campeão, descarte seletivo e backup', async t => {
  const fx = await fixture(t);
  const admin = fx.client();
  const another = fx.client();
  await fx.login(admin);
  let current = (await admin('estado')).value;
  const mutate = async (action, input) => {
    const result = await admin(action, { ...input, version: current.version });
    assert.equal(result.status, 200, JSON.stringify(result.value));
    current = result.value;
    return current.state;
  };
  const newPlayers = current.state.players.map(player => player.id === 0 ? { ...player, nick: 'Capitão' } : player);
  await mutate('participantes', { players: newPlayers });
  assert.equal((await another('estado')).value.state.players[0].nick, 'Capitão');
  const drawn = await mutate('sorteio', {});
  assert.deepEqual(drawn.groups.map(group => group.length), [4, 4, 4]);
  assert.deepEqual(rules.drawGroupsFromSeed(newPlayers, drawn.draw.seed), drawn.groups);
  assert.deepEqual((await another('estado')).value.state.draw, drawn.draw);
  const scores = Object.fromEntries(rules.fixtures(drawn).map(game => [game.key, { a: '2', b: '0' }]));
  await mutate('placares', { scores });
  const qualified = rules.qualifiers(current.state);
  assert.equal(new Set(rules.knockout(qualified, {}).slice(0, 4).flatMap(game => [game.a, game.b])).size, 8);
  for (const key of ['q0', 'q1', 'q2', 'q3', 's0', 's1', 'final']) {
    const match = rules.knockout(qualified, current.state.ko).find(game => game.key === key);
    await mutate('mata-mata', { key, score: key === 'final' ?
      { a: '0', b: '0', win: String(match.a) } : { a: '2', b: '1', win: '' } });
  }
  const champion = () => rules.winner(rules.knockout(qualified, current.state.ko).at(-1), current.state.ko);
  assert.notEqual(champion(), null);
  const exported = (await admin('backup')).value;
  assert.equal(exported.budget.items.length, 15);
  await mutate('mata-mata', { key: 'q0', score: { a: '3', b: '0' } });
  assert.deepEqual(current.state.ko.final, exported.ko.final);
  const blocked = await admin('mata-mata', { version: current.version, key: 'q0', score: { a: '0', b: '3' } });
  assert.equal(blocked.status, 400);
  await mutate('mata-mata', { key: 'q0', score: { a: '0', b: '3' }, confirm: true });
  assert.equal(current.state.ko.s0, undefined);
  assert.equal(current.state.ko.final, undefined);
  assert.deepEqual(current.state.ko.s1, exported.ko.s1);
  assert.equal(champion(), null);
  assert.equal((await admin('importar', { version: current.version, backup: exported })).status, 400);
  await mutate('importar', { backup: exported, confirm: true });
  assert.deepEqual(current.state.ko, exported.ko);
  await mutate('mata-mata', { key: 's0', score: { a: '0', b: '3' }, confirm: true });
  assert.equal(current.state.ko.final, undefined);
  assert.deepEqual(current.state.ko.s1, exported.ko.s1);
  await mutate('reiniciar', { confirm: true });
  assert.deepEqual(current.state, rules.defaults());
  assert.equal(current.budget.items.length, 15);
});

test('orçamento por ID, ativação reversível, rateio, persistência e conflito', async t => {
  const fx = await fixture(t);
  const admin = fx.client();
  const visitor = fx.client();
  await fx.login(admin);
  let current = (await admin('estado')).value;
  const initialRows = structuredClone(fx.data.Orcamento);
  const total = state => state.budget.items.filter(item => item.active).reduce((sum, item) => sum + item.cents, 0);
  assert.equal(total(current), 143850);
  const request = (action, input, version = current.version) => admin(action, { ...input, version });
  const save = async (action, input) => {
    const result = await request(action, input);
    assert.equal(result.status, 200, JSON.stringify(result.value));
    current = result.value;
  };
  const newItem = { item: 'Item QA', category: 'Outros', amount: '20,15', order: 99 };
  const stale = current.version;
  await save('orcamento-adicionar', { item: newItem });
  assert.equal(total(current), 145865);
  const id = current.budget.items.find(item => item.item === 'Item QA').id;
  const staleResponse = await request('orcamento-editar', { id, item: newItem }, stale);
  assert.equal(staleResponse.status, 409);
  await save('orcamento-editar', { id, item: { item: 'Item QA editado', category: 'Carnes', amount: '21.25', order: 0 } });
  assert.equal(current.budget.items[0].id, id);
  assert.equal(current.budget.items[0].category, 'Carnes');
  assert.equal(total(current), 145975);
  await save('orcamento-ativo', { id, active: false });
  assert.equal(total(current), 143850);
  assert.equal((await visitor('estado')).value.budget.items.some(item => item.id === id), false);
  await save('orcamento-ativo', { id, active: true });
  assert.equal(total(current), 145975);
  await save('orcamento-rateio', { people: 10, quota: '150,50' });
  assert.equal(current.budget.people, 10);
  assert.equal(current.budget.quotaCents * current.budget.people - total(current), 4525);
  for (const amount of ['-1', '1,234', '']) assert.equal((await request('orcamento-editar', { id, item: { ...newItem, amount } })).status, 400);
  assert.equal((await request('orcamento-rateio', { people: 0, quota: '130' })).status, 400);
  assert.equal((await request('orcamento-ativo', { id: 'rec99999999999999', active: false })).status, 404);
  assert.deepEqual(fx.data.Orcamento.slice(0, 15), initialRows);
  assert.equal(fx.data.Orcamento.length, 16);
  fx.advance(46_000);
  const loaded = (await visitor('estado')).value;
  assert.equal(total(loaded), 145975);
  assert.equal(loaded.budget.quotaCents, 15050);

  const exported = (await admin('backup')).value;
  await save('orcamento-ativo', { id, active: false });
  await save('orcamento-rateio', { people: 12, quota: '130' });
  const crossBase = structuredClone(exported);
  crossBase.budget.items[0].id = 'rec99999999999999';
  assert.equal((await request('importar', { backup: crossBase, confirm: true, restoreBudget: true })).status, 400);
  await save('importar', { backup: exported, confirm: true, restoreBudget: true });
  assert.equal(total(current), 145975);
  assert.equal(current.budget.people, 10);
  assert.deepEqual(fx.data.Orcamento.slice(0, 15), initialRows);
});

test('falha parcial restaura registros e revisão invalida abas abertas', async t => {
  const fx = await fixture(t);
  const admin = fx.client();
  await fx.login(admin);
  const before = (await admin('estado')).value;
  fx.fail(req => req.table === 'Partidas' && req.method === 'PATCH', 'after');
  const failed = await admin('sorteio', { version: before.version });
  assert.equal(failed.status, 503);
  assert.equal(failed.value.error, 'rolled_back');
  const after = (await admin('estado', undefined, { fresh: true })).value;
  assert.deepEqual(after.state, before.state);
  assert.equal(after.revision, before.revision + 1);
  assert.equal((await admin('sorteio', { version: before.version })).status, 409);
  assert.equal(fx.data.Controle.length, 1);
});

test('criação incerta desativa o registro sem tocar nos quinze originais', async t => {
  const fx = await fixture(t);
  const admin = fx.client();
  await fx.login(admin);
  const before = (await admin('estado')).value;
  fx.fail(req => req.table === 'Orcamento' && req.method === 'POST', 'after');
  const failed = await admin('orcamento-adicionar', { version: before.version,
    item: { item: 'Teste ambíguo', category: 'Outros', amount: '2,25', order: 50 } });
  assert.equal(failed.status, 503);
  assert.equal(failed.value.error, 'rolled_back');
  const after = (await admin('estado', undefined, { fresh: true })).value;
  assert.equal(after.budget.items.filter(item => item.active).length, 15);
  assert.equal(after.budget.items.at(-1).active, false);
});

test('journal durável recupera falha de compensação em outra instância', async t => {
  const fx = await fixture(t);
  const admin = fx.client();
  await fx.login(admin);
  const before = (await admin('estado')).value;
  fx.fail(req => req.table === 'Partidas' && req.method === 'PATCH', 'after');
  fx.fail(req => req.table === 'Participantes' && req.method === 'PATCH' &&
    req.body.records.some(row => row.fields.Grupo === null));
  const failed = await admin('sorteio', { version: before.version });
  assert.equal(failed.value.error, 'recovery');
  assert.equal((await admin('estado', undefined, { fresh: true })).status, 409);
  fx.advance(125_000);
  const otherInstance = createStore({ env, fetcher: fx.fetcher, requestInterval: 0, now: fx.now });
  await assert.rejects(otherInstance.read(), { code: 'recovery' });
  assert.equal((await otherInstance.recover()).recovered, true);
  assert.deepEqual((await otherInstance.read()).state, before.state);
  assert.equal(fx.data.Controle.length, 1);
});

test('duas instâncias concorrentes e mesma revisão não sobrescrevem gravação', async t => {
  const fx = await fixture(t);
  const other = createStore({ env, fetcher: fx.fetcher, requestInterval: 0, now: fx.now });
  const before = await fx.store.read();
  const results = await Promise.allSettled([
    fx.store.mutate('orcamento-rateio', { version: before.version, people: 9, quota: '130' }),
    other.mutate('orcamento-rateio', { version: before.version, people: 11, quota: '130' }),
  ]);
  assert.ok(results.filter(result => result.status === 'fulfilled').length <= 1);
  for (const failed of results.filter(result => result.status === 'rejected')) assert.equal(failed.reason.status, 409);
  const after = await fx.store.read(true);
  assert.equal(after.revision, results.some(result => result.status === 'fulfilled') ? 1 : 0);
  assert.ok([9, 11, 12].includes(after.budget.people));
});

test('indisponibilidade, credenciais ausentes e bloqueio Preview → Production', async t => {
  const missing = await fixture(t, { AIRTABLE_TOKEN: '' });
  assert.equal((await missing.client()('estado')).value.error, 'configuration');
  assert.equal(missing.requests.length, 0);
  const mismatched = await fixture(t, { VERCEL_ENV: 'preview', AIRTABLE_BASE_ID: bases.production });
  await assert.rejects(mismatched.store.read(), { code: 'environment' });
  await assert.rejects(mismatched.store.mutate('reiniciar', { confirm: true }), { code: 'environment' });
  assert.equal(mismatched.requests.length, 0);
  const fx = await fixture(t);
  fx.fail(req => req.table === 'Participantes' && req.method === 'GET');
  assert.equal((await fx.client()('estado')).value.error, 'airtable');
});
