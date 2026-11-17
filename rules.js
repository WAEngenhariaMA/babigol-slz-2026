/* Regras compartilhadas entre o navegador e a API. */
(function (factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else globalThis.BabigolRules = factory();
})(function () {
  "use strict";

  // O Airtable tem 12 vagas de participantes (IDs 0 a 11) e partidas para até 3 grupos.
  const MAX_PLAYERS = 12;
  const MIN_PLAYERS = 4;
  const GROUP_LIMIT = 4;
  const groupNames = ['A', 'B', 'C'];
  // Ordem dos confrontos por tamanho de grupo; cada rodada tem `perRound` jogos.
  const schedules = {
    4: { pairs: [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]], perRound: 2 },
    3: { pairs: [[0, 1], [0, 2], [1, 2]], perRound: 1 },
    2: { pairs: [[0, 1]], perRound: 1 },
  };

  function defaults() {
    return { players: [], groups: null, scores: {}, ko: {}, draw: null };
  }

  /** Tamanhos dos grupos: o menor número de grupos com no máximo 4, o mais equilibrado possível. */
  function groupSizes(count) {
    if (!Number.isInteger(count) || count < MIN_PLAYERS || count > MAX_PLAYERS) return [];
    const total = Math.ceil(count / GROUP_LIMIT);
    const base = Math.floor(count / total);
    return Array.from({ length: total }, (_, g) => base + (g < count % total ? 1 : 0));
  }

  /** Formato do mata-mata para uma quantidade de grupos. */
  function format(groupCount) {
    if (groupCount === 1) return { groups: 1, qualifiers: 2, thirds: 0, rounds: ['final'] };
    if (groupCount === 2) return { groups: 2, qualifiers: 4, thirds: 0, rounds: ['semi', 'final'] };
    if (groupCount === 3) return { groups: 3, qualifiers: 8, thirds: 2, rounds: ['quarter', 'semi', 'final'] };
    return null;
  }

  function knockoutKeys(groupCount) {
    if (groupCount === 1) return ['final'];
    if (groupCount === 2) return ['s0', 's1', 'final'];
    if (groupCount === 3) return ['q0', 'q1', 'q2', 'q3', 's0', 's1', 'final'];
    return [];
  }

  function fixtures(data) {
    if (!data.groups) return [];
    return data.groups.flatMap((group, g) => {
      const schedule = schedules[group.length];
      if (!schedule) return [];
      return schedule.pairs.map(([a, b], index) => ({
        key: `${g}-${index}`, a: group[a], b: group[b], g,
        round: Math.floor(index / schedule.perRound) + 1, index,
      }));
    });
  }

  function hasScore(score) {
    return score && score.a !== '' && score.b !== '' && score.a != null && score.b != null;
  }

  function standings(data, g) {
    const rows = data.groups[g].map(id => ({ id, p: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0 }));
    for (const fixture of fixtures(data).filter(match => match.g === g)) {
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

  // Terceiros de grupos com tamanhos diferentes são comparados pela média por jogo.
  // Com o mesmo número de jogos, o resultado é igual ao de `rank`.
  function rankThirds(a, b) {
    const per = (x, y, key) => y[key] * Math.max(x.j, 1) - x[key] * Math.max(y.j, 1);
    return per(a, b, 'p') || per(a, b, 'sg') || per(a, b, 'gp') || a.id - b.id;
  }

  function qualifiers(data, matches = fixtures(data)) {
    const shape = data.groups && format(data.groups.length);
    if (!shape || !matches.length || !matches.every(match => hasScore(data.scores[match.key]))) return null;
    const groups = data.groups.map((_, g) => standings(data, g));
    const thirds = shape.thirds ? groups.filter(rows => rows[2]).map(rows => ({ ...rows[2], g: groups.indexOf(rows) }))
      .sort(rankThirds) : [];
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
    if (groups.length === 1) return [{ key: 'final', a: groups[0][0].id, b: groups[0][1].id }];
    if (groups.length === 2) {
      const [a, b] = groups;
      const semis = [{ key: 's0', a: a[0].id, b: b[1].id }, { key: 's1', a: b[0].id, b: a[1].id }];
      return [...semis, { key: 'final', a: winner(semis[0], scores), b: winner(semis[1], scores) }];
    }
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

  function drawGroupsFromSeed(players, seed) {
    const random = mulberry32(seed);
    const ids = players.map(entry => entry.id).sort((a, b) => a - b);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    let start = 0;
    return groupSizes(ids.length).map(size => ids.slice(start, start += size));
  }

  function drawCode(seed) {
    return 'BG26-' + seed.toString(16).toUpperCase().padStart(6, '0');
  }

  function changeKnockout(state, key, score) {
    const qualified = qualifiers(state);
    const before = knockout(qualified, state.ko);
    const candidate = { ...state.ko };
    if (score) candidate[key] = score;
    else delete candidate[key];

    const ko = {};
    const discarded = [];
    for (const [index, match] of before.entries()) {
      const next = knockout(qualified, ko)[index];
      const previous = candidate[match.key];
      if (match.a !== next.a || match.b !== next.b) {
        if (hasScore(previous)) discarded.push(match.key);
      } else if (previous) {
        ko[match.key] = previous;
      }
    }
    return { ko, discarded };
  }

  return { MAX_PLAYERS, MIN_PLAYERS, GROUP_LIMIT, groupNames, defaults, groupSizes, format, knockoutKeys,
    fixtures, standings, qualifiers, rank, rankThirds, hasScore, winner, knockout, changeKnockout,
    sequenceFromSeed, drawGroupsFromSeed, drawCode };
});
