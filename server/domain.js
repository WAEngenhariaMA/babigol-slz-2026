const { randomInt } = require('node:crypto');
const rules = require('../rules');

class Problem extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = message => { throw new Problem(400, 'invalid', message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const groupKeys = rules.groupNames.flatMap((_, g) => Array.from({ length: 6 }, (_, i) => g + '-' + i));
const knockoutKeys = ['q0', 'q1', 'q2', 'q3', 's0', 's1', 'final'];
const matchKeys = [...groupKeys, ...knockoutKeys];
const recordId = /^rec[a-zA-Z0-9]{14}$/;
const idValid = value => Number.isInteger(value) && value >= 0 && value < rules.names.length;
const goalValid = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) &&
  Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 9999;

function text(value, max, message, optional = false) {
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim()) ||
    /[\u0000-\u001f\u007f]/.test(value)) invalid(message);
  return value.trim();
}

function players(value) {
  if (!Array.isArray(value) || value.length !== rules.names.length ||
    value.some(player => !idValid(player?.id)) || new Set(value.map(player => player.id)).size !== rules.names.length) {
    invalid('O cadastro precisa conter os 12 IDs originais.');
  }
  return value.map(({ id, name, nick }) => ({
    id, name: text(name, 100, 'Informe um nome com até 100 caracteres.'),
    nick: text(nick, 80, 'O nick deve ter até 80 caracteres.', true),
  })).sort((a, b) => a.id - b.id);
}

function score(value, knockout = false) {
  if (value === null) return null;
  if (!record(value)) invalid('Placar inválido.');
  const { a, b, win } = value;
  if ((a == null || a === '') && (b == null || b === '')) return null;
  if (!goalValid(a) || !goalValid(b)) invalid('Informe dois placares inteiros não negativos.');
  const result = { a: String(Number(a)), b: String(Number(b)) };
  if (knockout) {
    result.win = '';
    if (result.a === result.b) {
      if (!goalValid(win) || !idValid(Number(win))) invalid('Selecione quem avançou no desempate.');
      result.win = String(Number(win));
    }
  }
  return result;
}

function scoreMap(value, allowed, isKnockout = false) {
  if (!record(value)) invalid('Mapa de placares inválido.');
  const entries = [];
  for (const [key, valueScore] of Object.entries(value)) {
    if (!allowed.includes(key)) invalid('Partida desconhecida no backup ou no envio.');
    const parsed = score(valueScore, isKnockout);
    if (parsed) entries.push([key, parsed]);
  }
  return Object.fromEntries(entries.sort(([a], [b]) => allowed.indexOf(a) - allowed.indexOf(b)));
}

function validateKnockout(state) {
  const matches = rules.knockout(rules.qualifiers(state), state.ko);
  for (const [key, entry] of Object.entries(state.ko)) {
    const match = matches.find(game => game.key === key);
    if (!match || rules.winner(match, { [key]: entry }) == null) {
      invalid('Há placares do mata-mata sem confronto ou desempate válido.');
    }
  }
}

function backup(value) {
  if (!record(value)) invalid('Selecione um backup JSON válido.');
  const ordered = players(value.players);
  const groups = value.groups;
  if (groups !== null && (!Array.isArray(groups) || groups.length !== 3 ||
    groups.some(group => !Array.isArray(group) || group.length !== 4 || group.some(id => !idValid(id))) ||
    new Set(groups.flat()).size !== 12)) invalid('O backup deve conter três grupos de quatro participantes distintos.');

  let draw = null;
  if (value.draw != null) {
    const { code, seed } = value.draw;
    if (!Number.isInteger(seed) || seed < 0 || seed >= 8 ** 8 || code !== rules.drawCode(seed) || !groups) {
      invalid('Código ou semente do sorteio inválido.');
    }
    const generated = rules.drawGroupsFromSeed(value.players, seed);
    if (JSON.stringify(generated) !== JSON.stringify(groups)) invalid('Os grupos não correspondem ao código do sorteio.');
    draw = { code, seed };
  }

  const state = {
    players: ordered, groups, draw,
    scores: scoreMap(value.scores, groupKeys),
    ko: scoreMap(value.ko, knockoutKeys, true),
  };
  if (!groups && Object.keys(state.scores).length) invalid('O backup contém placares sem grupos sorteados.');
  validateKnockout(state);
  return state;
}

function money(value) {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim().replace(',', '.') : '';
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) invalid('Informe um valor não negativo com até duas casas decimais.');
  return Math.round(Number(raw) * 100);
}

