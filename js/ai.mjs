/*!
 * 直角 · 电脑对手
 * ------------------------------------------------------------------
 * 一步取胜优先；随手档随机选合法着法，稳健/凶狠档避开对手的一步胜着，
 * 再按成格、局部威胁和种子使用情况做轻量评分。
 */
import * as R from './rules.mjs';

const EMPTY = R.EMPTY;
  const WIN = 1e6;

  /* 含某条线段的所有折角（最多 4 个） */
  function shapesWithEdge(s, e) {
    var W = s.W, H = s.H;
    if (e.kind === 'h') {
      var x2 = (e.x + 1) % W;
      return [
        { x: e.x, y: e.y, q: 0 }, { x: e.x, y: e.y, q: 1 },
        { x: x2, y: e.y, q: 2 }, { x: x2, y: e.y, q: 3 }
      ];
    }
    var y2 = (e.y + 1) % H;
    return [
      { x: e.x, y: e.y, q: 1 }, { x: e.x, y: e.y, q: 2 },
      { x: e.x, y: y2, q: 0 }, { x: e.x, y: y2, q: 3 }
    ];
  }

  /* 假设 (cx,cy) 已经属于 p，是否能连成四格 */
  function fourWith(s, p, cx, cy) {
    var W = s.W, H = s.H;
    for (var d = 0; d < R.DIRS4.length; d++) {
      var dx = R.DIRS4[d][0], dy = R.DIRS4[d][1];
      for (var k = 0; k < 4; k++) {
        var ok = true, seen = {};
        for (var t = 0; t < 4; t++) {
          var x = R.wrapX(s, cx - k * dx + t * dx), y = R.wrapY(s, cy - k * dy + t * dy);
          var key = x * 31 + y;
          if (seen[key]) { ok = false; break; }
          seen[key] = 1;
          if (x === cx && y === cy) continue;              // 这一格当作已经是 p 的
          if (s.cell[y * W + x] !== p) { ok = false; break; }
        }
        if (ok) return true;
      }
    }
    return false;
  }

  /**
   * 当前行棋方一步就能取胜的着法（精确，不枚举所有着法）。
   * 一步取胜 = 补上一格的第四条边，且这一格正好连成四格。
   */
  function winningMoves(s) {
    var p = s.turn, W = s.W, H = s.H, out = [];
    for (var cy = 0; cy < H; cy++) {
      var row = cy * W, rowN = ((cy + 1) % H) * W;
      for (var cx = 0; cx < W; cx++) {
        if (s.cell[row + cx] !== EMPTY) continue;
        var nx = cx + 1; if (nx === W) nx = 0;
        var mine = 0, free = null, blocked = false, ow;

        ow = s.h[row + cx];
        if (ow === p) mine++; else if (ow === EMPTY) free = { kind: 'h', x: cx, y: cy }; else blocked = true;
        if (!blocked) {
          ow = s.h[rowN + cx];
          if (ow === p) mine++; else if (ow === EMPTY) free = { kind: 'h', x: cx, y: (cy + 1) % H }; else blocked = true;
        }
        if (!blocked) {
          ow = s.v[row + cx];
          if (ow === p) mine++; else if (ow === EMPTY) free = { kind: 'v', x: cx, y: cy }; else blocked = true;
        }
        if (!blocked) {
          ow = s.v[row + nx];
          if (ow === p) mine++; else if (ow === EMPTY) free = { kind: 'v', x: nx, y: cy }; else blocked = true;
        }

        if (blocked || mine !== 3 || !free) continue;
        if (!fourWith(s, p, cx, cy)) continue;

        var cands = shapesWithEdge(s, free);
        for (var j = 0; j < cands.length; j++) {
          var m = R.validateMove(s, cands[j].x, cands[j].y, cands[j].q);
          if (m) out.push(m);
        }
      }
    }
    return out;
  }

  /* 便宜的快筛分：只看这一步碰到的格子，不复制局面、不分配对象 */
  function quickScore(s, m, p) {
    var opp = 1 - p, W = s.W, H = s.H, sc = 0;
    var e0 = m.edges[0], e1 = m.edges[1];
    var seen = {};

    for (var i = 0; i < 2; i++) {
      var e = m.edges[i];
      var ax, ay, bx, by;
      if (e.kind === 'h') {                       // 上下两个格子
        ax = e.x; ay = e.y;
        bx = e.x; by = (e.y - 1 + H) % H;
      } else {                                    // 左右两个格子
        ax = e.x; ay = e.y;
        bx = (e.x - 1 + W) % W; by = e.y;
      }

      for (var j = 0; j < 2; j++) {
        var cx = j ? bx : ax, cy = j ? by : ay;
        var key = cy * W + cx;
        if (seen[key] || s.cell[key] !== EMPTY) continue;
        seen[key] = 1;

        var row = cy * W, rowN = ((cy + 1) % H) * W;
        var nx = cx + 1; if (nx === W) nx = 0;
        var cyN = cy + 1; if (cyN === H) cyN = 0;
        var mine = 0, theirs = 0, ow;

        ow = ((e0.kind === 'h' && e0.x === cx && e0.y === cy) ||
              (e1.kind === 'h' && e1.x === cx && e1.y === cy)) ? p : s.h[row + cx];
        if (ow === p) mine++; else if (ow === opp) theirs++;

        ow = ((e0.kind === 'h' && e0.x === cx && e0.y === cyN) ||
              (e1.kind === 'h' && e1.x === cx && e1.y === cyN)) ? p : s.h[rowN + cx];
        if (ow === p) mine++; else if (ow === opp) theirs++;

        ow = ((e0.kind === 'v' && e0.x === cx && e0.y === cy) ||
              (e1.kind === 'v' && e1.x === cx && e1.y === cy)) ? p : s.v[row + cx];
        if (ow === p) mine++; else if (ow === opp) theirs++;

        ow = ((e0.kind === 'v' && e0.x === nx && e0.y === cy) ||
              (e1.kind === 'v' && e1.x === nx && e1.y === cy)) ? p : s.v[row + nx];
        if (ow === p) mine++; else if (ow === opp) theirs++;

        if (mine === 4) sc += 5000;
        else if (mine === 1 && theirs === 3) sc += 1600;
        else sc += mine * mine * 16 - theirs * theirs * 20;
      }
    }
    if (m.isSeed) sc -= 50;
    return sc;
  }

  /**
   * 选一步棋。
   * @param {object} s  当前局面
   * @param {object} [opts] {level:1|2|3, random:fn}
   * @returns {object|null} 合法着法 {x,y,q}
   */
  function chooseAIMove(s, opts) {
    opts = opts || {};
    var rnd = opts.random || Math.random;

    /* 1) 一步取胜：直接算出来，不看别的 */
    var win = winningMoves(s);
    if (win.length) return win[Math.floor(rnd() * win.length)];

    var level = Math.max(1, Math.min(3, Number(opts.level) || 2));
    var allMoves = R.legalMoves(s);
    if (!allMoves.length) return null;
    if (level === 1) return allMoves[Math.floor(rnd() * allMoves.length)];

    var safe = [];
    for (var si = 0; si < allMoves.length; si++) {
      var probe = R.cloneState(s);
      R.applyMove(probe, allMoves[si], { skipDraw: true });
      if (!winningMoves(probe).length) safe.push(allMoves[si]);
    }
    var pool = safe.length ? safe : allMoves;
    var ranked = [];
    for (var mi = 0; mi < pool.length; mi++) {
      var move = pool[mi], next = R.cloneState(s);
      var rec = R.applyMove(next, move, { skipDraw: true });
      /* Defence is a hard priority: count the opponent's actual winning
         replies after this move, rather than relying on a local edge score.
         This catches torus seams and threats that touch two cells at once. */
      var replies = next.winner == null ? winningMoves(next).length : 0;
      var score = (rec.claimed.length * 10000) + quickScore(s, move, s.turn);
      score -= replies * 20000;
      if (move.isSeed) score += s.seeds[s.turn] > 1 ? 90 : -80;
      else score += 140; // continue an existing line before opening a new one
      if (next.winner === s.turn) score += WIN;
      ranked.push({ move: move, score: score });
    }
    ranked.sort(function (a, b) { return b.score - a.score; });
    var limit = level === 2 ? Math.min(3, ranked.length) : 1;
    return ranked[Math.floor(rnd() * limit)].move;

  }

export { chooseAIMove, winningMoves, quickScore };
