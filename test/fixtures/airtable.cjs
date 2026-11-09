const rules = require('../../rules');
const { matchKeys } = require('../../server/domain');

const categories = ['Bebidas', 'Carnes', 'Acompanhamentos', 'Outros'];
const budget = [
  ['Chopp 50 L', 800, 'Bebidas'], ['Picanha 1,3 kg', 130, 'Carnes'], ['Fraldinha 1,5 kg', 82.5, 'Carnes'],
  ['Alcatra 1 kg', 60, 'Carnes'], ['Toscana premium 1,2 kg', 36, 'Carnes'], ['Lombo/pernil suíno 1 kg', 30, 'Carnes'],
  ['Sobrecoxa desossada 1 kg', 26, 'Carnes'], ['Farofa 800 g', 20, 'Acompanhamentos'], ['Vinagrete 1,5 kg', 30, 'Acompanhamentos'],
  ['Arroz cru 800 g', 8, 'Acompanhamentos'], ['Pão de alho 12 un.', 36, 'Acompanhamentos'], ['Carvão 6 kg', 55, 'Outros'],
  ['Sal e temperos', 20, 'Outros'], ['Água e gelo', 70, 'Bebidas'], ['Descartáveis', 35, 'Outros'],
];
const fields = {
  Participantes: { Participante: 'singleLineText', ID: 'number', Nick: 'singleLineText', Grupo: 'singleSelect', 'Posicao no Grupo': 'number' },
  Partidas: { Chave: 'singleLineText', Fase: 'singleSelect', Grupo: 'singleSelect', Ordem: 'number',
    'Mandante ID': 'number', 'Visitante ID': 'number', 'Gols mandante': 'number', 'Gols visitante': 'number', 'Vencedor ID': 'number' },
  Controle: { Chave: 'singleLineText', 'Codigo do Sorteio': 'singleLineText', 'Semente do Sorteio': 'number', Revisao: 'number',
    'Atualizado em': 'dateTime', 'Pessoas no Rateio': 'number', 'Cota Sugerida por Pessoa': 'currency' },
  Orcamento: { Item: 'singleLineText', Categoria: 'singleSelect', 'Valor estimado': 'currency', Ordem: 'number', Ativo: 'checkbox' },
};
const schema = Object.entries(fields).map(([name, columns]) => ({
  name, fields: Object.entries(columns).map(([column, type]) => ({
    name: column, type,
    ...(type === 'singleSelect' ? { options: { choices: (column === 'Categoria' ? categories : rules.groupNames).map(name => ({name})) } } : {}),
  })),
}));

function mockAirtable(now = Date.now) {
  const requests = [];
  const faults = [];
  let seq = 0;
  const create = fields => ({ id: 'rec' + String(++seq).padStart(14, '0'),
    createdTime: new Date(now()).toISOString(), fields: structuredClone(fields) });
  const data = {
    Participantes: rules.defaults().players.map(player => create({ ID: player.id, Participante: player.name })),
    Partidas: matchKeys.map((key, i) => create({ Chave: key, Ordem: i + 1 })),
    Controle: [create({ Chave: 'campeonato-2026', Revisao: 0, 'Pessoas no Rateio': 12, 'Cota Sugerida por Pessoa': 130 })],
    Orcamento: budget.map(([item, cost, category], i) => create({ Item: item, Categoria: category,
      'Valor estimado': cost, Ordem: i + 1, Ativo: true })),
  };
  const json = (value, status = 200) => Response.json(value, { status });
  async function fetcher(input, init) {
    const url = new URL(input);
    const [, version, base, rawTable, id] = url.pathname.split('/');
    if (version !== 'v0') return json({}, 404);
    if (base === 'meta') return json({ tables: schema });
    const table = decodeURIComponent(rawTable || '');
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : null;
    const request = { base, table, method, id, body };
    requests.push(request);
    const fail = faults.findIndex(entry => entry.matches(request));
    const fault = fail === -1 ? null : faults.splice(fail, 1)[0];
    if (fault?.phase === 'before') return json({}, 503);

    const rows = data[table];
    if (!rows) return json({}, 404);
    const row = rows.find(entry => entry.id === id);
    let result;
    if (method === 'GET') {
      let records = rows;
      const formula = url.searchParams.get('filterByFormula');
      if (formula?.startsWith('OR(')) {
        records = rows.filter(row => row.fields.Chave === 'campeonato-2026' || row.fields.Chave?.startsWith('__babigol_v3_write:'));
      }
      if (formula?.startsWith('AND(')) {
        const [, prefix, since] = /="([^"]+)",IS_AFTER\(CREATED_TIME\(\),DATETIME_PARSE\("([^"]+)"\)/.exec(formula) || [];
        records = rows.filter(row => row.fields.Chave?.startsWith(prefix) && Date.parse(row.createdTime) > Date.parse(since));
      }
      const start = Number(url.searchParams.get('offset') || 0);
      const size = Math.min(Number(url.searchParams.get('pageSize') || 100), 100);
      result = { records: records.slice(start, start + size), ...(records.length > start + size ? { offset: String(start + size) } : {}) };
    } else if (method === 'POST') {
      const record = create(body.fields);
      rows.push(record);
      result = record;
    } else if (method === 'PATCH') {
      const records = body.records || [{ id, fields: body.fields }];
      if (records.length > 10) return json({}, 422);
      result = { records: records.map(patch => {
        const target = rows.find(entry => entry.id === patch.id);
        if (!target) throw new Error('unknown mock record');
        for (const [key, value] of Object.entries(patch.fields)) {
          if (value === null || value === '' || value === false) delete target.fields[key];
          else target.fields[key] = value;
        }
        return target;
      }) };
      if (id) result = result.records[0];
    } else if (method === 'DELETE') {
      if (!row) return json({}, 404);
      rows.splice(rows.indexOf(row), 1);
      result = { id, deleted: true };
    } else {
      return json({}, 405);
    }
    return fault?.phase === 'after' ? json({}, 503) : json(result);
  }
  return { data, fetcher, requests, fail(matches, phase = 'before') { faults.push({ matches, phase }); } };
}

module.exports = { mockAirtable };