function budgetItem(value, categories) {
  if (!record(value)) invalid('Informe os dados do item.');
  const item = text(value.item, 120, 'Informe uma descrição com até 120 caracteres.');
  const category = text(value.category ?? '', 100, 'Categoria inválida.', true);
  if (category && !categories.includes(category)) invalid('Selecione uma categoria cadastrada no Airtable.');
  const order = value.order;
  if (!Number.isSafeInteger(order) || order < 0 || order > 99999) invalid('A ordem precisa ser um inteiro de 0 a 99999.');
  return { item, category, cents: money(value.amount), order };
}

function budgetSettings(people, quota) {
  if (!Number.isSafeInteger(people) || people < 1 || people > 9999) {
    invalid('Informe de 1 a 9999 pessoas para o rateio.');
  }
  return { people, quotaCents: money(quota) };
}

function restoreBudget(value, current) {
  if (!record(value) || !Array.isArray(value.items) || !Number.isSafeInteger(value.quotaCents) ||
    new Set(value.items.map(item => item?.id)).size !== value.items.length) invalid('Backup de orçamento inválido.');
  const items = value.items.map(item => {
    if (!record(item) || !current.items.some(existing => existing.id === item.id) ||
      typeof item.active !== 'boolean' || !Number.isSafeInteger(item.cents)) {
      invalid('O backup contém itens que não pertencem a esta base do Airtable.');
    }
    return { id: item.id, active: item.active, ...budgetItem({ ...item, amount: item.cents / 100 }, current.categories) };
  });
  return { items, settings: budgetSettings(value.people, value.quotaCents / 100) };
}

function change(action, input, current) {
  const { state, budget } = current;
  switch (action) {
    case 'participantes':
      return { state: { ...state, players: players(input.players) } };
    case 'sorteio': {
      if (state.groups && input.confirm !== true) invalid('Confirme que o sorteio anterior será substituído.');
      const seed = randomInt(8 ** 8);
      return { state: { ...state, groups: rules.drawGroupsFromSeed(state.players, seed),
        scores: {}, ko: {}, draw: { code: rules.drawCode(seed), seed } } };
    }
    case 'placares': {
      if (!state.groups) invalid('Faça o sorteio antes de registrar placares.');
      const scores = scoreMap(input.scores, groupKeys);
      const changed = JSON.stringify(scores) !== JSON.stringify(state.scores);
      if (changed && Object.keys(state.ko).length && input.confirm !== true) {
        invalid('Confirme o descarte dos placares do mata-mata.');
      }
      return { state: { ...state, scores, ko: changed ? {} : state.ko } };
    }
    case 'mata-mata': {
      const match = rules.knockout(rules.qualifiers(state), state.ko).find(game => game.key === input.key);
      if (!match || match.a == null || match.b == null) invalid('Os dois participantes do confronto precisam estar definidos.');
      const entry = score(input.score, true);
      if (entry && rules.winner(match, { [match.key]: entry }) == null) invalid('O vencedor do desempate deve disputar o confronto.');
      const { ko, discarded } = rules.changeKnockout(state, match.key, entry);
      if (discarded.length && input.confirm !== true) invalid('Confirme o descarte dos placares dependentes.');
      return { state: { ...state, ko } };
    }
    case 'importar':
      if (input.confirm !== true) invalid('Confirme a substituição dos dados pelo backup.');
      return { state: backup(input.backup), ...(input.restoreBudget === true ? restoreBudget(input.backup.budget, budget) : {}) };
    case 'reiniciar':
      if (input.confirm !== true) invalid('Confirme o reinício do campeonato.');
      return { state: rules.defaults() };
    case 'orcamento-adicionar':
      return { create: { ...budgetItem(input.item, budget.categories), active: true } };
    case 'orcamento-editar':
    case 'orcamento-ativo': {
      const previous = recordId.test(input.id) && budget.items.find(item => item.id === input.id);
      if (!previous) throw new Problem(404, 'not_found', 'Item do orçamento não encontrado.');
      if (action === 'orcamento-ativo') {
        if (typeof input.active !== 'boolean') invalid('Informe a situação do item.');
        return { item: { ...previous, active: input.active } };
      }
      return { item: { ...previous, ...budgetItem(input.item, budget.categories) } };
    }
    case 'orcamento-rateio':
      return { settings: budgetSettings(input.people, input.quota) };
    default:
      throw new Problem(404, 'not_found', 'Operação desconhecida.');
  }
}

module.exports = { Problem, invalid, record, recordId, groupKeys, knockoutKeys, matchKeys, backup, money, change };
