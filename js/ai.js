/*!
 * 直角 · 电脑对手
 * ------------------------------------------------------------------
 * 攻守兼备，分三层：
 *
 *   1. 战术层：一步取胜 / 一步被将死，都用「威胁格」直接算出来 ——
 *      精确，且完全不枚举着法。
 *   2. 候选层：棋盘最大 21×21，开局合法着法一千多个，先压到几十个 ——
 *      优先收「三缺一的格子」（我能成格 / 对手马上成格），
 *      再按便宜的快筛分挑贴着自己或对手线的生长点，最后补几个起笔点。
 *   3. 搜索层：负极大值 + α-β 剪枝。默认看两步（我走 + 对手最佳应对），
 *      所以它既会主动做「对手挡不住的双重威胁」，也不会把胜利送出去。
 *
 * 性能上有条硬要求：一次搜索要算上千个叶子局面，每个叶子都要扫全盘，
 * 所以热点循环全部手写索引、不分配对象。
 *
 * 难度：1 = 随手（贪心 + 常乱走）、2 = 稳健（看两步）、3 = 凶狠（看三步）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./rules.js')); return; }
  root.ZJ = root.ZJ || {};
  root.ZJ.ai = factory(root.ZJ.rules);
})(typeof window !== 'undefined' ? window : globalThis, function (R) {
  'use strict';

  var EMPTY = R.EMPTY;
  var WIN = 1e6;                       // 胜局分（越早赢分越高）
  var LINE_W = [0, 6, 55, 700, 8000];  // 四连窗口里已有几个自己的格子
  var POOL_MAX = 400;                  // 生长点候选上限（防止大棋盘爆掉）
  var SEED_CAND = 4;                   // 每次最多摆几个起笔候选

  /* 环面上一个方格的四条边（只在少数地方用，可以放心分配） */
  function cellEdges(s, cx, cy) {
    return [
      { kind: 'h', x: cx, y: cy },
      { kind: 'h', x: cx, y: R.wrapY(s, cy + 1) },
      { kind: 'v', x: cx, y: cy },
      { kind: 'v', x: R.wrapX(s, cx + 1), y: cy }
    ];
  }

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

        if (mine === 4) sc += 5000;                       // 这一步直接成格
        else if (mine === 1 && theirs === 3) sc += 1600;  // 抢掉对手成格的最后一边
        else sc += mine * mine * 16 - theirs * theirs * 20;
        if (mine === 3) m._t = 1;                         // 造出「三缺一」＝逼对手应一手
      }
    }
    if (m.isSeed) sc -= 50;
    return sc;
  }

  /* 静态局面分：站在 me 的视角。零和（换边恰好取反），负极大值才成立。 */
  function evaluate(s, me) {
    var opp = 1 - me, W = s.W, H = s.H;
    var sc = 0, mine = 0, theirs = 0, cx, cy, m, q, ow;

    for (cy = 0; cy < H; cy++) {
      var row = cy * W, rowN = ((cy + 1) % H) * W;
      for (cx = 0; cx < W; cx++) {
        var o = s.cell[row + cx];
        if (o === me) { mine++; continue; }
        if (o === opp) { theirs++; continue; }

        var nx = cx + 1; if (nx === W) nx = 0;
        m = 0; q = 0;
        ow = s.h[row + cx];  if (ow === me) m++; else if (ow === opp) q++;
        ow = s.h[rowN + cx]; if (ow === me) m++; else if (ow === opp) q++;
        ow = s.v[row + cx];  if (ow === me) m++; else if (ow === opp) q++;
        ow = s.v[row + nx];  if (ow === me) m++; else if (ow === opp) q++;

        if (m && q) continue;                     // 双方都碰过 → 这格谁都拿不到
        if (m === 3) sc += 1300;                  // 我一步就能成格
        else if (q === 3) sc -= 1300;             // 对手一步就能成格
        sc += m * m * 15 - q * q * 18;
      }
    }

    sc += (mine - theirs) * 1200;
    sc += lineDiff(s, me);
    sc += (s.seeds[me] - s.seeds[opp]) * 110;
    return sc;
  }

  /* 双方四连窗口分之差，一趟算完（窗口里双方都有子时对谁都没价值） */
  function lineDiff(s, me) {
    var opp = 1 - me, W = s.W, H = s.H, sc = 0;
    for (var d = 0; d < R.DIRS4.length; d++) {
      var dx = R.DIRS4[d][0], dy = R.DIRS4[d][1];
      for (var cy = 0; cy < H; cy++) {
        for (var cx = 0; cx < W; cx++) {
          var r = 0, b = 0;
          for (var t = 0; t < 4; t++) {
            var v = s.cell[R.wrapY(s, cy + t * dy) * W + R.wrapX(s, cx + t * dx)];
            if (v === me) r++; else if (v === opp) b++;
          }
          if (b === 0) sc += LINE_W[r];
          if (r === 0) sc -= LINE_W[b];
        }
      }
    }
    return sc;
  }

  /* 老接口保留：某一方的四连窗口分（调试用） */
  function lineScore(s, p) {
    var opp = 1 - p, sc = 0;
    for (var d = 0; d < R.DIRS4.length; d++) {
      var dx = R.DIRS4[d][0], dy = R.DIRS4[d][1];
      for (var cy = 0; cy < s.H; cy++) {
        for (var cx = 0; cx < s.W; cx++) {
          var mine = 0, bad = false;
          for (var t = 0; t < 4; t++) {
            var v = s.cell[R.wrapY(s, cy + t * dy) * s.W + R.wrapX(s, cx + t * dx)];
            if (v === opp) { bad = true; break; }
            if (v === p) mine++;
          }
          if (!bad) sc += LINE_W[mine];
        }
      }
    }
    return sc;
  }

  /* 角点 (x,y) 沿方向 (dx,dy) 那条臂是否为空（等价于 rules.armEdge + edgeOwner，但不分配） */
  function armFree(s, x, y, dx, dy) {
    var W = s.W, H = s.H, ex, ey;
    if (dx === 1) return s.h[y * W + x] === EMPTY;
    if (dx === -1) { ex = x - 1; if (ex < 0) ex += W; return s.h[y * W + ex] === EMPTY; }
    if (dy === 1) return s.v[y * W + x] === EMPTY;
    ey = y - 1; if (ey < 0) ey += H;
    return s.v[ey * W + x] === EMPTY;
  }

  /**
   * 起笔点的备选位置（只在还有种子时用）。
   * 思路：贴着对手最「厚」的地方往外退两格起一根 —— 既不碰线，又能就近抢边；
   * 再补中腹和两处分散的点，随手开一根远藤也有得下。
   */
  function seedSpots(s, turn) {
    var W = s.W, H = s.H, opp = 1 - turn;
    var hot = [], x, y, i;

    /* ① 对手快成格的地方：还有 ≥2 条对手的边的空格 */
    for (y = 0; y < H; y++) {
      var row = y * W, rowN = ((y + 1) % H) * W;
      for (x = 0; x < W; x++) {
        if (s.cell[row + x] !== EMPTY) continue;
        var nx = x + 1; if (nx === W) nx = 0;
        var q = 0, ow;
        ow = s.h[row + x];  if (ow === opp) q++;
        ow = s.h[rowN + x]; if (ow === opp) q++;
        ow = s.v[row + x];  if (ow === opp) q++;
        ow = s.v[row + nx]; if (ow === opp) q++;
        if (q >= 2) hot.push([x, y, q]);
      }
    }
    hot.sort(function (a, b) { return b[2] - a[2]; });

    var out = [];
    for (i = 0; i < hot.length && out.length < 8; i++) {
      out.push([hot[i][0] + 2, hot[i][1]]);
      out.push([hot[i][0] - 2, hot[i][1]]);
      out.push([hot[i][0], hot[i][1] + 2]);
      out.push([hot[i][0], hot[i][1] - 2]);
    }
    /* ② 中腹与两处分散的点 */
    out.push([W >> 1, H >> 1]);
    out.push([W >> 2, H >> 2]);
    out.push([(W * 3) >> 2, (H * 3) >> 2]);
    return out;
  }

  /**
   * 候选着法：把上千个合法着法压到几十个，且不漏掉关键着法。
   *   1. 三缺一的格子（我能成格 / 对手马上成格）—— 全部保留
   *   2. 贴着已有线段的生长点 —— 按快筛分排序，只留前 cap 个
   *   3. 起笔点 —— 只在几乎没棋可下时（开局）补几个
   */
  function candidates(s, cap) {
    var turn = s.turn, W = s.W, H = s.H;
    var pool = [], seen = {}, i, x, y, q;

    function push(m) {
      if (!m) return;
      var k = m.x * 10000 + m.y * 10 + m.q;
      if (seen[k]) return;
      seen[k] = 1;
      pool.push(m);
    }

    /* 1) 战术点：某一方三缺一的格子，它的空边就是关键边 */
    for (y = 0; y < H; y++) {
      var row = y * W, rowN = ((y + 1) % H) * W;
      for (x = 0; x < W; x++) {
        if (s.cell[row + x] !== EMPTY) continue;
        var nx = x + 1; if (nx === W) nx = 0;
        var mine = 0, theirs = 0, free = null, ow;

        ow = s.h[row + x];  if (ow === EMPTY) free = { kind: 'h', x: x, y: y }; else if (ow === turn) mine++; else theirs++;
        ow = s.h[rowN + x]; if (ow === EMPTY) free = { kind: 'h', x: x, y: (y + 1) % H }; else if (ow === turn) mine++; else theirs++;
        ow = s.v[row + x];  if (ow === EMPTY) free = { kind: 'v', x: x, y: y }; else if (ow === turn) mine++; else theirs++;
        ow = s.v[row + nx]; if (ow === EMPTY) free = { kind: 'v', x: nx, y: y }; else if (ow === turn) mine++; else theirs++;

        if (!free || (mine !== 3 && theirs !== 3)) continue;
        var sh = shapesWithEdge(s, free);
        for (i = 0; i < sh.length; i++) push(R.validateMove(s, sh[i].x, sh[i].y, sh[i].q));
      }
    }

    /* 2) 生长点：贴着任何已有线段（对手的也算 —— 贴上去才抢得到边） */
    var grow = [];
    for (y = 0; y < H && grow.length < POOL_MAX; y++) {
      var r = y * W, rU = ((y - 1 + H) % H) * W;
      for (x = 0; x < W && grow.length < POOL_MAX; x++) {
        var xl = x - 1; if (xl < 0) xl = W - 1;
        var touch = s.h[r + x] !== EMPTY || s.h[r + xl] !== EMPTY ||
                    s.v[r + x] !== EMPTY || s.v[rU + x] !== EMPTY;
        if (!touch) continue;
        for (q = 0; q < 4; q++) {
          /* 先用「两条臂是否为空」把大部分方向筛掉 —— validateMove 会分配一堆对象，
             在格点上逐个调用它正是这里最贵的一步。 */
          var arms = R.ORIENTATIONS[q].arms;
          if (!armFree(s, x, y, arms[0][0], arms[0][1])) continue;
          if (!armFree(s, x, y, arms[1][0], arms[1][1])) continue;
          var g = R.validateMove(s, x, y, q);
          if (g) grow.push(g);
        }
      }
    }
    for (i = 0; i < grow.length; i++) grow[i]._q = quickScore(s, grow[i], turn);
    grow.sort(function (a, b) { return b._q - a._q; });
    for (i = 0; i < grow.length && i < cap; i++) push(grow[i]);

    /* 3) 起笔点：只要还有种子就摆上几个候选 —— 值不值得花这一枚，交给搜索判断。
       只在候选较宽的层（根节点）加，免得搜索里分叉过多。 */
    if (s.seeds[turn] > 0 && cap >= 12) {
      var spots = seedSpots(s, turn), got = 0;
      for (i = 0; i < spots.length && got < SEED_CAND; i++) {
        var sx0 = R.wrapX(s, spots[i][0]), sy0 = R.wrapY(s, spots[i][1]);
        for (q = 0; q < 4 && got < SEED_CAND; q++) {
          var sm = R.validateMove(s, sx0, sy0, q);
          if (sm && sm.isSeed) { push(sm); got++; }
        }
      }
    }

    /* 战术点还没打过分，这里补齐（顺便挂上威胁标记） */
    for (i = 0; i < pool.length; i++) if (pool[i]._q === undefined) quickScore(s, pool[i], turn);

    return pool;
  }

  /* 负极大值 + α-β 剪枝；返回「轮到走的那一方」的分数。
     造出「三缺一」的逼着会多看一层 —— 但只在「这一层本来要被截断」时才延伸，
     且整条线只延伸一次。否则棋盘上到处是逼着，搜索会直接炸开。 */
  var EXT_MAX = 1;

  var budget = 0;                     // 每个根着法的节点预算，兜底防炸

  function nega(s, depth, alpha, beta, cap, ext) {
    if (s.winner != null) return (s.winner === s.turn) ? (WIN + depth * 10) : 0;
    if (depth <= 0 || budget <= 0) return evaluate(s, s.turn);
    budget--;

    var cands = candidates(s, cap);
    if (!cands.length) return 0;                       // 无棋可走 → 和棋

    var mover = s.turn;
    var best = -Infinity;
    for (var i = 0; i < cands.length; i++) {
      var m = cands[i];
      var next = R.cloneState(s);
      R.applyMove(next, m, { skipDraw: true });

      var push = (ext > 0 && depth === 1 && m._t) ? 1 : 0;
      var v;
      if (next.winner === mover) v = WIN + depth * 10;
      else if (next.winner === 'draw') v = 0;
      else v = -nega(next, depth - 1 + push, -beta, -alpha, cap, ext - push);

      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
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

    /* The default opponent is deliberately shallow and explainable.  The
       old alpha-beta tree made seed usage unpredictable and was expensive
       on larger toroidal boards. */
    var allMoves = R.legalMoves(s);
    if (!allMoves.length) return null;

    var safe = [];
    for (var si = 0; si < allMoves.length; si++) {
      var probe = R.cloneState(s);
      R.applyMove(probe, allMoves[si], { skipDraw: true });
      if (!winningMoves(probe).length) safe.push(allMoves[si]);
    }
    var pool = safe.length ? safe : allMoves;
    var best = -Infinity, ties = [];
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
      if (score > best) { best = score; ties = [move]; }
      else if (score === best) ties.push(move);
    }
    return ties[Math.floor(rnd() * ties.length)];

  }

  return {
    chooseAIMove: chooseAIMove,
    evaluate: evaluate,
    lineScore: lineScore,
    winningMoves: winningMoves,
    quickScore: quickScore,
    candidates: candidates
  };
});
