const storageKey = 'babigol2026';
const soundKey = 'babigol-sound';
const names = [
  'Danillo Lopes', 'Távora', 'Danillo Araújo', 'Brian', 'Tainan', 'Wesley',
  'Charles', 'Gustavo', 'Wellington', 'Erick', 'Leandro', 'Saulo',
];
const groupNames = ['A', 'B', 'C'];
const groupPairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
const eventStart = new Date('2026-11-21T11:00:00-03:00');
const eventEnd = new Date('2026-11-21T16:00:00-03:00');
const views = ['inicio', 'inscricoes', 'sorteio', 'grupos', 'resultados', 'chaveamento', 'custos'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = id => document.getElementById(id);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function defaults() {
  return {
    players: names.map((name, id) => ({ id, name, nick: '' })),
    groups: null,
    scores: {},
    ko: {},
    draw: null,
  };
}

let data;
try {
  const stored = JSON.parse(localStorage.getItem(storageKey));
  data = validBackup(stored) ? stored : defaults();
} catch {
  data = defaults();
}

/* ---------- Feedback, persistence and dialogs ---------- */

let feedbackTimer;
function notify(message, error = false) {
  const feedback = $('feedback');
  clearTimeout(feedbackTimer);
  feedback.dataset.error = String(error);
  feedback.textContent = message;
  feedback.classList.toggle('show', Boolean(message));
  if (message) feedbackTimer = setTimeout(() => feedback.classList.remove('show'), 5200);
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

function ask({ title, text, ok = 'Confirmar', danger = false }) {
  const dialog = $('confirm-dialog');
  if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  $('cd-title').textContent = title;
  $('cd-text').textContent = text;
  $('cd-ok').textContent = ok;
  $('cd-ok').classList.toggle('danger', danger);
  $('cd-ok').classList.toggle('primary', !danger);
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

/* ---------- Navigation ---------- */

function showView(id, { push = true, focus = true } = {}) {
  if (!views.includes(id)) id = 'inicio';
  document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== id; });
  $('nav').querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  setMenu(false);
  if (push && location.hash !== '#' + id) history.pushState(null, '', '#' + id);
  if (focus) $(id + '-titulo').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function setMenu(open) {
  $('menu-toggle').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
}

/* ---------- Tournament logic ---------- */

function player(id) {
  return data.players.find(entry => entry.id === id);
}

function playerLabel(id) {
  const entry = player(id);
  return entry ? entry.nick.trim() || entry.name : 'A definir';
}

function initials(id) {
  const label = playerLabel(id).replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = label.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : parts[0].slice(0, 2)).toUpperCase();
}

function avatar(id, extra = '') {
  return `<span class="avatar tone-${id % 4} ${extra}" aria-hidden="true">${escapeHtml(initials(id))}</span>`;
}

function fixtures() {
  if (!data.groups) return [];
  return data.groups.flatMap((group, g) => groupPairs.map(([a, b], index) => ({
    key: `${g}-${index}`, a: group[a], b: group[b], g, round: Math.floor(index / 2) + 1, index,
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

function winner(match, scores) {
  const score = scores[match.key];
  if (match.a == null || match.b == null || !hasScore(score)) return null;
  const a = Number(score.a);
  const b = Number(score.b);
  if (a > b || (a === b && score.win === String(match.a))) return match.a;
  if (b > a || (a === b && score.win === String(match.b))) return match.b;
  return null;
}

function knockout(qualified, scores) {
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
    { key: 's0', a: winner(quarters[0], scores), b: winner(quarters[1], scores) },
    { key: 's1', a: winner(quarters[2], scores), b: winner(quarters[3], scores) },
  ];
  return [...quarters, ...semis, { key: 'final', a: winner(semis[0], scores), b: winner(semis[1], scores) }];
}

/* ---------- Rendering ---------- */

function emptyState(title, text, target, button, iconName = 'shuffle') {
  return `<div class="card empty-state">
    <span class="empty-icon">${icon(iconName)}</span>
    <h2>${title}</h2><p>${text}</p>
    <a class="button primary small" href="#${target}" data-view="${target}">${button}</a>
  </div>`;
}

function renderStats(completedGames, koDone) {
  const filled = data.players.filter(entry => entry.nick.trim()).length;
  const metrics = [
    ['users', 12, '', 'Jogadores'],
    ['pad', filled, '/12', 'Nicks cadastrados'],
    ['ball', completedGames, '/18', 'Jogos da fase de grupos'],
    ['bracket', koDone, '/7', 'Jogos do mata-mata'],
  ];
  $('stats').innerHTML = metrics.map(([iconName, value, suffix, label]) => `
    <div class="metric">
      <span class="metric-icon">${icon(iconName)}</span>
      <strong><span class="count" data-to="${value}">${value}</span><small>${suffix}</small></strong>
      <span>${label}</span>
    </div>`).join('');
  animateCounts($('stats'));
}

function animateCounts(root) {
  if (reducedMotion.matches) return;
  root.querySelectorAll('.count').forEach(element => {
    const target = Number(element.dataset.to);
    if (!target) return;
    const start = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - start) / 900);
      element.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function renderJourney(completedGames, koDone, champion) {
  const filled = data.players.filter(entry => entry.nick.trim()).length;
  const steps = [
    ['users', 'Inscrições', `${filled}/12 nicks`, filled === 12, 'inscricoes'],
    ['shuffle', 'Sorteio', data.groups ? 'Grupos definidos' : '3 grupos de 4', Boolean(data.groups), 'sorteio'],
    ['table', 'Fase de grupos', `${completedGames}/18 jogos`, completedGames === 18, 'grupos'],
    ['bracket', 'Mata-mata', `${Math.min(koDone, 6)}/6 jogos`, koDone >= 6, 'chaveamento'],
    ['trophy', 'Grande final', champion == null ? '21 de novembro' : escapeHtml(playerLabel(champion)), champion != null, 'chaveamento'],
  ];
  const current = steps.findIndex(step => !step[3]);
  $('journey').innerHTML = steps.map(([iconName, title, text, done, target], index) => `
    <li class="step ${done ? 'done' : index === current ? 'current' : ''}">
      <a href="#${target}" data-view="${target}">
        <span class="step-icon">${icon(done ? 'check' : iconName)}</span>
        <span class="step-n">Etapa ${index + 1}</span>
        <strong>${title}</strong>
        <small>${text}</small>
      </a>
    </li>`).join('');
}

function renderPlayers() {
  $('players').innerHTML = data.players.map(entry => `
    <article class="player-card">
      <div class="player-top">
        ${avatar(entry.id)}
        <div class="player-id">
          <h2 id="pl-${entry.id}">${escapeHtml(playerLabel(entry.id))}</h2>
          <small>Jogador ${String(entry.id + 1).padStart(2, '0')}</small>
        </div>
        <span class="jersey" aria-hidden="true">${String(entry.id + 1).padStart(2, '0')}</span>
      </div>
      <label for="name${entry.id}">Nome</label>
      <input id="name${entry.id}" data-player="${entry.id}" type="text" value="${escapeHtml(entry.name)}" autocomplete="off">
      <label for="nick${entry.id}">Nick / gamertag</label>
      <div class="input-icon">${icon('pad')}<input id="nick${entry.id}" data-player="${entry.id}" type="text" value="${escapeHtml(entry.nick)}" placeholder="Digite o nick" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    </article>`).join('');
}

function renderGroups(qualified) {
  const confirmed = new Set(qualified ? [
    ...qualified.groups.flatMap(rows => rows.slice(0, 2).map(row => row.id)),
    ...qualified.thirds.slice(0, 2).map(row => row.id),
  ] : []);
  $('standings-legend').hidden = !data.groups;
  $('standings-legend').innerHTML = `<span><i class="zone direct"></i>1º e 2º: classificação direta</span>
    <span><i class="zone third"></i>3º: briga pelas 2 vagas de melhor terceiro</span>
    <span>J jogos · V vitórias · E empates · D derrotas · SG saldo · Pts pontos</span>`;
  if (!data.groups) {
    $('groupcards').innerHTML = emptyState('Aguardando sorteio', 'As tabelas serão exibidas assim que os grupos forem definidos.', 'sorteio', 'Ir para o sorteio');
    $('thirds').innerHTML = '';
    return;
  }
  const code = data.draw?.code ? `<p class="draw-code-note">${icon('shuffle')} Código do sorteio <strong>${escapeHtml(data.draw.code)}</strong></p>` : '';
  $('groupcards').innerHTML = code + groupNames.map((group, index) => `
    <article class="group-card">
      <header class="group-head"><span class="group-letter" aria-hidden="true">${group}</span><h2>Grupo ${group}</h2><span class="group-games">${fixtures().filter(match => match.g === index && hasScore(data.scores[match.key])).length}/6 jogos</span></header>
      <table>
        <caption class="sr-only">Classificação do grupo ${group}</caption>
        <thead><tr><th scope="col"><span class="sr-only">Posição</span></th><th scope="col">Jogador</th>
          <th scope="col" class="num"><abbr title="Jogos">J</abbr></th>
          <th scope="col" class="num opt"><abbr title="Vitórias">V</abbr></th>
          <th scope="col" class="num opt"><abbr title="Empates">E</abbr></th>
          <th scope="col" class="num opt"><abbr title="Derrotas">D</abbr></th>
          <th scope="col" class="num"><abbr title="Saldo de gols">SG</abbr></th>
          <th scope="col" class="num"><abbr title="Pontos">Pts</abbr></th></tr></thead>
        <tbody>${standings(index).map((row, position) => `
          <tr class="pos-${position + 1}${confirmed.has(row.id) ? ' qualified' : ''}">
            <td class="position"><span>${position + 1}</span></td>
            <th scope="row"><span class="cell-player">${avatar(row.id, 'sm')}<span>${escapeHtml(playerLabel(row.id))}${confirmed.has(row.id) ? ` <span class="q-badge">${icon('check')}<span class="sr-only">classificado</span></span>` : ''}</span></span></th>
            <td class="num">${row.j}</td><td class="num opt">${row.v}</td><td class="num opt">${row.e}</td><td class="num opt">${row.d}</td>
            <td class="num">${row.sg > 0 ? '+' : ''}${row.sg}</td><td class="num points">${row.p}</td>
          </tr>`).join('')}</tbody>
      </table>
    </article>`).join('');

  const thirds = groupNames.map((_, g) => ({ ...standings(g)[2], g })).sort(rank);
  $('thirds').innerHTML = `<article class="card thirds-card">
    <header><p class="eyebrow">${qualified ? 'Definido' : 'Parcial'}</p><h2>Corrida dos terceiros colocados</h2><p>Os dois melhores terceiros completam as quartas de final.</p></header>
    <ol class="thirds-list">${thirds.map((row, index) => `
      <li class="${index < 2 ? 'in' : 'out'}">
        <span class="t-pos">${index + 1}º</span>${avatar(row.id, 'sm')}
        <span class="t-name">${escapeHtml(playerLabel(row.id))}<small>3º do grupo ${groupNames[row.g]}</small></span>
        <span class="t-stat"><strong>${row.p}</strong> pts</span><span class="t-stat">${row.sg > 0 ? '+' : ''}${row.sg} SG</span>
        <span class="t-tag">${index < 2 ? 'Classifica' : 'Fora'}</span>
      </li>`).join('')}</ol>
  </article>`;
}

function renderScores(matches) {
  $('score-actions').hidden = matches.length === 0;
  if (!matches.length) {
    $('games').innerHTML = emptyState('Nenhum jogo disponível', 'Faça o sorteio para liberar os 18 jogos da fase de grupos.', 'sorteio', 'Ir para o sorteio');
    return;
  }
  $('games').innerHTML = groupNames.map((group, g) => {
    const groupMatches = matches.filter(match => match.g === g);
    const done = groupMatches.filter(match => hasScore(data.scores[match.key])).length;
    return `<article class="score-group">
      <header class="group-head"><span class="group-letter" aria-hidden="true">${group}</span><h2>Grupo ${group}</h2><span class="group-games">${done}/6 jogos</span></header>
      ${[1, 2, 3].map(round => `<p class="round-tag">Rodada ${round}</p>
        ${groupMatches.filter(match => match.round === round).map(match => {
          const score = data.scores[match.key] || {};
          const label = `Jogo ${group}${match.index + 1}`;
          return `<div class="match ${hasScore(score) ? 'played' : ''}" role="group" aria-label="${label}">
            <label class="team home" for="a${match.key}">${avatar(match.a, 'sm')}<span class="team-name"><span class="sr-only">Gols de </span>${escapeHtml(playerLabel(match.a))}</span></label>
            <input id="a${match.key}" type="number" min="0" max="99" inputmode="numeric" value="${escapeHtml(score.a)}" placeholder="–">
            <span class="vs" aria-hidden="true">×</span>
            <input id="b${match.key}" type="number" min="0" max="99" inputmode="numeric" value="${escapeHtml(score.b)}" placeholder="–">
            <label class="team away" for="b${match.key}"><span class="team-name"><span class="sr-only">Gols de </span>${escapeHtml(playerLabel(match.b))}</span>${avatar(match.b, 'sm')}</label>
          </div>`;
        }).join('')}`).join('')}
    </article>`;
  }).join('');
}

const matchInfo = {
  q0: { short: 'QF1', title: 'Quartas de final · Jogo 1', seeds: ['1º do Grupo A', 'Melhor 3º'] },
  q1: { short: 'QF2', title: 'Quartas de final · Jogo 2', seeds: ['1º do Grupo B', '2º melhor 3º'] },
  q2: { short: 'QF3', title: 'Quartas de final · Jogo 3', seeds: ['1º do Grupo C', '2º do Grupo A'] },
  q3: { short: 'QF4', title: 'Quartas de final · Jogo 4', seeds: ['2º do Grupo B', '2º do Grupo C'] },
  s0: { short: 'SF1', title: 'Semifinal 1', seeds: ['Vencedor QF1', 'Vencedor QF2'] },
  s1: { short: 'SF2', title: 'Semifinal 2', seeds: ['Vencedor QF3', 'Vencedor QF4'] },
  final: { short: 'Final', title: 'Grande final', seeds: ['Vencedor SF1', 'Vencedor SF2'] },
};

function bracketMatch(key, match) {
  const info = matchInfo[key];
  const score = (match && data.ko[key]) || {};
  const ready = match && match.a != null && match.b != null;
  const decided = match ? winner(match, data.ko) : null;
  const played = ready && hasScore(score);
  const tie = played && Number(score.a) === Number(score.b);
  const team = (id, seed, goals) => {
    const known = id != null;
    const state = decided == null ? '' : decided === id ? 'win' : 'lose';
    return `<span class="bm-team ${state} ${known ? '' : 'tbd'}">
      ${known ? avatar(id, 'sm') : '<span class="avatar sm empty" aria-hidden="true"></span>'}
      <span class="bm-name">${escapeHtml(known ? playerLabel(id) : seed)}${tie && state === 'win' ? '<abbr class="pen" title="Venceu no desempate">P</abbr>' : ''}</span>
      <span class="bm-score">${played ? escapeHtml(goals) : ''}</span>
    </span>`;
  };
  const status = !match ? 'Aguardando' : !ready ? 'A definir' : played ? 'Encerrado' : 'Lançar placar';
  const labelA = match?.a != null ? playerLabel(match.a) : info.seeds[0];
  const labelB = match?.b != null ? playerLabel(match.b) : info.seeds[1];
  const aria = `${info.title}: ${labelA}${played ? ` ${score.a} × ${score.b} ` : ' contra '}${labelB}. ${status}`;
  return `<button type="button" class="bm ${key === 'final' ? 'bm-final' : ''} ${played ? 'played' : ''}" data-match="${key}" ${ready ? '' : 'disabled'} aria-label="${escapeHtml(aria)}">
    <span class="bm-head"><span>${info.short}</span><span class="bm-status">${ready && !played ? icon('edit') : ''}${status}</span></span>
    ${team(match?.a ?? null, info.seeds[0], score.a)}
    ${team(match?.b ?? null, info.seeds[1], score.b)}
  </button>`;
}

function renderBracket(matches, completedGames) {
  const byKey = Object.fromEntries(matches.map(match => [match.key, match]));
  const champion = matches.length ? winner(byKey.final, data.ko) : null;
  const slot = key => {
    const match = byKey[key];
    const done = match && winner(match, data.ko) != null;
    const fed = match && match.a != null && match.b != null;
    return `<div class="b-slot ${done ? 'done' : ''} ${fed ? 'fed' : ''}">${bracketMatch(key, match)}</div>`;
  };
  const note = matches.length ? '' : `<div class="bracket-note">${icon('clock')}<p><strong>Mata-mata bloqueado</strong> O chaveamento é liberado após os 18 jogos da fase de grupos. <span class="progress-text">${completedGames}/18 concluídos</span></p>
    <span class="progress" aria-hidden="true"><span style="width:${(completedGames / 18) * 100}%"></span></span></div>`;
  const championBlock = champion == null
    ? `<div class="champion pending"><span>Campeão</span><strong>A definir</strong></div>`
    : `<div class="champion crowned">${icon('crown')}<span>Campeão 2026</span><strong>${escapeHtml(playerLabel(champion))}</strong></div>`;
  $('bracket').innerHTML = `${note}
    <div class="bracket" role="group" aria-label="Chaveamento do mata-mata">
      <div class="b-labels" aria-hidden="true"><span>Quartas</span><span>Semifinal</span><span class="lbl-final">Final</span><span>Semifinal</span><span>Quartas</span></div>
      <div class="b-grid">
        <div class="b-col q left"><p class="col-label">Quartas · Lado esquerdo</p>${slot('q0')}${slot('q1')}</div>
        <div class="b-col s left"><p class="col-label">Semifinal 1</p>${slot('s0')}</div>
        <div class="b-col center ${champion == null ? '' : 'has-champion'}">
          <div class="center-top">
            <div class="mini-trophy"><div class="rays" aria-hidden="true"></div><img src="assets/trofeu-sm.webp" width="360" height="559" alt="Troféu do campeão" loading="lazy"></div>
          </div>
          <div class="center-mid"><p class="col-label final-label">Grande final</p><div class="b-slot final-slot">${bracketMatch('final', byKey.final)}</div></div>
          <div class="center-bottom">${championBlock}</div>
        </div>
        <div class="b-col s right"><p class="col-label">Semifinal 2</p>${slot('s1')}</div>
        <div class="b-col q right"><p class="col-label">Quartas · Lado direito</p>${slot('q2')}${slot('q3')}</div>
      </div>
    </div>`;
}

/* ---------- Draw (sorteio) ---------- */

const padButtons = ['up', 'down', 'left', 'right', 'triangle', 'circle', 'cross', 'square'];
const padLabels = {
  up: 'Cima', down: 'Baixo', left: 'Esquerda', right: 'Direita',
  triangle: 'Triângulo', circle: 'Círculo', cross: 'Xis', square: 'Quadrado',
};
const padGlyphs = {
  up: '<path d="M12 5l7 10H5z"/>',
  down: '<path d="M12 19l7-10H5z"/>',
  left: '<path d="M5 12l10-7v14z"/>',
  right: '<path d="M19 12 9 5v14z"/>',
  triangle: '<path class="o" d="M12 4.5l8 14H4z"/>',
  circle: '<circle class="o" cx="12" cy="12" r="7.5"/>',
  cross: '<path class="o" d="M5.5 5.5l13 13m0-13-13 13"/>',
  square: '<rect class="o" x="5" y="5" width="14" height="14"/>',
};
const glyph = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${padGlyphs[name]}</svg>`;

let drawing = false;
let skipDraw = false;
let soundOn = true;
try { soundOn = localStorage.getItem(soundKey) !== 'off'; } catch { /* storage blocked */ }
let audioContext;

function tone(frequency, duration = 0.08, type = 'square', volume = 0.035) {
  if (!soundOn || skipDraw) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch { /* audio unavailable */ }
}

function pause(ms) {
  return skipDraw ? Promise.resolve() : wait(ms);
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sequenceFromSeed(seed) {
  const sequence = [];
  let rest = seed;
  for (let i = 0; i < 8; i++) {
    sequence.unshift(rest % 8);
    rest = Math.floor(rest / 8);
  }
  return sequence;
}

function newDrawCode() {
  const sequence = [...crypto.getRandomValues(new Uint8Array(8))].map(value => value % 8);
  const seed = sequence.reduce((total, value) => total * 8 + value, 0);
  return { sequence, seed, code: 'BG26-' + seed.toString(16).toUpperCase().padStart(6, '0') };
}

function drawGroupsFromSeed(seed) {
  const random = mulberry32(seed);
  const ids = data.players.map(entry => entry.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12)];
}

function secondaryName(id) {
  const name = player(id)?.name || '';
  return name === playerLabel(id) ? `Jogador ${String(id + 1).padStart(2, '0')}` : name;
}

function slotContent(id) {
  return `${avatar(id)}<span class="slot-text"><strong>${escapeHtml(playerLabel(id))}</strong><small>${escapeHtml(secondaryName(id))}</small></span>`;
}

function renderDrawBoard() {
  if (drawing) return;
  $('draw-board').innerHTML = groupNames.map((group, g) => `
    <div class="draw-group" data-group="${g}">
      <header><span>Grupo</span><strong>${group}</strong></header>
      <ol>${[0, 1, 2, 3].map(s => {
        const id = data.groups?.[g][s];
        return `<li class="draw-slot ${id == null ? '' : 'filled static'}" data-slot="${g}-${s}">
          <span class="slot-n">${group}${s + 1}</span>
          <span class="slot-body">${id == null ? '<span class="slot-empty">Vaga aberta</span>' : slotContent(id)}</span>
        </li>`;
      }).join('')}</ol>
    </div>`).join('');
  const sequence = data.draw?.seed != null ? sequenceFromSeed(data.draw.seed) : null;
  renderCodeSlots(sequence);
  $('code-text').textContent = data.draw?.code || (data.groups ? 'BG26-······' : 'BG26-······');
  $('draw-status').textContent = data.groups ? 'Sorteio realizado' : 'Aguardando';
  $('draw-stage').dataset.state = data.groups ? 'done' : 'idle';
  $('draw-groups').querySelector('span').textContent = data.groups ? 'Refazer sorteio' : 'Iniciar sorteio';
  $('draw-after').hidden = !data.groups;
  if (data.groups) {
    $('reel-label').textContent = 'Sorteio concluído';
    $('reel-name').textContent = data.draw?.code || 'Grupos definidos';
    $('reel-sub').textContent = 'Os grupos A, B e C estão definidos';
  }
}

function renderCodeSlots(sequence) {
  $('code-slots').innerHTML = Array.from({ length: 8 }, (_, i) => {
    const name = sequence ? padButtons[sequence[i]] : null;
    return `<li class="code-slot ${name ? 'on' : ''}">${name ? glyph(name) + `<span class="sr-only">${padLabels[name]}</span>` : ''}</li>`;
  }).join('');
}

async function pressButton(name) {
  const element = $('pad').querySelector(`[data-btn="${name}"]`);
  element?.classList.add('pressed');
  $('pad').classList.add('active');
  tone(320 + padButtons.indexOf(name) * 70, 0.09);
  await pause(190);
  element?.classList.remove('pressed');
  $('pad').classList.remove('active');
}

function setReel(label, name, sub = '') {
  $('reel-label').textContent = label;
  $('reel-name').textContent = name;
  $('reel-sub').textContent = sub;
}

async function spinReel(pool, finalId, label, index) {
  const reel = $('reel');
  reel.classList.remove('landed');
  reel.classList.add('spinning');
  const duration = index < 3 ? 1500 : index < 9 ? 1000 : 750;
  let elapsed = 0;
  let delay = 45;
  let last = null;
  while (elapsed < duration && !skipDraw && pool.length > 1) {
    let candidate;
    do { candidate = pool[Math.floor(Math.random() * pool.length)]; } while (candidate === last);
    last = candidate;
    setReel(label, playerLabel(candidate), secondaryName(candidate));
    tone(900, 0.025, 'triangle', 0.018);
    await pause(delay);
    elapsed += delay;
    delay = Math.min(delay * 1.13, 190);
  }
  reel.classList.remove('spinning');
  setReel(label, playerLabel(finalId), secondaryName(finalId));
  reel.classList.add('landed');
  tone(660, 0.12, 'sine', 0.05);
  setTimeout(() => tone(990, 0.18, 'sine', 0.05), 90);
}

function placeInSlot(g, s, id) {
  const slot = $('draw-board').querySelector(`[data-slot="${g}-${s}"]`);
  if (!slot) return;
  slot.querySelector('.slot-body').innerHTML = slotContent(id);
  slot.classList.add('filled');
  $('draw-board').querySelectorAll('.draw-group').forEach(group => group.classList.toggle('active', group.dataset.group === String(g)));
}

async function playDraw(draw, groups) {
  const stage = $('draw-stage');
  skipDraw = reducedMotion.matches;
  stage.dataset.state = 'running';
  stage.classList.remove('accepted');
  $('draw-groups').disabled = true;
  $('draw-groups').querySelector('span').textContent = 'Sorteando…';
  $('draw-skip').hidden = false;
  $('draw-after').hidden = true;
  $('draw-board').querySelectorAll('.draw-slot').forEach(slot => {
    slot.classList.remove('filled', 'static');
    slot.querySelector('.slot-body').innerHTML = '<span class="slot-empty">Vaga aberta</span>';
  });
  renderCodeSlots(null);
  $('code-text').textContent = 'BG26-······';
  $('draw-status').textContent = 'Conectando';
  setReel('Controle conectado', 'Press start', 'Preparando o código do sorteio');
  stage.scrollIntoView({ behavior: skipDraw ? 'auto' : 'smooth', block: 'start' });
  await pause(900);

  $('draw-status').textContent = 'Digitando';
  setReel('Digitando o código', '· · · · · · · ·', 'Cada botão define a ordem do sorteio');
  const slots = $('code-slots').children;
  for (const [i, value] of draw.sequence.entries()) {
    const name = padButtons[value];
    await pressButton(name);
    slots[i].innerHTML = glyph(name) + `<span class="sr-only">${padLabels[name]}</span>`;
    slots[i].classList.add('on');
    setReel('Digitando o código', draw.sequence.slice(0, i + 1).map(n => padLabels[padButtons[n]]).slice(-3).join(' · '), `Botão ${i + 1} de 8`);
    await pause(170);
  }
  for (let i = 5; i <= draw.code.length; i++) {
    $('code-text').textContent = draw.code.slice(0, i) + '·'.repeat(Math.max(0, draw.code.length - i));
    tone(1200, 0.02, 'square', 0.02);
    await pause(55);
  }
  stage.classList.add('accepted');
  $('draw-status').textContent = 'Código aceito';
  setReel('Código aceito', draw.code, 'Revelando os jogadores');
  tone(523, 0.12, 'sine', 0.05);
  setTimeout(() => tone(784, 0.2, 'sine', 0.05), 110);
  await pause(1100);

  $('draw-status').textContent = 'Sorteando';
  const pool = data.players.map(entry => entry.id);
  let index = 0;
  for (let s = 0; s < 4; s++) {
    for (let g = 0; g < 3; g++) {
      const id = groups[g][s];
      await spinReel(pool, id, `Grupo ${groupNames[g]} · Vaga ${s + 1}`, index);
      pool.splice(pool.indexOf(id), 1);
      placeInSlot(g, s, id);
      index++;
      await pause(420);
    }
  }

  $('draw-board').querySelectorAll('.draw-group').forEach(group => group.classList.remove('active'));
  stage.dataset.state = 'done';
  $('draw-status').textContent = 'Sorteio realizado';
  setReel('Sorteio concluído', draw.code, 'Grupos A, B e C definidos. Boa sorte a todos!');
  $('draw-skip').hidden = true;
  $('draw-groups').disabled = false;
  $('draw-groups').querySelector('span').textContent = 'Refazer sorteio';
  $('draw-after').hidden = false;
  if (!skipDraw) confetti();
  skipDraw = false;
}

async function startDraw() {
  if (drawing) return;
  if (data.groups) {
    const hasResults = Object.values(data.scores).some(hasScore) || Object.values(data.ko).some(hasScore);
    const ok = await ask({
      title: 'Refazer o sorteio?',
      text: hasResults
        ? 'Os grupos atuais serão substituídos e todos os placares da fase de grupos e do mata-mata serão apagados.'
        : 'Os grupos atuais serão substituídos por um novo sorteio.',
      ok: 'Sortear novamente',
      danger: hasResults,
    });
    if (!ok) return;
  }
  const draw = newDrawCode();
  const groups = drawGroupsFromSeed(draw.seed);
  drawing = true;
  if (!persist({ ...data, groups, scores: {}, ko: {}, draw: { code: draw.code, seed: draw.seed } })) {
    drawing = false;
    return;
  }
  try {
    await playDraw(draw, groups);
  } finally {
    drawing = false;
    $('draw-groups').disabled = false;
    $('draw-skip').hidden = true;
  }
  notify(`Sorteio ${draw.code} concluído. Grupos salvos.`);
}

function setSound(on) {
  soundOn = on;
  try { localStorage.setItem(soundKey, on ? 'on' : 'off'); } catch { /* storage blocked */ }
  const button = $('sound-toggle');
  button.setAttribute('aria-pressed', String(on));
  button.querySelector('use').setAttribute('href', on ? '#i-sound' : '#i-mute');
}

/* ---------- Confetti ---------- */

function confetti() {
  if (reducedMotion.matches) return;
  const host = $('confetti');
  const colors = ['#d9a630', '#f5d77e', '#0a1a3f', '#2457c5', '#ffffff'];
  const pieces = Array.from({ length: 110 }, () => {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${Math.random() * 100}vw`);
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 40}vw`);
    piece.style.setProperty('--r', `${Math.random() * 1080 - 540}deg`);
    piece.style.setProperty('--d', `${2.2 + Math.random() * 1.8}s`);
    piece.style.setProperty('--delay', `${Math.random() * 0.5}s`);
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    if (Math.random() > 0.6) piece.style.borderRadius = '50%';
    return piece;
  });
  host.append(...pieces);
  setTimeout(() => pieces.forEach(piece => piece.remove()), 4800);
}

/* ---------- Countdown ---------- */

function updateCountdown() {
  const element = $('countdown');
  const now = Date.now();
  if (now >= eventEnd.getTime()) {
    element.innerHTML = '<p class="countdown-msg">Campeonato encerrado. Obrigado a todos!</p>';
    return false;
  }
  if (now >= eventStart.getTime()) {
    element.innerHTML = '<p class="countdown-msg"><span class="live-dot"></span> Ao vivo: bola rolando!</p>';
    return true;
  }
  let rest = Math.floor((eventStart.getTime() - now) / 1000);
  const values = { d: Math.floor(rest / 86400) };
  rest %= 86400;
  values.h = Math.floor(rest / 3600);
  values.m = Math.floor((rest % 3600) / 60);
  values.s = rest % 60;
  for (const [unit, value] of Object.entries(values)) {
    const cell = element.querySelector(`[data-unit="${unit}"]`);
    const text = String(value).padStart(2, '0');
    if (cell && cell.textContent !== text) {
      cell.textContent = text;
      cell.classList.remove('tick');
      void cell.offsetWidth;
      cell.classList.add('tick');
    }
  }
  return true;
}

/* ---------- Budget ---------- */

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
  const summary = [['Total estimado', sum, 'beer'], ['Por pessoa', sum / names.length, 'users'], ['Por pessoa, com margem', 130, 'check']];
  $('budget').innerHTML = `<div class="budget-summary">
    ${summary.map(([title, cost, iconName], i) => `<div class="budget-tile ${i === 2 ? 'highlight' : ''}">${icon(iconName)}<span>${title}</span><strong>${currency.format(cost)}</strong></div>`).join('')}
    </div><div class="card budget-table"><table>
      <caption class="sr-only">Detalhamento dos itens do churrasco e chopp</caption>
      <thead><tr><th scope="col">Item</th><th scope="col" class="num">Valor estimado</th><th scope="col" class="bar-col"><span class="sr-only">Proporção</span></th></tr></thead>
      <tbody>${items.map(([name, cost]) => `<tr><th scope="row">${name}</th><td class="num">${currency.format(cost)}</td><td class="bar-col"><span class="bar" style="width:${(cost / 800) * 100}%"></span></td></tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num">${currency.format(sum)}</td><td class="bar-col"></td></tr></tfoot>
    </table></div>`;
}

/* ---------- Main render ---------- */

function render() {
  const matches = fixtures();
  const completedGames = matches.filter(match => hasScore(data.scores[match.key])).length;
  const qualified = qualifiers(matches);
  const koMatches = knockout(qualified, data.ko);
  const koDone = koMatches.filter(match => winner(match, data.ko) != null).length;
  const champion = koMatches.length ? winner(koMatches.at(-1), data.ko) : null;
  renderStats(completedGames, koDone);
  renderJourney(completedGames, koDone, champion);
  renderPlayers();
  renderGroups(qualified);
  renderScores(matches);
  renderBracket(koMatches, completedGames);
  renderDrawBoard();
}

/* ---------- Actions ---------- */

function saveRegistration(event) {
  event.preventDefault();
  const players = data.players.map(entry => ({
    ...entry,
    name: $('name' + entry.id).value.trim() || names[entry.id],
    nick: $('nick' + entry.id).value.trim(),
  }));
  if (persist({ ...data, players })) notify('Inscrições salvas neste navegador.');
}

function readScore(home, away) {
  if ((home.value === '') !== (away.value === '')) {
    (home.value === '' ? home : away).focus();
    notify('Preencha os dois placares ou deixe ambos vazios.', true);
    return null;
  }
  return { a: home.value, b: away.value };
}

async function saveScores(event) {
  event.preventDefault();
  const scores = {};
  let changed = false;
  for (const match of fixtures()) {
    const score = readScore($('a' + match.key), $('b' + match.key));
    if (!score) return;
    scores[match.key] = score;
    const previous = data.scores[match.key];
    changed ||= score.a !== String(previous?.a ?? '') || score.b !== String(previous?.b ?? '');
  }
  if (changed && Object.values(data.ko).some(hasScore) && !(await ask({
    title: 'Alterar a fase de grupos?',
    text: 'Alterar os resultados da fase de grupos apagará os placares do mata-mata.',
    ok: 'Continuar',
    danger: true,
  }))) return;
  if (persist({ ...data, scores, ko: changed ? {} : data.ko })) {
    notify('Resultados salvos. A classificação foi atualizada.');
  }
}

let editingKey = null;

function currentKnockout() {
  return knockout(qualifiers(fixtures()), data.ko);
}

function openMatch(key) {
  const match = currentKnockout().find(entry => entry.key === key);
  if (!match || match.a == null || match.b == null) return;
  editingKey = key;
  const score = data.ko[key] || {};
  $('md-round').textContent = key === 'final' ? 'Decisão do título' : 'Mata-mata';
  $('md-title').textContent = matchInfo[key].title;
  $('md-name-a').textContent = playerLabel(match.a);
  $('md-name-b').textContent = playerLabel(match.b);
  $('md-avatar-a').innerHTML = avatar(match.a);
  $('md-avatar-b').innerHTML = avatar(match.b);
  $('md-a').value = score.a ?? '';
  $('md-b').value = score.b ?? '';
  $('md-win').innerHTML = `<option value="">Selecione</option>` + [match.a, match.b].map(id =>
    `<option value="${id}"${score.win === String(id) ? ' selected' : ''}>${escapeHtml(playerLabel(id))}</option>`).join('');
  $('md-error').textContent = '';
  updateTie();
  $('match-dialog').showModal();
  $('md-a').focus();
}

function updateTie() {
  const a = $('md-a').value;
  const b = $('md-b').value;
  $('md-tie').hidden = !(a !== '' && b !== '' && Number(a) === Number(b));
}

async function applyKnockout(key, entry) {
  const qualified = qualifiers(fixtures());
  const candidate = { ...data.ko };
  if (entry) candidate[key] = entry;
  else delete candidate[key];
  const before = knockout(qualified, data.ko);
  const championBefore = before.length ? winner(before.at(-1), data.ko) : null;
  const ko = {};
  const discarded = [];
  for (const [index, match] of before.entries()) {
    // Recalculate each matchup using only the earlier results accepted in this save.
    const next = knockout(qualified, ko)[index];
    const proposed = candidate[match.key];
    if (match.a !== next.a || match.b !== next.b) {
      if (proposed && [proposed.a, proposed.b, proposed.win].some(value => value != null && value !== '')) {
        discarded.push(matchInfo[match.key].title);
      }
      continue;
    }
    if (proposed) ko[match.key] = proposed;
  }
  if (discarded.length && !(await ask({
    title: 'Descartar partidas seguintes?',
    text: `Este resultado muda quem avança. Os placares de ${discarded.join(', ')} serão apagados.`,
    ok: 'Salvar e descartar',
    danger: true,
  }))) return false;
  if (!persist({ ...data, ko })) return false;
  const after = knockout(qualified, ko);
  const championAfter = after.length ? winner(after.at(-1), ko) : null;
  if (championAfter != null && championAfter !== championBefore) {
    confetti();
    notify(`${playerLabel(championAfter)} é o campeão do 1º Campeonato Babigol SLZ!`);
  } else {
    notify('Placar do mata-mata salvo.');
  }
  return true;
}

async function saveMatch(event) {
  event.preventDefault();
  const a = $('md-a');
  const b = $('md-b');
  if ((a.value === '') !== (b.value === '')) {
    $('md-error').textContent = 'Preencha os dois placares ou deixe ambos vazios.';
    (a.value === '' ? a : b).focus();
    return;
  }
  const score = { a: a.value, b: b.value, win: '' };
  if (hasScore(score) && Number(score.a) === Number(score.b)) {
    score.win = $('md-win').value;
    if (!score.win) {
      $('md-error').textContent = 'Empate: selecione quem avançou no desempate.';
      $('md-win').focus();
      return;
    }
  }
  $('match-dialog').close();
  await applyKnockout(editingKey, hasScore(score) ? score : null);
}

async function clearMatch() {
  $('match-dialog').close();
  if (data.ko[editingKey]) await applyKnockout(editingKey, null);
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
  const ids = new Set(backup.players.map(entry => entry?.id));
  if (ids.size !== names.length || !backup.players.every(entry =>
    Number.isInteger(entry?.id) && entry.id >= 0 && entry.id < names.length &&
    typeof entry.name === 'string' && typeof entry.nick === 'string'
  )) return false;

  const { groups, scores, ko, draw } = backup;
  const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
  const isGoalValue = value => value == null ||
    ((typeof value === 'string' || typeof value === 'number') && Number.isFinite(Number(value)));
  if (![scores, ko].every(map => isRecord(map) && Object.values(map).every(score =>
    isRecord(score) && isGoalValue(score.a) && isGoalValue(score.b)
  ))) return false;
  if (draw != null && !(isRecord(draw) && typeof draw.code === 'string' &&
    Number.isInteger(draw.seed) && draw.seed >= 0 && draw.seed < 8 ** 8)) return false;

  if (groups === null) return true;
  if (!Array.isArray(groups) || groups.length !== groupNames.length ||
    !groups.every(group => Array.isArray(group) && group.length === 4)) return false;
  const groupIds = groups.flat();
  return new Set(groupIds).size === ids.size && groupIds.every(id => ids.has(id));
}

async function resetAll() {
  const ok = await ask({
    title: 'Reiniciar o campeonato?',
    text: 'Os nicks, os grupos e todos os placares deste navegador serão apagados. Exporte um backup antes, se precisar.',
    ok: 'Apagar tudo',
    danger: true,
  });
  if (!ok) return;
  if (persist(defaults())) {
    showView('inicio');
    notify('Campeonato reiniciado neste navegador.');
  }
}

/* ---------- Wiring ---------- */

document.addEventListener('click', event => {
  const link = event.target.closest('[data-view]');
  if (link) {
    event.preventDefault();
    showView(link.dataset.view);
    return;
  }
  const match = event.target.closest('[data-match]');
  if (match && !match.disabled) openMatch(match.dataset.match);
});
window.addEventListener('popstate', () => showView(location.hash.slice(1), { push: false }));
$('menu-toggle').addEventListener('click', () => setMenu($('menu-toggle').getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenu(false); });

$('players').addEventListener('input', event => {
  const id = Number(event.target.dataset.player);
  if (Number.isNaN(id)) return;
  const nick = $('nick' + id).value.trim();
  $('pl-' + id).textContent = nick || $('name' + id).value.trim() || names[id];
});
$('registration-form').addEventListener('submit', saveRegistration);
$('draw-groups').addEventListener('click', startDraw);
$('draw-skip').addEventListener('click', () => { skipDraw = true; });
$('sound-toggle').addEventListener('click', () => setSound(!soundOn));
$('scores-form').addEventListener('submit', saveScores);
$('match-form').addEventListener('submit', saveMatch);
$('match-form').addEventListener('input', updateTie);
$('md-clear').addEventListener('click', clearMatch);
$('match-dialog').querySelector('[data-close]').addEventListener('click', () => $('match-dialog').close());
$('export-data').addEventListener('click', exportData);
$('import-data').addEventListener('click', () => $('import').click());
$('import').addEventListener('change', importData);
$('reset-data').addEventListener('click', resetAll);

setSound(soundOn);
renderBudget();
render();
const initial = location.hash.slice(1);
if (views.includes(initial) && initial !== 'inicio') showView(initial, { push: false, focus: false });
if (updateCountdown()) {
  const timer = setInterval(() => { if (!updateCountdown()) clearInterval(timer); }, 1000);
}
