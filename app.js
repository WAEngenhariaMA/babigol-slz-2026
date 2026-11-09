const storageKey = 'babigol2026';
const names = [
  'Danillo Lopes', 'Távora', 'Danillo Araújo', 'Brian', 'Tainan', 'Wesley',
  'Charles', 'Gustavo', 'Wellington', 'Erick', 'Leandro', 'Saulo',
];
const groupNames = ['A', 'B', 'C'];
const groupPairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function defaults() {
  return {
    players: names.map((name, id) => ({ id, name, nick: '' })),
    groups: null,
    scores: {},
    ko: {},
  };
}

let data;
try {
  data = JSON.parse(localStorage.getItem(storageKey)) || defaults();
} catch {
  data = defaults();
}

let feedbackTimer;
function notify(message, error = false) {
  const feedback = $('feedback');
  clearTimeout(feedbackTimer);
  feedback.dataset.error = String(error);
  feedback.textContent = message;
  if (message) feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 6500);
}

function persist(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    notify('Não foi possível salvar os dados neste navegador.', true);
    return false;
  }
  data = next;
  render();
  return true;
}

function showView(id) {
  document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== id; });
  $('nav').querySelectorAll('[data-view]').forEach(button => {
    if (button.dataset.view === id) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  notify('');
  $(id + '-titulo').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function playerLabel(id) {
  const player = data.players.find(entry => entry.id === id);
  return player ? player.nick.trim() || player.name : 'A definir';
}

function fixtures() {
  if (!data.groups) return [];
  return data.groups.flatMap((group, g) => groupPairs.map(([a, b], index) => ({
    key: `${g}-${index}`, a: group[a], b: group[b], g,
  })));
}

function hasScore(score) {
  return score && score.a !== '' && score.b !== '' && score.a != null && score.b != null;
}

function standings(g) {
  const rows = data.groups[g].map(id => ({ id, p: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0 }));
  for (const fixture of fixtures().filter(match => match.g === g)) {
    const score = data.scores[fixture.key];
    if (!hasScore(score)) continue;
    const a = rows.find(row => row.id === fixture.a);
    const b = rows.find(row => row.id === fixture.b);
    const x = Number(score.a);
    const y = Number(score.b);
    a.j++;
    b.j++;
    a.gp += x;
    a.gc += y;
    b.gp += y;
    b.gc += x;
    a.sg += x - y;
    b.sg += y - x;
    if (x > y) {
      a.v++;
      b.d++;
      a.p += 3;
    } else if (y > x) {
      b.v++;
      a.d++;
      b.p += 3;
    } else {
      a.e++;
      b.e++;
      a.p++;
      b.p++;
    }
  }
  return rows.sort(rank);
}

function rank(a, b) {
  return b.p - a.p || b.sg - a.sg || b.gp - a.gp || a.id - b.id;
}

function qualifiers(matches) {
  if (matches.length !== 18 || !matches.every(match => hasScore(data.scores[match.key]))) return null;
  const groups = groupNames.map((_, g) => standings(g));
  const thirds = groups.map((rows, g) => ({ ...rows[2], g })).sort(rank);
  return { groups, thirds };
}

function winner(match) {
  const score = data.ko[match.key];
  if (match.a == null || match.b == null || !hasScore(score)) return null;
  const a = Number(score.a);
  const b = Number(score.b);
  if (a > b || (a === b && score.win === String(match.a))) return match.a;
  if (b > a || (a === b && score.win === String(match.b))) return match.b;
  return null;
}

function knockout(qualified) {
  if (!qualified) return [];
  const { groups, thirds } = qualified;
  const [a, b, c] = groups;
  const pair = thirds.slice(0, 2);
  if (pair[0].g === 0 || pair[1].g === 1) {
    if (pair[1].g !== 0 && pair[0].g !== 1) pair.reverse();
  }
  const quarters = [[a[0].id, pair[0].id], [b[0].id, pair[1].id], [c[0].id, a[1].id], [b[1].id, c[1].id]]
    .map(([home, away], i) => ({ key: `q${i}`, a: home, b: away }));
  const semis = [
    { key: 's0', a: winner(quarters[0]), b: winner(quarters[1]) },
    { key: 's1', a: winner(quarters[2]), b: winner(quarters[3]) },
  ];
  return [...quarters, ...semis, { key: 'final', a: winner(semis[0]), b: winner(semis[1]) }];
}

function emptyState(title, text, target, button) {
  return `<div class="card empty-state">
    <h2>${title}</h2><p>${text}</p>
    <button class="button secondary" type="button" data-view="${target}">${button}</button>
  </div>`;
}

function renderPlayers() {
  $('players').innerHTML = data.players.map(player => `
    <article class="card player-card">
      <h2 class="player-title"><span class="player-number" aria-hidden="true">${String(player.id + 1).padStart(2, '0')}</span> Participante <span class="sr-only">${player.id + 1}</span></h2>
      <label for="name${player.id}">Nome</label>
      <input id="name${player.id}" type="text" value="${escapeHtml(player.name)}" autocomplete="off">
      <label for="nick${player.id}">Nick / time</label>
      <input id="nick${player.id}" type="text" value="${escapeHtml(player.nick)}" placeholder="Digite o nick" autocomplete="off" autocapitalize="off" spellcheck="false">
    </article>`).join('');
}

function renderGroups(qualified) {
  const confirmed = new Set(qualified ? [
    ...qualified.groups.flatMap(rows => rows.slice(0, 2).map(row => row.id)),
    ...qualified.thirds.slice(0, 2).map(row => row.id),
  ] : []);
  $('standings-legend').hidden = !data.groups;
  $('standings-legend').innerHTML = qualified
    ? '<span class="legend-mark">■ Classificado</span> · J = jogos · Pts = pontos · SG = saldo de gols'
    : 'J = jogos · Pts = pontos · SG = saldo de gols';
  $('groupcards').innerHTML = data.groups ? groupNames.map((group, index) => `
    <article class="card group-card">
      <h2 class="group-title"><span class="round-number" aria-hidden="true">${group}</span> Grupo ${group}</h2>
      <table>
        <caption class="sr-only">Classificação do grupo ${group}</caption>
        <thead><tr><th scope="col" aria-label="Posição">#</th><th scope="col">Time</th>
          <th scope="col" class="num" aria-label="Jogos">J</th>
          <th scope="col" class="num" aria-label="Pontos">Pts</th>
          <th scope="col" class="num" aria-label="Saldo de gols">SG</th></tr></thead>
        <tbody>${standings(index).map((row, position) => `
          <tr${confirmed.has(row.id) ? ' class="qualified"' : ''}>
            <td class="position">${position + 1}</td>
            <th scope="row">${escapeHtml(playerLabel(row.id))}${confirmed.has(row.id) ? '<span class="sr-only"> (classificado)</span>' : ''}</th>
            <td class="num">${row.j}</td><td class="num points">${row.p}</td><td class="num">${row.sg}</td>
          </tr>`).join('')}</tbody>
      </table>
    </article>`).join('') : emptyState('Aguardando sorteio', 'As tabelas serão exibidas assim que os grupos forem definidos.', 'sorteio', 'Ir para o sorteio');
}

function scoreField(id, team, value, max = '') {
  return `<label class="team-row">
    <span class="team-name"><span class="sr-only">Gols de </span>${escapeHtml(team)}</span>
    <input id="${id}" type="number" min="0" ${max} inputmode="numeric" value="${escapeHtml(value)}" placeholder="–">
  </label>`;
}

function renderScores(matches) {
  $('score-actions').hidden = matches.length === 0;
  $('games').innerHTML = matches.length ? groupNames.map((group, g) => `
    <article class="card score-group">
      <h2 class="score-title"><span class="round-number" aria-hidden="true">${group}</span> Grupo ${group}</h2>
      ${matches.filter(match => match.g === g).map((match, index) => {
        const score = data.scores[match.key] || {};
        return `<div class="match" role="group" aria-labelledby="jogo-${match.key}">
          <p class="match-name" id="jogo-${match.key}">Jogo ${group}${index + 1}</p>
          ${scoreField('a' + match.key, playerLabel(match.a), score.a, 'max="99"')}
          ${scoreField('b' + match.key, playerLabel(match.b), score.b, 'max="99"')}
        </div>`;
      }).join('')}
    </article>`).join('') : emptyState('Nenhum jogo disponível', 'Faça o sorteio para liberar os 18 jogos da fase de grupos.', 'sorteio', 'Ir para o sorteio');
}

const rounds = [
  { title: 'Quartas de final', slots: [
    ['Q1', '1º do grupo A', 'Um dos melhores terceiros'],
    ['Q2', '1º do grupo B', 'Um dos melhores terceiros'],
    ['Q3', '1º do grupo C', '2º do grupo A'],
    ['Q4', '2º do grupo B', '2º do grupo C'],
  ] },
  { title: 'Semifinais', slots: [
    ['S1', 'Vencedor de Q1', 'Vencedor de Q2'],
    ['S2', 'Vencedor de Q3', 'Vencedor de Q4'],
  ] },
  { title: 'Final', slots: [['Decisão', 'Vencedor de S1', 'Vencedor de S2']] },
];

function bracketMatch(match, [title, seedA, seedB]) {
  if (!match) {
    return `<div class="fixture"><p class="match-name">${title}</p><span class="seed">${seedA}</span><span class="seed">${seedB}</span></div>`;
  }
  const score = data.ko[match.key] || {};
  const teamA = match.a == null ? seedA : playerLabel(match.a);
  const teamB = match.b == null ? seedB : playerLabel(match.b);
  const options = [match.a, match.b].filter(id => id != null).map(id =>
    `<option value="${id}"${score.win === String(id) ? ' selected' : ''}>${escapeHtml(playerLabel(id))}</option>`
  ).join('');
  return `<div class="fixture" role="group" aria-labelledby="partida-${match.key}">
    <p class="match-name" id="partida-${match.key}">${title}</p>
    ${scoreField('ka' + match.key, teamA, score.a)}
    ${scoreField('kb' + match.key, teamB, score.b)}
    <label>Desempate
      <select id="kw${match.key}"><option value="">Quem avançou?</option>${options}</select>
    </label>
  </div>`;
}

function renderBracket(matches, completedGames) {
  $('knockout-actions').hidden = matches.length === 0;
  const champion = matches.length ? winner(matches.at(-1)) : null;
  let offset = 0;
  const columns = rounds.map(({ title, slots }, index) => {
    const cards = slots.map((slot, i) => `<div class="round-slot">${bracketMatch(matches[offset + i], slot)}</div>`).join('');
    offset += slots.length;
    return `<section class="round">
      <h2 class="round-heading"><span class="round-number" aria-hidden="true">${index + 1}</span> ${title}</h2>
      <div class="round-matches">${cards}</div>
    </section>`;
  }).join('');
  const note = matches.length ? '' : `<p class="notice bracket-note">O mata-mata será liberado após os 18 jogos da fase de grupos. ${completedGames}/18 concluídos.</p>`;
  const championCard = champion == null ? '' : `<div class="card champion"><p class="eyebrow">Campeão · 1º lugar</p><strong>${escapeHtml(playerLabel(champion))}</strong></div>`;
  $('bracket').innerHTML = note + championCard + `<div class="rounds">${columns}</div>`;
}

function renderBudget() {
  const items = [
    ['Chopp 50 L', 800], ['Picanha 1,3 kg', 130], ['Fraldinha 1,5 kg', 82.5],
    ['Alcatra 1 kg', 60], ['Toscana premium 1,2 kg', 36], ['Lombo/pernil suíno 1 kg', 30],
    ['Sobrecoxa desossada 1 kg', 26], ['Farofa 800 g', 20], ['Vinagrete 1,5 kg', 30],
    ['Arroz cru 800 g', 8], ['Pão de alho 12 un.', 36], ['Carvão 6 kg', 55],
    ['Sal e temperos', 20], ['Água e gelo', 70], ['Descartáveis', 35],
  ];
  const sum = items.reduce((total, [, cost]) => total + cost, 0);
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const summary = [['Total estimado', sum], ['Por pessoa', sum / names.length], ['Por pessoa, com margem', 130]];
  $('budget').innerHTML = `<div class="budget-summary">
    ${summary.map(([title, cost]) => `<div class="budget-tile"><span>${title}</span><strong>${currency.format(cost)}</strong></div>`).join('')}
    </div><div class="card budget-table"><table>
      <caption class="sr-only">Detalhamento dos itens do churrasco e chopp</caption>
      <thead><tr><th scope="col">Item</th><th scope="col" class="num">Valor estimado</th></tr></thead>
      <tbody>${items.map(([name, cost]) => `<tr><th scope="row">${name}</th><td class="num">${currency.format(cost)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num">${currency.format(sum)}</td></tr></tfoot>
    </table></div>`;
}

function render() {
  const matches = fixtures();
  const completedGames = matches.filter(match => hasScore(data.scores[match.key])).length;
  const filled = data.players.filter(player => player.nick.trim()).length;
  const metrics = [[12, 'Participantes'], [`${filled}/12`, 'Nicks cadastrados'],
    [data.groups ? 3 : 0, 'Grupos sorteados'], [`${completedGames}/18`, 'Jogos concluídos']];
  $('stats').innerHTML = metrics.map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
  const qualified = qualifiers(matches);
  renderPlayers();
  renderGroups(qualified);
  renderScores(matches);
  renderBracket(knockout(qualified), completedGames);
}

function saveRegistration(event) {
  event.preventDefault();
  const players = data.players.map(player => ({
    ...player,
    name: $('name' + player.id).value.trim() || names[player.id],
    nick: $('nick' + player.id).value.trim(),
  }));
  if (persist({ ...data, players })) notify('Inscrições salvas neste navegador.');
}

function drawGroups() {
  if (!confirm('Sortear os grupos? Isso apagará os resultados existentes.')) return;
  const ids = data.players.map(player => player.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const groups = [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12)];
  if (persist({ ...data, groups, scores: {}, ko: {} })) {
    showView('grupos');
    notify('Grupos sorteados.');
  }
}

function readScore(prefix, key) {
  const home = $(prefix + 'a' + key);
  const away = $(prefix + 'b' + key);
  if ((home.value === '') !== (away.value === '')) {
    (home.value === '' ? home : away).focus();
    notify('Preencha os dois placares ou deixe ambos vazios.', true);
    return null;
  }
  return { a: home.value, b: away.value };
}

function saveScores(event) {
  event.preventDefault();
  const scores = {};
  let changed = false;
  for (const match of fixtures()) {
    const score = readScore('', match.key);
    if (!score) return;
    scores[match.key] = score;
    const previous = data.scores[match.key];
    changed ||= score.a !== String(previous?.a ?? '') || score.b !== String(previous?.b ?? '');
  }
  if (changed && Object.values(data.ko).some(hasScore) &&
    !confirm('Alterar os resultados da fase de grupos apagará os placares do mata-mata. Continuar?')) return;
  if (persist({ ...data, scores, ko: changed ? {} : data.ko })) {
    notify('Resultados salvos. A classificação foi atualizada.');
  }
}

function saveKnockout(event) {
  event.preventDefault();
  const ko = {};
  for (const match of knockout(qualifiers(fixtures()))) {
    const score = readScore('k', match.key);
    if (!score) return;
    const select = $('kw' + match.key);
    const win = select.value;
    if (hasScore(score) && Number(score.a) === Number(score.b) && !win) {
      select.focus();
      notify('Selecione quem avançou no jogo empatado.', true);
      return;
    }
    ko[match.key] = { ...score, win };
  }
  if (persist({ ...data, ko })) notify('Placares do mata-mata salvos.');
}

function exportData() {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.href = url;
  link.download = 'babigol-slz-campeonato.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  let imported;
  try {
    imported = JSON.parse(await file.text());
    if (!validBackup(imported)) throw new Error();
  } catch {
    notify('Arquivo inválido. Selecione um backup JSON do campeonato.', true);
    return;
  }
  if (persist(imported)) notify('Backup importado.');
}

function validBackup(backup) {
  if (!Array.isArray(backup?.players) || backup.players.length !== names.length) return false;
  const ids = new Set(backup.players.map(player => player?.id));
  if (ids.size !== names.length || !backup.players.every(player =>
    Number.isInteger(player?.id) && player.id >= 0 && player.id < names.length &&
    typeof player.name === 'string' && typeof player.nick === 'string'
  )) return false;

  const { groups, scores, ko } = backup;
  const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
  const isGoalValue = value => value == null ||
    ((typeof value === 'string' || typeof value === 'number') && Number.isFinite(Number(value)));
  if (![scores, ko].every(map => isRecord(map) && Object.values(map).every(score =>
    isRecord(score) && isGoalValue(score.a) && isGoalValue(score.b)
  ))) return false;

  if (groups === null) return true;
  if (!Array.isArray(groups) || groups.length !== groupNames.length ||
    !groups.every(group => Array.isArray(group) && group.length === 4)) return false;
  const groupIds = groups.flat();
  return new Set(groupIds).size === ids.size && groupIds.every(id => ids.has(id));
}

function resetAll() {
  if (!confirm('Apagar os nicks, grupos e placares deste navegador?')) return;
  if (persist(defaults())) {
    showView('inicio');
    notify('Campeonato reiniciado neste navegador.');
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button[data-view]');
  if (button) showView(button.dataset.view);
});
$('registration-form').addEventListener('submit', saveRegistration);
$('draw-groups').addEventListener('click', drawGroups);
$('scores-form').addEventListener('submit', saveScores);
$('knockout-form').addEventListener('submit', saveKnockout);
$('export-data').addEventListener('click', exportData);
$('import-data').addEventListener('click', () => $('import').click());
$('import').addEventListener('change', importData);
$('reset-data').addEventListener('click', resetAll);
renderBudget();
render();
