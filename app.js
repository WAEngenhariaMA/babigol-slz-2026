const storageKey = 'babigol2026';
const soundKey = 'babigol-sound';
const { names, groupNames, defaults, hasScore, winner, knockout, rank, sequenceFromSeed, changeKnockout } = BabigolRules;
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

function readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

const localBackup = readLocal(storageKey);
const cacheKey = 'babigol2026-online-v3';
let official = readLocal(cacheKey);
if (!validBackup(official?.state) || !Array.isArray(official?.budget?.items)) official = null;
let data = official?.state || defaults();
let online = false;
let admin = false;
let refreshing = false;
let pending = false;
let dirty = false;
let connectionMessage = official ? 'Exibindo a última cópia online neste navegador.' : 'Carregando dados oficiais…';
const canEdit = () => admin && online && !pending;

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

async function request(action, input, fresh = false) {
  const query = new URLSearchParams({ acao: action });
  if (fresh) query.set('atualizar', '1');
  const response = await fetch('/api/campeonato?' + query, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...(input === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    signal: AbortSignal.timeout(65_000),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || 'O servidor não confirmou a operação.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function applyMode() {
  $('mode').textContent = admin ? 'Modo administrador' : 'Modo público';
  $('online-status').textContent = connectionMessage;
  $('online-status').dataset.online = String(online);
  $('admin-login').hidden = admin;
  $('admin-logout').hidden = !admin;
  $('export-local').hidden = !validBackup(localBackup);
  $('compare-local').hidden = !admin || !online || !validBackup(localBackup);
  document.querySelectorAll('[data-admin]').forEach(control => { control.hidden = !admin; });
  document.querySelectorAll('[data-edit]').forEach(control => { control.disabled = !canEdit(); });
  $('draw-groups').disabled = drawing || !canEdit();
  $('registration-submit').hidden = !admin;
  $('score-actions').hidden = !admin || !data.groups;
  $('players').querySelectorAll('input').forEach(input => { input.readOnly = !canEdit(); });
  $('games').querySelectorAll('input').forEach(input => { input.readOnly = !canEdit(); });
  $('bracket').querySelectorAll('[data-match]').forEach(button => {
    button.disabled = !canEdit() || button.dataset.ready !== 'true';
  });
}

function applyOfficial(next) {
  official = next;
  data = next.state;
  const { categories, items, ...settings } = next.budget;
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      ...next, budget: { ...settings, items: items.filter(item => item.active) },
    }));
  } catch { /* Browser cache is optional. */ }
  online = true;
  dirty = false;
  const stamp = next.updatedAt && new Date(next.updatedAt);
  connectionMessage = stamp && Number.isFinite(stamp.getTime())
    ? 'Última atualização em ' + new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(stamp)
    : 'Dados oficiais carregados · revisão ' + next.revision;
  render();
  renderBudget();
  applyMode();
}

async function refresh(fresh = false) {
  if (refreshing || pending || drawing) return;
  if (fresh && dirty && !(await ask({
    title: 'Atualizar os dados?',
    text: 'As alterações ainda não salvas nesta tela serão descartadas.',
    ok: 'Atualizar',
  }))) return;
  refreshing = true;
  try {
    const session = await request('sessao');
    const changedRole = admin !== session.admin;
    admin = session.admin;
    const next = await request('estado', undefined, fresh);
    if (!dirty || fresh || changedRole) {
      if (next.version !== official?.version || !online || fresh || changedRole) applyOfficial(next);
      else applyMode();
    }
  } catch (error) {
    online = false;
    connectionMessage = (error.status ? error.message : 'Falha de conexão com o servidor.') +
      (official ? ' Exibindo a última cópia disponível.' : ' Nenhum dado oficial foi carregado.');
    applyMode();
  } finally {
    refreshing = false;
  }
}

