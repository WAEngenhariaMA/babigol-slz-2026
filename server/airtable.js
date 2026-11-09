const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const rules = require('../rules');
const { Problem, backup, change, matchKeys, knockoutKeys } = require('./domain');

const bases = { production: 'applelq32YWbB2Icp', preview: 'appAgvXJuUfI6X73J', development: 'appAgvXJuUfI6X73J' };
const controlKey = 'campeonato-2026';
const leasePrefix = '__babigol_v3_write:';
const leaseDuration = 120_000;
const tables = { players: 'Participantes', matches: 'Partidas', control: 'Controle', budget: 'Orcamento' };
const unavailable = () => new Problem(503, 'airtable', 'O Airtable está indisponível. Atualize os dados antes de tentar novamente.');
const inconsistent = () => new Problem(503, 'schema', 'Confira os campos e registros existentes nas tabelas do Airtable.');
const conflict = () => new Problem(409, 'conflict', 'Os dados mudaram ou outra gravação está em andamento. Atualize e revise sua edição.');
const recoveryRequired = () => new Problem(503, 'recovery', 'Uma gravação precisa de recuperação. Use a opção Recuperar gravação no modo administrador.');

function airtableConfig(env) {
  const target = env.VERCEL_ENV || (env.NODE_ENV === 'production' ? null : 'development');
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID) {
    throw new Problem(503, 'configuration', 'A integração ainda precisa de configuração no servidor.');
  }
  if (!bases[target] || env.AIRTABLE_BASE_ID !== bases[target]) {
    throw new Problem(503, 'environment', 'A base do Airtable não corresponde a este ambiente.');
  }
  return { target, base: env.AIRTABLE_BASE_ID, token: env.AIRTABLE_TOKEN };
}

const empty = value => value == null || value === '' || value === false;
const same = (a, b) => (empty(a) && empty(b)) || a === b;
const field = (row, key) => row.fields[key] ?? null;
const json = value => JSON.stringify(value);
const chunks = (values, size = 10) => Array.from({ length: Math.ceil(values.length / size) },
  (_, i) => values.slice(i * size, (i + 1) * size));

function uniqueMap(rows, key, expected, convert = value => value) {
  const result = new Map(rows.map(row => [convert(field(row, key)), row]));
  if (result.size !== rows.length || rows.length !== expected.length || !expected.every(value => result.has(value))) {
    throw inconsistent();
  }
  return result;
}

function groupLetter(value) {
  const name = String(value ?? '').replace(/^Grupo\s+/i, '').toUpperCase();
  return rules.groupNames.includes(name) ? name : null;
}

