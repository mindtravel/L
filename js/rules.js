/*!
 * 直角 · 规则内核 (Vine Lattice)
 * ------------------------------------------------------------------
 * 方格纸上的双人对弈：折角成线，围合成格，连成四格者胜。
 *
 * 棋盘首尾相连（环面 / torus）：坐标全部对 W、H 取模，
 * 左边缘接右边缘、上边缘接下边缘，没有边界，每个格点都恰好有 4 条边。
 *
 * 坐标约定：x 向右、y 向下（屏幕坐标），索引一律取模。
 *   格点 vertex   : (x, y)，x ∈ [0, W)，y ∈ [0, H)
 *   横线段 h(x,y) : (x,y) → (x+1 mod W, y)，x ∈ [0, W)，y ∈ [0, H)
 *   竖线段 v(x,y) : (x,y) → (x, y+1 mod H)，x ∈ [0, W)，y ∈ [0, H)
 *   方格 cell(cx,cy) : 由 h(cx,cy)、h(cx,cy+1)、v(cx,cy)、v(cx+1,cy) 围成（均取模）
 *
 * 纯逻辑、零依赖：浏览器挂到 window.ZJ.rules，Node 里 require 使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); return; }
  root.ZJ = root.ZJ || {};
  root.ZJ.rules = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var EMPTY = -1, RED = 0, BLUE = 1, DRAW = 'draw';

  /* 一步「折角」= 从角点伸出两条互相垂直、长度为 1 的线段。
     四个象限按鼠标方位命名：NE = 右上，SE = 右下，SW = 左下，NW = 左上。 */
  var ORIENTATIONS = [
    { key: 'NE', label: '上·右', arrow: '↗', arms: [[0, -1], [1, 0]] },
    { key: 'SE', label: '右·下', arrow: '↘', arms: [[1, 0], [0, 1]] },
    { key: 'SW', label: '下·左', arrow: '↙', arms: [[0, 1], [-1, 0]] },
    { key: 'NW', label: '左·上', arrow: '↖', arms: [[-1, 0], [0, -1]] }
  ];

  /* 连格四方向：横、竖、两条斜线 */
  var DIRS4 = [[1, 0], [0, 1], [1, 1], [1, -1]];

  /* ------------------------------------------------------------------ */
  /* 建局 / 克隆                                                         */
  /* ------------------------------------------------------------------ */

  function createGame(W, H, seedsPerPlayer) {
    W = W || 9; H = H || 9;
    var seeds = (seedsPerPlayer == null) ? 3 : seedsPerPlayer;
    return {
      W: W, H: H, seedsPerPlayer: seeds,
      torus: true,                                 // 首尾相连
      h: new Int8Array(W * H).fill(EMPTY),         // 横线段归属
      v: new Int8Array(W * H).fill(EMPTY),         // 竖线段归属
      cell: new Int8Array(W * H).fill(EMPTY),      // 方格归属
      seeds: [seeds, seeds],                       // 剩余起笔
      seedMarks: [],                               // 每次起笔的起点位置（渲染用）
      turn: RED,
      moveCount: 0,
      lastMove: null,
      winner: null,                                // null | RED | BLUE | 'draw'
      winLine: null                                // 获胜的 4 个格子
    };
  }

  function cloneState(s) {
    return {
      W: s.W, H: s.H, seedsPerPlayer: s.seedsPerPlayer,
      h: s.h.slice(), v: s.v.slice(), cell: s.cell.slice(),
      seeds: s.seeds.slice(), seedMarks: s.seedMarks.slice(),
      turn: s.turn, moveCount: s.moveCount,
      lastMove: s.lastMove, winner: s.winner, winLine: s.winLine
    };
  }

  function hydrateState(data) {
    var s = createGame(data.W, data.H, data.seedsPerPlayer == null ? 3 : data.seedsPerPlayer);
    if (data.h) s.h.set(data.h); if (data.v) s.v.set(data.v); if (data.cell) s.cell.set(data.cell);
    s.seeds = (data.seeds || s.seeds).slice(); s.seedMarks = (data.seedMarks || []).slice();
    s.turn = data.turn; s.moveCount = data.moveCount || 0; s.lastMove = data.lastMove || null;
    s.winner = data.winner == null ? null : data.winner; s.winLine = data.winLine || null;
    s.version = data.version == null ? 0 : data.version;
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* 线段与格点的基础读写                                                */
  /* ------------------------------------------------------------------ */

  /* 环面上所有的线段/方格都按 y * W + x 存放 */
  function hIdx(s, x, y) { return y * s.W + x; }
  function vIdx(s, x, y) { return y * s.W + x; }
  function cIdx(s, cx, cy) { return cy * s.W + cx; }

  /* 取模，保证结果非负 */
  function mod(a, n) { return ((a % n) + n) % n; }
  function wrapX(s, x) { return mod(x, s.W); }
  function wrapY(s, y) { return mod(y, s.H); }

  function edgeValid(s, e) {
    return e.x >= 0 && e.x < s.W && e.y >= 0 && e.y < s.H;
  }

  function edgeOwner(s, e) {
    return e.kind === 'h' ? s.h[hIdx(s, e.x, e.y)] : s.v[vIdx(s, e.x, e.y)];
  }

  function setEdgeOwner(s, e, p) {
    if (e.kind === 'h') s.h[hIdx(s, e.x, e.y)] = p;
    else s.v[vIdx(s, e.x, e.y)] = p;
  }

  /* 从角点 (x,y)（已归一）沿方向 (dx,dy) 走一格所对应的线段 */
  function armEdge(s, x, y, dx, dy) {
    if (dx === 1) return { kind: 'h', x: x, y: y };
    if (dx === -1) return { kind: 'h', x: wrapX(s, x - 1), y: y };
    if (dy === 1) return { kind: 'v', x: x, y: y };
    return { kind: 'v', x: x, y: wrapY(s, y - 1) };
  }

  /* 环面上每个格点都恰好有 4 条线段 */
  function vertexEdges(s, x, y) {
    return [
      { kind: 'h', x: x, y: y },
      { kind: 'h', x: wrapX(s, x - 1), y: y },
      { kind: 'v', x: x, y: y },
      { kind: 'v', x: x, y: wrapY(s, y - 1) }
    ];
  }

  function vertexTouches(s, x, y, p) {
    var es = vertexEdges(s, x, y);
    for (var i = 0; i < es.length; i++) if (edgeOwner(s, es[i]) === p) return true;
    return false;
  }

  function vertexTouchesAny(s, x, y) {
    var es = vertexEdges(s, x, y);
    for (var i = 0; i < es.length; i++) if (edgeOwner(s, es[i]) !== EMPTY) return true;
    return false;
  }

  /* A corner may start a new connected component only when none of its
     three vertices touches any existing edge.  Keeping this policy in one
     helper prevents the move validator and AI simulations from drifting. */
  function canStartSeed(s, verts) {
    if (s.seeds[s.turn] <= 0) return false;
    for (var i = 0; i < verts.length; i++) {
      if (vertexTouchesAny(s, verts[i][0], verts[i][1])) return false;
    }
    return true;
  }

  /* 某条线段两侧的方格（环面上永远两侧都有） */
  function cellsOfEdge(s, e) {
    if (e.kind === 'h') return [[e.x, e.y], [e.x, wrapY(s, e.y - 1)]];
    return [[e.x, e.y], [wrapX(s, e.x - 1), e.y]];
  }

  function cellComplete(s, cx, cy, p) {
    return edgeOwner(s, { kind: 'h', x: cx, y: cy }) === p &&
           edgeOwner(s, { kind: 'h', x: cx, y: wrapY(s, cy + 1) }) === p &&
           edgeOwner(s, { kind: 'v', x: cx, y: cy }) === p &&
           edgeOwner(s, { kind: 'v', x: wrapX(s, cx + 1), y: cy }) === p;
  }

  /* ------------------------------------------------------------------ */
  /* 合法性                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * 校验一步「折角」。
   * @returns {null|{x,y,q,isSeed,edges,verts}}
   *   isSeed = true 表示这一步与所有已有棋子都不相接，需要消耗 1 枚起笔。
   */
  function validateMove(s, x, y, q) {
    if (s.winner != null) return null;
    if (!(x >= 0 && x < s.W && y >= 0 && y < s.H)) return null;   // 角点请先归一到 [0,W)×[0,H)
    var ori = ORIENTATIONS[q];
    if (!ori) return null;

    var edges = [], verts = [[x, y]], i;
    for (i = 0; i < ori.arms.length; i++) {
      var dx = ori.arms[i][0], dy = ori.arms[i][1];
      var e = armEdge(s, x, y, dx, dy);
      if (!edgeValid(s, e)) return null;
      if (edgeOwner(s, e) !== EMPTY) return null;      // 不许与已有棋子重叠
      edges.push(e);
      verts.push([wrapX(s, x + dx), wrapY(s, y + dy)]);
    }

    var grow = false, touchAny = false;
    for (i = 0; i < verts.length; i++) {
      if (vertexTouches(s, verts[i][0], verts[i][1], s.turn)) grow = true;
      if (vertexTouchesAny(s, verts[i][0], verts[i][1])) touchAny = true;
    }

    if (grow) return { x: x, y: y, q: q, isSeed: false, edges: edges, verts: verts };   // 续线
    if (!touchAny && canStartSeed(s, verts)) {
      return { x: x, y: y, q: q, isSeed: true, edges: edges, verts: verts };            // 起笔
    }
    return null;
  }

  function legalMoves(s) {
    var out = [];
    if (s.winner != null) return out;
    for (var y = 0; y < s.H; y++) {
      for (var x = 0; x < s.W; x++) {
        for (var q = 0; q < 4; q++) {
          var m = validateMove(s, x, y, q);
          if (m) out.push(m);
        }
      }
    }
    return out;
  }

  /* UI-facing explanation for the one invalid move that needs actionable
     feedback.  The validator remains the authority; this never changes
     legality or state. */
  function moveError(s, x, y, q) {
    if (validateMove(s, x, y, q) || s.winner != null) return null;
    var ori = ORIENTATIONS[q];
    if (!ori || x < 0 || x >= s.W || y < 0 || y >= s.H) return 'invalid';
    var verts = [[x, y]], edges = [];
    for (var i = 0; i < ori.arms.length; i++) {
      var a = ori.arms[i], e = armEdge(s, x, y, a[0], a[1]);
      if (edgeOwner(s, e) !== EMPTY) return 'occupied';
      edges.push(e);
      verts.push([wrapX(s, x + a[0]), wrapY(s, y + a[1])]);
    }
    var grows = false, touches = false;
    for (i = 0; i < verts.length; i++) {
      grows = grows || vertexTouches(s, verts[i][0], verts[i][1], s.turn);
      touches = touches || vertexTouchesAny(s, verts[i][0], verts[i][1]);
    }
    if (!grows && !touches && s.seeds[s.turn] <= 0) return 'seed-exhausted';
    return 'invalid';
  }

  /* ------------------------------------------------------------------ */
  /* 胜负                                                                */
  /* ------------------------------------------------------------------ */

  /* 在 cells（新占的格子）周围寻找一条 4 连；cells 为空则全盘扫描 */
  function findWinLine(s, p, cells) {
    var list = cells;
    if (!list || !list.length) {
      list = [];
      for (var cy = 0; cy < s.H; cy++)
        for (var cx = 0; cx < s.W; cx++) list.push([cx, cy]);
    }
    for (var i = 0; i < list.length; i++) {
      var cx = list[i][0], cy = list[i][1];
      for (var d = 0; d < DIRS4.length; d++) {
        var dx = DIRS4[d][0], dy = DIRS4[d][1];
        for (var k = 0; k < 4; k++) {
          /* 环面上绕回来时可能重复，必须凑够 4 个「不同」的格子 */
          var line = [], ok = true, seen = {};
          for (var t = 0; t < 4; t++) {
            var x = wrapX(s, cx - k * dx + t * dx), y = wrapY(s, cy - k * dy + t * dy);
            var key = x + ',' + y;
            if (seen[key] || s.cell[cIdx(s, x, y)] !== p) { ok = false; break; }
            seen[key] = 1;
            line.push([x, y]);
          }
          if (ok) return line;
        }
      }
    }
    return null;
  }

  function countCells(s, p) {
    var n = 0;
    for (var i = 0; i < s.cell.length; i++) if (s.cell[i] === p) n++;
    return n;
  }

  function candidateCells(s, edges) {
    var seen = {}, out = [];
    for (var i = 0; i < edges.length; i++) {
      var adjacent = cellsOfEdge(s, edges[i]);
      for (var j = 0; j < adjacent.length; j++) {
        var cell = adjacent[j], key = cIdx(s, cell[0], cell[1]);
        if (!seen[key]) { seen[key] = true; out.push(cell); }
      }
    }
    return out;
  }

  function claimCells(s, candidates, player) {
    var claimed = [];
    for (var i = 0; i < candidates.length; i++) {
      var cx = candidates[i][0], cy = candidates[i][1];
      if (s.cell[cIdx(s, cx, cy)] !== EMPTY) continue;
      if (cellComplete(s, cx, cy, player)) {
        s.cell[cIdx(s, cx, cy)] = player;
        claimed.push([cx, cy]);
      }
    }
    return claimed;
  }

  /* ------------------------------------------------------------------ */
  /* 行棋                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 落一步。原地修改 state。
   * opts.skipDraw = true 时跳过「和棋」检测（供 AI 快速模拟使用）。
   */
  function applyMove(s, move, opts) {
    if (!move || s.winner != null) return null;
    var m = validateMove(s, move.x, move.y, move.q);
    if (!m) return null;

    var p = s.turn;
    for (var i = 0; i < m.edges.length; i++) setEdgeOwner(s, m.edges[i], p);
    if (m.isSeed) {
      s.seeds[p] -= 1;
      s.seedMarks.push({ x: m.x, y: m.y, p: p });
    }

    /* Only the two new edges can complete adjacent cells. */
    var claimed = claimCells(s, candidateCells(s, m.edges), p);

    s.moveCount += 1;
    s.lastMove = {
      x: m.x, y: m.y, q: m.q, isSeed: m.isSeed,
      player: p, edges: m.edges, claimed: claimed
    };

    var line = claimed.length ? findWinLine(s, p, claimed) : null;
    if (line) {
      s.winner = p; s.winLine = line;
    } else {
      /* 换手，然后检查「轮到的人还有没有折角可下」，没有则和棋 */
      s.turn = 1 - p;
      if (!(opts && opts.skipDraw) && legalMoves(s).length === 0) s.winner = DRAW;
    }

    return s.lastMove;
  }

  function playerName(p) { return p === RED ? '黑' : (p === BLUE ? '白' : '—'); }

  return {
    EMPTY: EMPTY, RED: RED, BLUE: BLUE, DRAW: DRAW,
    ORIENTATIONS: ORIENTATIONS, DIRS4: DIRS4,
    createGame: createGame, cloneState: cloneState, hydrateState: hydrateState,
    validateMove: validateMove, moveError: moveError, legalMoves: legalMoves, applyMove: applyMove,
    edgeValid: edgeValid, edgeOwner: edgeOwner, setEdgeOwner: setEdgeOwner,
    armEdge: armEdge, vertexEdges: vertexEdges,
    vertexTouches: vertexTouches, vertexTouchesAny: vertexTouchesAny,
    cellsOfEdge: cellsOfEdge, cellComplete: cellComplete,
    findWinLine: findWinLine, countCells: countCells,
    hIdx: hIdx, vIdx: vIdx, cIdx: cIdx, playerName: playerName,
    mod: mod, wrapX: wrapX, wrapY: wrapY
  };
});