async function mutate(action, input, version = official?.version) {
  if (!canEdit() || refreshing) {
    notify('Atualize os dados e entre como administrador antes de editar.', true);
    return false;
  }
  pending = true;
  applyMode();
  try {
    applyOfficial(await request(action, { ...input, version }));
    return true;
  } catch (error) {
    if (error.status === 401) {
      admin = false;
      renderBudget();
    }
    if (!error.status || error.status === 409 || error.status >= 500) {
      online = false;
      connectionMessage = error.status ? error.message : 'A gravação não foi confirmada. Atualize os dados.';
    }
    notify(error.status ? error.message : 'A gravação não foi confirmada. Atualize antes de tentar novamente.', true);
    return false;
  } finally {
    pending = false;
    applyMode();
  }
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

const fixtures = () => BabigolRules.fixtures(data);
const standings = g => BabigolRules.standings(data, g);
const qualifiers = matches => BabigolRules.qualifiers(data, matches);

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
      <input id="name${entry.id}" data-player="${entry.id}" type="text" value="${escapeHtml(entry.name)}" autocomplete="off" maxlength="100">
      <label for="nick${entry.id}">Nick / gamertag</label>
      <div class="input-icon">${icon('pad')}<input id="nick${entry.id}" data-player="${entry.id}" type="text" value="${escapeHtml(entry.nick)}" placeholder="Digite o nick" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="80"></div>
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
  return `<button type="button" class="bm ${key === 'final' ? 'bm-final' : ''} ${played ? 'played' : ''}" data-match="${key}" data-ready="${Boolean(ready)}" ${ready && canEdit() ? '' : 'disabled'} aria-label="${escapeHtml(aria)}">
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
  if (drawing || !canEdit()) return;
  const version = official.version;
  if (data.groups) {
    const hasResults = Object.values(data.scores).some(hasScore) || Object.values(data.ko).some(hasScore);
    if (!(await ask({
      title: 'Refazer o sorteio?',
      text: hasResults
        ? 'Os grupos atuais serão substituídos e todos os placares da fase de grupos e do mata-mata serão apagados.'
        : 'Os grupos atuais serão substituídos por um novo sorteio.',
      ok: 'Sortear novamente',
      danger: hasResults,
    }))) return;
  }
  if (!(await mutate('sorteio', { confirm: true }, version))) return;
  const draw = { ...data.draw, sequence: sequenceFromSeed(data.draw.seed) };
  drawing = true;
  try {
    await playDraw(draw, data.groups);
  } finally {
    drawing = false;
    $('draw-skip').hidden = true;
    applyMode();
  }
  notify('Sorteio ' + draw.code + ' concluído. Grupos salvos.');
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

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = cents => currency.format(cents / 100);

function renderBudget() {
  const budget = official?.budget;
  if (!budget) {
    $('budget').innerHTML = '<p class="card budget-table">O orçamento será exibido quando os dados oficiais estiverem disponíveis.</p>';
    return;
  }
  const { items, people, quotaCents } = budget;
  const active = items.filter(item => item.active);
  const total = active.reduce((sum, item) => sum + item.cents, 0);
  const largest = Math.max(1, ...active.map(item => item.cents));
  const expected = quotaCents * people;
  const summary = [
    ['Total estimado', total, 'beer'], ['Custo por pessoa (' + people + ' no rateio)', total / people, 'users'],
    ['Cota sugerida por pessoa', quotaCents, 'check'], ['Arrecadação prevista', expected, 'table'],
    ['Reserva prevista', expected - total, 'pin'],
  ];
  $('budget').innerHTML = `<div class="budget-summary">
    ${summary.map(([title, amount, image], i) => `<div class="budget-tile ${i === 2 ? 'highlight' : ''}">
      ${icon(image)}<span>${title}</span><strong>${brl(amount)}</strong></div>`).join('')}
    </div><div class="card budget-table"><table>
      <caption class="sr-only">Itens ativos do churrasco e chopp</caption>
      <thead><tr><th scope="col">Item</th><th scope="col" class="num">Valor estimado</th><th scope="col" class="bar-col"><span class="sr-only">Proporção</span></th></tr></thead>
      <tbody>${active.map(item => `<tr><th scope="row">${escapeHtml(item.item)}${item.category ? `<small class="budget-category">${escapeHtml(item.category)}</small>` : ''}</th>
        <td class="num">${brl(item.cents)}</td><td class="bar-col"><span class="bar" style="width:${item.cents / largest * 100}%"></span></td></tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num">${brl(total)}</td><td class="bar-col"></td></tr></tfoot>
    </table>${active.length ? '' : '<p>Nenhum item ativo.</p>'}</div>
    ${admin && budget.categories ? `<section class="card budget-manage" aria-labelledby="budget-admin-title" data-admin>
      <h2 id="budget-admin-title">Administrar orçamento</h2>
      <div class="actions">
        <button type="button" class="button primary small" data-budget-add data-edit>Adicionar item</button>
      </div>
      <form id="budget-settings" class="budget-settings">
        <label>Pessoas no rateio <input name="people" type="number" min="1" max="9999" step="1" value="${people}" required data-edit></label>
        <label>Cota sugerida por pessoa (R$) <input name="quota" type="text" inputmode="decimal" value="${(quotaCents / 100).toFixed(2).replace('.', ',')}" required data-edit></label>
        <button class="button primary small" type="submit" data-edit>Salvar rateio</button>
      </form>
      <ul class="budget-admin-list">${items.map(item => `<li>
        <span><strong>${escapeHtml(item.item)}</strong><small>${item.active ? 'Ativo' : 'Desativado'} · ordem ${item.order} · ${brl(item.cents)}</small></span>
        <div class="actions">
          <button type="button" class="button ghost small" data-budget-item="${escapeHtml(item.id)}" data-edit>Editar</button>
          <button type="button" class="button ghost small" data-budget-toggle="${escapeHtml(item.id)}" data-edit>${item.active ? 'Desativar' : 'Restaurar'}</button>
        </div></li>`).join('')}</ul>
    </section>` : ''}`;
}

let budgetEditing = null;
let budgetVersion;
function openBudget(item) {
  if (!canEdit()) return;
  budgetEditing = item || null;
  budgetVersion = official.version;
  const form = $('budget-item-form');
  $('budget-item-title').textContent = item ? 'Editar item' : 'Adicionar item';
  form.elements.category.innerHTML = '<option value="">Sem categoria</option>' + official.budget.categories.map(category =>
    '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>').join('');
  form.elements.namedItem('item').value = item?.item ?? '';
  form.elements.category.value = item?.category ?? '';
  form.elements.amount.value = item ? (item.cents / 100).toFixed(2).replace('.', ',') : '';
  form.elements.order.value = item?.order ?? (Math.max(0, ...official.budget.items.map(entry => entry.order)) + 1);
  $('budget-item-error').textContent = '';
  $('budget-dialog').showModal();
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

async function saveRegistration(event) {
  event.preventDefault();
  const players = data.players.map(entry => ({
    ...entry,
    name: $('name' + entry.id).value.trim() || names[entry.id],
    nick: $('nick' + entry.id).value.trim(),
  }));
  if (await mutate('participantes', { players })) notify('Inscrições salvas no Airtable.');
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
  if (!canEdit()) return;
  const version = official.version;
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
  if (await mutate('placares', { scores, confirm: true }, version)) {
    notify('Resultados salvos. A classificação foi atualizada.');
  }
}

let editingKey = null;
let matchVersion;

function currentKnockout() {
  return knockout(qualifiers(fixtures()), data.ko);
}

function openMatch(key) {
  if (!canEdit()) return;
  const match = currentKnockout().find(entry => entry.key === key);
  if (!match || match.a == null || match.b == null) return;
  editingKey = key;
  matchVersion = official.version;
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
  if (!canEdit()) return false;
  const before = currentKnockout();
  const championBefore = before.length ? winner(before.at(-1), data.ko) : null;
  const { discarded } = changeKnockout(data, key, entry);
  if (discarded.length && !(await ask({
    title: 'Descartar partidas seguintes?',
    text: 'Este resultado muda quem avança. Os placares de ' +
      discarded.map(match => matchInfo[match].title).join(', ') + ' serão apagados.',
    ok: 'Salvar e descartar',
    danger: true,
  }))) return false;
  if (!(await mutate('mata-mata', { key, score: entry, confirm: true }, matchVersion))) return false;
  const after = currentKnockout();
  const championAfter = after.length ? winner(after.at(-1), data.ko) : null;
  if (championAfter != null && championAfter !== championBefore) {
    confetti();
    notify(playerLabel(championAfter) + ' é o campeão do 1º Campeonato Babigol SLZ!');
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

function downloadJson(value, name) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportData() {
  try {
    downloadJson(await request('backup'), 'babigol-slz-campeonato.json');
  } catch (error) {
    notify(error.status ? error.message : 'O backup online não pôde ser exportado.', true);
  }
}

function compareLocal() {
  const count = state => state.players.filter(entry => entry.nick.trim()).length + ' nicks, ' +
    (state.groups ? '3 grupos' : 'sem grupos') + ', ' +
    Object.values(state.scores).filter(hasScore).length + ' placares de grupos e ' +
    Object.values(state.ko).filter(hasScore).length + ' do mata-mata.';
  const changed = localBackup.players.filter(entry => {
    const remote = data.players.find(player => player.id === entry.id);
    return remote?.name !== entry.name || remote?.nick !== entry.nick;
  }).length;
  const positions = groupNames.map((group, index) => {
    const previous = localBackup.groups?.[index] || [];
    const current = data.groups?.[index] || [];
    const count = Array.from({ length: 4 }, (_, position) => previous[position] !== current[position]).filter(Boolean).length;
    return group + ' (' + count + ')';
  });
  const changedScores = key => {
    const local = localBackup[key];
    const remote = data[key];
    return [...new Set([...Object.keys(local), ...Object.keys(remote)])].filter(id => {
      const normalize = score => hasScore(score) ? [String(score.a), String(score.b), String(score.win ?? '')].join('/') : '';
      return normalize(local[id]) !== normalize(remote[id]);
    }).length;
  };
  $('compare-summary').textContent = 'Backup local — ' + count(localBackup) + ' Online — ' + count(data) +
    ' Diferenças em ' + changed + ' cadastros, nas posições dos grupos ' + positions.join(', ') +
    ' e em ' + changedScores('scores') + ' placares de grupos e ' + changedScores('ko') + ' do mata-mata.';
  $('compare-dialog').showModal();
}

async function importData(event) {
  const input = event.target;
  const file = input.files[0];
  input.value = '';
  if (!file || !canEdit()) return;
  const version = official.version;
  let imported;
  try {
    if (file.size > 60_000) throw new Error();
    imported = JSON.parse(await file.text());
    if (!validBackup(imported)) throw new Error();
  } catch {
    notify('Arquivo inválido. Selecione um backup JSON do campeonato.', true);
    return;
  }
  const restoreBudget = $('restore-budget').checked;
  if (restoreBudget && !Array.isArray(imported.budget?.items)) {
    notify('O arquivo não tem orçamento online. Desmarque a opção de orçamento para importar.', true);
    return;
  }
  if (!(await ask({
    title: 'Importar backup para o Airtable?',
    text: 'Os dados oficiais de participantes, sorteio e partidas serão substituídos. ' +
      (restoreBudget ? 'O rateio e os itens do orçamento presentes no arquivo também serão atualizados. ' : '') +
      'Exporte o backup online antes de continuar.',
    ok: 'Importar dados oficiais',
    danger: true,
  }))) return;
  if (await mutate('importar', { backup: imported, confirm: true, restoreBudget }, version)) {
    $('restore-budget').checked = false;
    notify('Backup importado no Airtable.');
  }
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
  if (!canEdit()) return;
  const version = official.version;
  const ok = await ask({
    title: 'Reiniciar o campeonato?',
    text: 'Os nicks, os grupos e os placares oficiais serão apagados. O orçamento permanece disponível.',
    ok: 'Reiniciar campeonato',
    danger: true,
  });
  if (ok && await mutate('reiniciar', { confirm: true }, version)) {
    showView('inicio');
    notify('Campeonato reiniciado no Airtable.');
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
$('export-local').addEventListener('click', () => downloadJson(localBackup, 'babigol-slz-backup-local.json'));
$('compare-local').addEventListener('click', compareLocal);
$('refresh-data').addEventListener('click', () => refresh(true));
$('admin-login').addEventListener('click', () => {
  $('login-form').reset();
  $('login-error').textContent = '';
  $('login-dialog').showModal();
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    await request('login', { password: form.elements.password.value });
    $('login-dialog').close();
    await refresh(true);
  } catch (error) {
    $('login-error').textContent = error.status ? error.message : 'O login não foi confirmado.';
  } finally {
    form.elements.password.value = '';
    submit.disabled = false;
  }
});
$('admin-logout').addEventListener('click', async () => {
  if (pending) return;
  try {
    await request('logout', {});
    admin = false;
    dirty = false;
    render();
    renderBudget();
    applyMode();
    await refresh();
  } catch (error) {
    notify(error.status ? error.message : 'A saída não foi confirmada.', true);
  }
});
$('recover-data').addEventListener('click', async () => {
  if (!admin || pending || !(await ask({
    title: 'Recuperar gravação?',
    text: 'O servidor verificará o registro da operação e restaurará os campos incompletos quando for seguro.',
    ok: 'Verificar gravação',
  }))) return;
  pending = true;
  applyMode();
  try {
    const result = await request('recuperar', { confirm: true });
    notify(result.recovered ? 'Gravação recuperada.' : 'Nenhuma gravação pendente.');
  } catch (error) {
    notify(error.status ? error.message : 'A recuperação não foi confirmada.', true);
  } finally {
    pending = false;
    await refresh(true);
  }
});
$('budget').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || !canEdit()) return;
  if ('budgetAdd' in button.dataset) openBudget();
  const item = official.budget.items.find(entry => entry.id === (button.dataset.budgetItem || button.dataset.budgetToggle));
  if (!item) return;
  if (button.dataset.budgetItem) openBudget(item);
  if (button.dataset.budgetToggle) {
    const version = official.version;
    if (item.active && !(await ask({
      title: 'Desativar item?',
      text: 'O item será retirado do total. Você poderá restaurá-lo depois.',
      ok: 'Desativar',
    }))) return;
    if (await mutate('orcamento-ativo', { id: item.id, active: !item.active }, version)) notify('Orçamento atualizado.');
  }
});
$('budget').addEventListener('submit', async event => {
  if (event.target.id !== 'budget-settings') return;
  event.preventDefault();
  const values = new FormData(event.target);
  if (await mutate('orcamento-rateio', { people: Number(values.get('people')), quota: values.get('quota') })) {
    notify('Rateio atualizado.');
  }
});
$('budget-item-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(event.target);
  const item = { item: values.get('item'), category: values.get('category'), amount: values.get('amount'), order: Number(values.get('order')) };
  if (await mutate(budgetEditing ? 'orcamento-editar' : 'orcamento-adicionar',
    { id: budgetEditing?.id, item }, budgetVersion)) {
    $('budget-dialog').close();
    notify('Item salvo no Airtable.');
  } else {
    $('budget-item-error').textContent = $('feedback').textContent;
  }
});
document.querySelectorAll('[data-close-dialog]').forEach(button => {
  button.addEventListener('click', () => button.closest('dialog').close());
});
document.addEventListener('input', event => {
  if (event.target.closest('#registration-form, #scores-form, #budget-settings')) dirty = true;
});
function poll() {
  if (!document.hidden && !dirty && !document.querySelector('dialog[open]')) refresh();
}
setInterval(poll, 60_000);
document.addEventListener('visibilitychange', poll);
$('import-data').addEventListener('click', () => $('import').click());
$('import').addEventListener('change', importData);
$('reset-data').addEventListener('click', resetAll);

setSound(soundOn);
renderBudget();
render();
applyMode();
refresh();
const initial = location.hash.slice(1);
if (views.includes(initial) && initial !== 'inicio') showView(initial, { push: false, focus: false });
if (updateCountdown()) {
  const timer = setInterval(() => { if (!updateCountdown()) clearInterval(timer); }, 1000);
}