function createStore({ env = process.env, fetcher = fetch, requestInterval = 225, now = Date.now } = {}) {
  let nextRequest = 0;
  let stateCache;
  let inFlight;
  let schemaCache;

  async function request(path, method = 'GET', body) {
    const { base, token } = airtableConfig(env);
    const scheduled = Math.max(now(), nextRequest);
    nextRequest = scheduled + requestInterval;
    if (scheduled > now()) await sleep(scheduled - now());
    let response;
    try {
      response = await fetcher('https://api.airtable.com/v0/' + path(base), {
        method, redirect: 'error', signal: AbortSignal.timeout(6500),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : json(body),
      });
      if (!response.ok) throw unavailable();
      return await response.json();
    } catch {
      throw unavailable();
    }
  }

  const tablePath = (table, suffix = '') => base => base + '/' + encodeURIComponent(table) + suffix;
  async function list(table, filter) {
    const records = [];
    let offset;
    do {
      const query = new URLSearchParams({ pageSize: '100' });
      if (filter) query.set('filterByFormula', filter);
      if (offset) query.set('offset', offset);
      const page = await request(tablePath(table, '?' + query));
      if (!Array.isArray(page.records)) throw inconsistent();
      records.push(...page.records);
      if (records.length > 2000 || (offset && offset === page.offset)) throw inconsistent();
      offset = page.offset;
    } while (offset);
    return records;
  }

  const create = (table, fields) => request(tablePath(table), 'POST', { fields });
  const patchOne = (table, id, fields) => request(tablePath(table, '/' + id), 'PATCH', { fields });
  const remove = (table, id) => request(tablePath(table, '/' + id), 'DELETE');

  async function schema() {
    if (schemaCache?.expires > now()) return schemaCache.fields;
    const meta = await request(base => 'meta/bases/' + base + '/tables');
    const fields = Object.fromEntries((meta.tables || []).map(table =>
      [table.name, Object.fromEntries(table.fields.map(entry => [entry.name, entry]))]));
    if (Object.values(tables).some(table => !fields[table]) ||
      fields[tables.budget].Categoria?.type !== 'singleSelect' ||
      !['singleLineText', 'multilineText'].includes(fields[tables.control].Chave?.type)) throw inconsistent();
    schemaCache = { fields, expires: now() + 300_000 };
    return fields;
  }

  function control(rows) {
    const matches = rows.filter(row => field(row, 'Chave') === controlKey);
    if (matches.length !== 1) throw inconsistent();
    return matches[0];
  }

  function leases(rows) {
    return rows.filter(row => String(field(row, 'Chave')).startsWith(leasePrefix)).map(row => {
      const value = field(row, 'Chave').slice(leasePrefix.length);
      const separator = value.indexOf(':');
      const created = Date.parse(row.createdTime);
      return {
        ...row, active: !Number.isFinite(created) || now() - created < leaseDuration,
        journal: separator < 0 ? null : value.slice(separator + 1),
      };
    });
  }

  const readControls = () => list(tables.control, 'OR({Chave}="' + controlKey + '",LEFT({Chave},' +
    leasePrefix.length + ')="' + leasePrefix + '")');

  function ensureReadable(rows, allowedId) {
    for (const lease of leases(rows)) {
      if (lease.id === allowedId) continue;
      if (!lease.active && lease.journal) throw recoveryRequired();
      if (lease.active) throw conflict();
    }
  }

  async function snapshot(rows) {
    const [playerRows, matchRows, budgetRows, fields] = await Promise.all([
      list(tables.players), list(tables.matches), list(tables.budget), schema(),
    ]);
    const controlRow = control(rows);
    const players = uniqueMap(playerRows, 'ID', rules.names.map((_, id) => id),
      value => empty(value) ? NaN : Number(value));
    const matches = uniqueMap(matchRows, 'Chave', matchKeys);
    const ordered = [...players.entries()].sort(([a], [b]) => a - b);
    const withGroup = ordered.filter(([, row]) => !empty(field(row, 'Grupo')));
    let groups = null;
    if (withGroup.length) {
      if (withGroup.length !== 12) throw inconsistent();
      groups = rules.groupNames.map(group => {
        const members = withGroup.filter(([, row]) => groupLetter(field(row, 'Grupo')) === group)
          .map(([id, row]) => ({ id, position: field(row, 'Posicao no Grupo') }))
          .sort((a, b) => Number(a.position) - Number(b.position));
        if (members.length !== 4 || members.some(entry => empty(entry.position))) throw inconsistent();
        const start = Number(members[0].position);
        if ((start !== 0 && start !== 1) || members.some((entry, i) => Number(entry.position) !== start + i)) {
          throw inconsistent();
        }
        return members.map(entry => entry.id);
      });
    }

    const seed = field(controlRow, 'Semente do Sorteio');
    const code = field(controlRow, 'Codigo do Sorteio');
    const scores = {};
    const ko = {};
    for (const [key, row] of matches) {
      const a = field(row, 'Gols mandante');
      const b = field(row, 'Gols visitante');
      if (empty(a) && empty(b)) continue;
      if (knockoutKeys.includes(key)) ko[key] = { a, b, win: field(row, 'Vencedor ID') };
      else scores[key] = { a, b };
    }
    let state;
    try {
      state = backup({ players: ordered.map(([id, row]) => ({
        id, name: field(row, 'Participante'), nick: field(row, 'Nick') || '',
      })), groups, scores, ko, draw: empty(code) && empty(seed) ? null : { code, seed: Number(seed) } });
    } catch {
      throw inconsistent();
    }
    const people = Number(field(controlRow, 'Pessoas no Rateio'));
    const quota = field(controlRow, 'Cota Sugerida por Pessoa');
    const revision = Number(field(controlRow, 'Revisao') ?? 0);
    if (!Number.isSafeInteger(people) || people < 1 || people > 9999 || quota == null ||
      !Number.isSafeInteger(revision) || revision < 0) throw inconsistent();
    const cents = value => {
      const number = Number(value);
      const rounded = Math.round(number * 100);
      if (value == null || !Number.isSafeInteger(rounded) || number < 0 ||
        Math.abs(number * 100 - rounded) > 0.0001) throw inconsistent();
      return rounded;
    };
    const budget = {
      people, quotaCents: cents(quota),
      categories: (fields[tables.budget].Categoria.options?.choices || []).map(choice => choice.name),
      items: budgetRows.map(row => {
        const item = field(row, 'Item');
        const order = Number(field(row, 'Ordem') ?? 0);
        if (typeof item !== 'string' || !item.trim() || !Number.isSafeInteger(order) || order < 0) throw inconsistent();
        return { id: row.id, item, category: field(row, 'Categoria') || '',
          cents: cents(field(row, 'Valor estimado')), order, active: field(row, 'Ativo') === true };
      }).sort((a, b) => a.order - b.order || a.item.localeCompare(b.item, 'pt-BR') || a.id.localeCompare(b.id)),
    };
    const updatedAt = field(controlRow, 'Atualizado em');
    const version = createHash('sha256').update(json({ revision, updatedAt, state, budget })).digest('hex');
    const payload = { version, revision, updatedAt, state, budget };
    const raw = { [tables.players]: players, [tables.matches]: matches, [tables.control]: new Map([[controlKey, controlRow]]),
      [tables.budget]: new Map(budgetRows.map(row => [row.id, row])) };
    return { ...payload, payload, raw, fields };
  }

  function checkSchema(fields, table, key, value) {
    const column = fields[table][key];
    if (!column) throw inconsistent();
    if (value == null) return null;
    if (['singleLineText', 'multilineText'].includes(column.type)) return String(value);
    if (column.type === 'singleSelect') {
      const choices = column.options?.choices || [];
      const found = choices.find(choice => choice.name === value) ||
        (key === 'Grupo' && choices.find(choice => groupLetter(choice.name) === value));
      if (!found) throw inconsistent();
      return found.name;
    }
    return value;
  }

  function plan(before, changeSet) {
    const edits = [];
    const add = (table, key, desired) => {
      const row = before.raw[table].get(key);
      if (!row) throw inconsistent();
      const changes = Object.entries(desired).map(([column, value]) =>
        [column, field(row, column), checkSchema(before.fields, table, column, value)])
        .filter(([, was, next]) => !same(was, next));
      if (changes.length) edits.push({
        table, id: row.id, before: Object.fromEntries(changes.map(([column, was]) => [column, was])),
        after: Object.fromEntries(changes.map(([column, , next]) => [column, next])),
      });
    };
    const budgetFields = item => ({
      Item: item.item, Categoria: item.category || null, 'Valor estimado': item.cents / 100,
      Ordem: item.order, Ativo: item.active,
    });
    const settings = changeSet.settings ? {
      'Pessoas no Rateio': changeSet.settings.people,
      'Cota Sugerida por Pessoa': changeSet.settings.quotaCents / 100,
    } : {};
    for (const item of changeSet.items || (changeSet.item ? [changeSet.item] : [])) {
      add(tables.budget, item.id, budgetFields(item));
    }

    if (changeSet.state) {
      const { state } = changeSet;
      for (const player of state.players) {
        const group = state.groups?.findIndex(ids => ids.includes(player.id)) ?? -1;
        add(tables.players, player.id, {
          Participante: player.name, Nick: player.nick || null,
          Grupo: group === -1 ? null : rules.groupNames[group],
          'Posicao no Grupo': group === -1 ? null : state.groups[group].indexOf(player.id) + 1,
        });
      }
      const fixtures = [...rules.fixtures(state), ...rules.knockout(rules.qualifiers(state), state.ko)];
      for (const key of matchKeys) {
        const match = fixtures.find(game => game.key === key);
        const score = state.scores[key] || state.ko[key];
        const winner = !score || !match ? null : rules.winner(match, { [key]: score });
        add(tables.matches, key, {
          'Mandante ID': match?.a ?? null, 'Visitante ID': match?.b ?? null,
          'Gols mandante': score ? Number(score.a) : null, 'Gols visitante': score ? Number(score.b) : null,
          'Vencedor ID': winner,
        });
      }
      settings['Codigo do Sorteio'] = state.draw?.code ?? null;
      settings['Semente do Sorteio'] = state.draw?.seed ?? null;
    }
    if (Object.keys(settings).length) add(tables.control, controlKey, settings);
    const creation = changeSet.create ? {
      fields: Object.fromEntries(Object.entries(budgetFields(changeSet.create)).map(([key, value]) =>
        [key, checkSchema(before.fields, tables.budget, key, value)])),
      ids: [...before.raw[tables.budget].keys()],
    } : null;
    if (edits.length || creation) {
      const row = before.raw[tables.control].get(controlKey);
      const revisionFields = { Revisao: before.revision + 1 };
      if (before.fields[tables.control]['Atualizado em']?.type === 'dateTime') {
        revisionFields['Atualizado em'] = new Date(now()).toISOString();
      }
      add(tables.control, controlKey, revisionFields);
    }
    return { edits, creation };
  }

  async function writeEdits(edits, direction) {
    for (const table of [tables.players, tables.matches, tables.budget, tables.control]) {
      const patches = edits.filter(edit => edit.table === table)
        .map(edit => ({ id: edit.id, fields: edit[direction] }));
      // Merge fields when rateio/draw and revision both touch the same control record.
      const byId = new Map();
      for (const patch of patches) byId.set(patch.id, { ...byId.get(patch.id), ...patch.fields });
      const records = [...byId].map(([id, fields]) => ({ id, fields }));
      for (const batch of chunks(records)) await request(tablePath(table), 'PATCH', { records: batch });
    }
  }

  const fieldsMatch = (row, expected) => row && Object.entries(expected).every(([key, value]) =>
    same(field(row, key), value));

  async function affectedRows(transaction) {
    const names = new Set(transaction.edits.map(edit => edit.table));
    if (transaction.creation) names.add(tables.budget);
    const rows = await Promise.all([...names].map(async table => [table, await list(table)]));
    return Object.fromEntries(rows.map(([table, entries]) => [table, new Map(entries.map(row => [row.id, row]))]));
  }

  async function rollback(transaction) {
    const rows = await affectedRows(transaction);
    const safe = transaction.edits.map(edit => {
      const row = rows[edit.table].get(edit.id);
      if (!row) throw recoveryRequired();
      const before = {};
      for (const [key, old] of Object.entries(edit.before)) {
        const value = field(row, key);
        if (key === 'Revisao' && edit.table === tables.control) {
          // Even a reverted mutation invalidates reads that overlapped its partial writes.
          if (!same(value, old) && !same(value, edit.after[key])) throw recoveryRequired();
          if (!same(value, edit.after[key])) before[key] = edit.after[key];
          continue;
        }
        if (same(value, old)) continue;
        if (!same(value, edit.after[key])) throw recoveryRequired();
        before[key] = old;
      }
      return { ...edit, before };
    }).filter(edit => Object.keys(edit.before).length);
    const created = transaction.creation && [...rows[tables.budget].values()].filter(row =>
      !transaction.creation.ids.includes(row.id));
    if (created?.length > 1) throw recoveryRequired();
    if (created?.length === 1) {
      const { Ativo, ...identity } = transaction.creation.fields;
      if (!fieldsMatch(created[0], identity)) throw recoveryRequired();
      if (field(created[0], 'Ativo')) await patchOne(tables.budget, created[0].id, { Ativo: false });
    }
    await writeEdits(safe, 'before');
    const verified = await affectedRows(transaction);
    if (transaction.edits.some(edit => !fieldsMatch(verified[edit.table].get(edit.id), {
      ...edit.before, ...('Revisao' in edit.after ? { Revisao: edit.after.Revisao } : {}),
    })) ||
      (created?.length && !fieldsMatch(verified[tables.budget].get(created[0].id), { Ativo: false }))) {
      throw recoveryRequired();
    }
  }

  async function acquire(recover = false) {
    const nonce = leasePrefix + randomUUID();
    const claim = await create(tables.control, { Chave: nonce });
    try {
      const rows = await readControls();
      const others = leases(rows).filter(lease => lease.id !== claim.id);
      if (!leases(rows).some(lease => lease.id === claim.id) || others.some(lease => lease.active)) throw conflict();
      const journals = others.filter(lease => lease.journal);
      if ((!recover && journals.length) || journals.length > 1) throw recoveryRequired();
      return { claim, nonce, rows, journal: journals[0] };
    } catch (error) {
      await remove(tables.control, claim.id).catch(() => {});
      throw error;
    }
  }

  const remember = current => {
    const at = now();
    stateCache = { checkedAt: at, fullAt: at, payload: current.payload, control: current.raw[tables.control].get(controlKey) };
    return current.payload;
  };

  async function read(fresh = false) {
    airtableConfig(env);
    const maxAge = fresh === true ? 0 : fresh === 'public' ? 8_000 : 35_000;
    if (stateCache && now() - stateCache.checkedAt < maxAge) return stateCache.payload;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const rows = await readControls();
      ensureReadable(rows);
      const controlBefore = control(rows);
      if (!fresh && stateCache && now() - stateCache.fullAt < 300_000 &&
        fieldsMatch(controlBefore, stateCache.control.fields) && fieldsMatch(stateCache.control, controlBefore.fields)) {
        stateCache.checkedAt = now();
        return stateCache.payload;
      }
      const current = await snapshot(rows);
      const after = await readControls();
      ensureReadable(after);
      const row = control(after);
      if (!fieldsMatch(row, controlBefore.fields) || !fieldsMatch(controlBefore, row.fields)) throw conflict();
      return remember(current);
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  async function mutate(action, input) {
    airtableConfig(env);
    const { claim, nonce, rows } = await acquire();
    let transaction;
    let started = false;
    let retain = false;
    try {
      const before = await snapshot(rows);
      if (input.version !== before.version) throw conflict();
      transaction = plan(before, change(action, input, before));
      if (!transaction.edits.length && !transaction.creation) return remember(before);
      const encoded = Buffer.from(json(transaction)).toString('base64url');
      if (encoded.length > 90_000) throw new Problem(413, 'too_large', 'A operação é grande demais para uma gravação segura.');
      await patchOne(tables.control, claim.id, { Chave: nonce + ':' + encoded });
      const held = await readControls();
      ensureReadable(held, claim.id);
      if (!leases(held).some(lease => lease.id === claim.id && lease.active && lease.journal === encoded)) throw conflict();
      started = true;
      let created;
      if (transaction.creation) created = await create(tables.budget, transaction.creation.fields);
      await writeEdits(transaction.edits, 'after');
      const verified = await affectedRows(transaction);
      if (transaction.edits.some(edit => !fieldsMatch(verified[edit.table].get(edit.id), edit.after)) ||
        (transaction.creation && !fieldsMatch(verified[tables.budget].get(created.id), transaction.creation.fields))) {
        throw unavailable();
      }
      const after = await snapshot(await readControls());
      // Invalidate a read that began before the write, and publish only the verified state.
      return remember(after);
    } catch (error) {
      if (!started) throw error;
      stateCache = null;
      try {
        await rollback(transaction);
      } catch {
        retain = true;
        throw recoveryRequired();
      }
      throw new Problem(503, 'rolled_back', 'A gravação falhou. Os dados anteriores foram restaurados. Atualize antes de tentar novamente.');
    } finally {
      if (!retain) await remove(tables.control, claim.id);
    }
  }

  async function recover() {
    const { claim, journal } = await acquire(true);
    try {
      if (!journal) return { recovered: false };
      const transaction = JSON.parse(Buffer.from(journal.journal, 'base64url').toString('utf8'));
      const rows = await affectedRows(transaction);
      const committed = transaction.edits.every(edit => fieldsMatch(rows[edit.table].get(edit.id), edit.after)) &&
        (!transaction.creation || [...rows[tables.budget].values()].filter(row =>
          !transaction.creation.ids.includes(row.id) && fieldsMatch(row, transaction.creation.fields)).length === 1);
      if (!committed) await rollback(transaction);
      await remove(tables.control, journal.id);
      stateCache = null;
      return { recovered: true };
    } catch {
      throw recoveryRequired();
    } finally {
      await remove(tables.control, claim.id);
    }
  }

  const attemptPrefix = '__babigol_v3_login:';
  async function loginHistory(peer) {
    const prefix = attemptPrefix + peer + ':';
    const since = new Date(now() - 900_000).toISOString();
    return list(tables.control, 'AND(LEFT({Chave},' + prefix.length + ')="' + prefix +
      '",IS_AFTER(CREATED_TIME(),DATETIME_PARSE("' + since + '")))');
  }
  async function failedLogin(peer) {
    await create(tables.control, { Chave: attemptPrefix + peer + ':' + randomUUID() });
  }

  return { read, mutate, recover, loginHistory, failedLogin };
}

module.exports = { createStore, airtableConfig, bases };
