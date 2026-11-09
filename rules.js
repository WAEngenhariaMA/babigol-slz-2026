/* Regras compartilhadas entre o navegador e a API. */
(function (factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else globalThis.BabigolRules = factory();
})(function () {
  "use strict";

  const names = [
    'Danillo Lopes', 'Távora', 'Danillo Araújo', 'Brian', 'Tainan', 'Wesley',
    'Charles', 'Gustavo', 'Wellington', 'Erick', 'Leandro', 'Saulo',
  ];
  const groupNames = ['A', 'B', 'C'];
  const groupPairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];

  function defaults() {
    return {
      players: names.map((name, id) => ({ id, name, nick: '' })),
      groups: null,
      scores: {},
      ko: {},
      draw: null,
    };
  }

  function fixtures(data) {
    if (!data.groups) return [];
    return data.groups.flatMap((group, g) => groupPairs.map(([a, b], index) => ({
      key: `${g}-${index}`, a: group[a], b: group[b], g, round: Math.floor(index / 2) + 1, index,
    })));
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

  function qualifiers(data, matches = fixtures(data)) {
    if (matches.length !== 18 || !matches.every(match => hasScore(data.scores[match.key]))) return null;
    const groups = groupNames.map((_, g) => standings(data, g));
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
    return [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12)];
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

  return { names, groupNames, defaults, fixtures, standings, qualifiers, rank, hasScore,
    winner, knockout, changeKnockout, sequenceFromSeed, drawGroupsFromSeed, drawCode };
});
