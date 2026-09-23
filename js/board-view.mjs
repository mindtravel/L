/* =====================================================================
 * 直角 · 棋盘
 * ---------------------------------------------------------------------
 * 这一块管三件事：
 *   1. 几何：格宽、坐标换算、环形（首尾相接）的取模与环绕副本
 *   2. 渲染：把局面画成黑白线条图
 *   3. 视图状态：观察原点（拖棋盘）、选中哪个格点、鼠标在哪、要不要重画
 *
 * 只读注入的 game 局面，不改它。
 *
 * 关于「观察原点」：环面上没有真正的边角，接缝落在哪一格只是观察方式。
 * 拖动棋盘就是把原点挪一格，于是接缝跟着挪 —— 局面本身一动不动。
 * ===================================================================== */
export function createBoard({ game, util: U, theme: T, rules: R, effects: fxSystem, scheduler, documentRef = globalThis.document, windowRef = globalThis }) {

  var canvas = null, ctx = null, wrapEl = null;

  var cell = 46, pad = 26;          // 格宽 / 边距（含环绕预览那一圈）

  /* 观察原点：逻辑坐标 − 原点 = 视觉坐标。由下面两根滚动轴控制 */
  var viewX = 0, viewY = 0;

  /* 视图状态 */
  var selected = null, hover = null, hoverQ = -1, mouse = null;

  /* 渲染调度：只有「有事发生」时才重画，闲时完全静止 */
  var dirty = true, wakeUntil = 0;

  /* ------------------------------------------------------------------ */
  /* 几何                                                                */
  /* ------------------------------------------------------------------ */

  function px(vx) { return pad + vx * cell; }           // 参数是「视觉」格坐标
  function py(vy) { return pad + vy * cell; }
  function LX(lx) { return lx - viewX; }                // 逻辑 → 视觉
  function LY(ly) { return ly - viewY; }
  function vkey(v) { return v.x + ',' + v.y; }

  function init() {
    canvas = documentRef.getElementById('board');
    wrapEl = documentRef.getElementById('boardwrap');
    ctx = canvas.getContext('2d');
  }

  function layout() {
    var state = game.state();
    var avail = wrapEl.clientWidth || 520;
    var maxPx = Math.max(300, Math.min(avail, 680));
    var base = 20;                                   // 盘面外还要留的空白
    cell = Math.floor((maxPx - base * 2) / (Math.max(state.W, state.H) + T.wrap * 2));
    cell = Math.max(16, Math.min(56, cell));
    pad = base + Math.round(cell * T.wrap);

    var cw = state.W * cell + pad * 2, ch = state.H * cell + pad * 2;
    var dpr = windowRef.devicePixelRatio || 1;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    viewX = R.wrapX(state, viewX);
    viewY = R.wrapY(state, viewY);
    invalidate();
  }

  /* 把一份内容同时画在主盘和它首尾相接过来的位置上（淡一点，一眼看出是接过来的）。
     参数是「视觉」坐标的包围盒，可以落在 [0, W] 之外的环绕区。 */
  function eachWrap(state, vminX, vminY, vmaxX, vmaxY, fn) {
    var W = state.W, H = state.H;
    var xs = [0], ys = [0];
    if (vminX < T.wrap) xs.push(W);
    if (vmaxX > W - T.wrap) xs.push(-W);
    if (vminY < T.wrap) ys.push(H);
    if (vmaxY > H - T.wrap) ys.push(-H);
    for (var i = 0; i < xs.length; i++) {
      for (var j = 0; j < ys.length; j++) {
        var secondary = (xs[i] !== 0 || ys[j] !== 0);
        ctx.save();
        if (secondary) ctx.globalAlpha = T.wrapAlpha;
        ctx.translate(xs[i] * cell, ys[j] * cell);
        fn(secondary);
        ctx.restore();
      }
    }
  }

  /* 一条线段（起点→终点）映射成规则内核里的规范坐标键 */
  function edgeKey(sx, sy, ex, ey) {
    return (sy === ey)
      ? 'h:' + Math.min(sx, ex) + ',' + sy
      : 'v:' + sx + ',' + Math.min(sy, ey);
  }

  /* ------------------------------------------------------------------ */
  /* 重画调度                                                            */
  /* ------------------------------------------------------------------ */

  function invalidate(ms) {
    dirty = true;
    wakeUntil = U.now() + (ms || T.dur.wake);
    /* Rendering is demand-driven.  The game loop is woken only when a
       state/input change actually needs a frame. */
    if (scheduler) scheduler.wake();
  }

  function markViewDirty() {
    dirty = true;
    if (scheduler) scheduler.wake();
  }

  function needsFrame(t) {
    /* Selected/hovered vertices animate their dashed affordances, so they
       remain a live render source until the pointer state is cleared. */
    return dirty || !!selected || !!hover || fxSystem.alive() ||
      t < wakeUntil || t < fxSystem.winPulseUntil;
  }

  /* ------------------------------------------------------------------ */
  /* 换接缝：把观察原点挪到别处（由两根滚动轴驱动）                      */
  /* ------------------------------------------------------------------ */

  function setView(x, y) {
    var state = game.state();
    if (!state) return;
    viewX = R.wrapX(state, x);
    viewY = R.wrapY(state, y);
    invalidate();
  }

  function resetView() {
    viewX = viewY = 0;
    invalidate();
  }

  /* ------------------------------------------------------------------ */
  /* 渲染                                                                */
  /* ------------------------------------------------------------------ */

  function draw(t) {
    var state = game.state();
    if (!state) return;
    dirty = false;                    // 画完就算「干净」了

    var W = state.W, H = state.H;
    var cw = W * cell + pad * 2, ch = H * cell + pad * 2;

    /* 每帧索引：正在折出来的线段（grow）、其远端节点（growFar，用于淡入） */
    var grow = {}, growFar = {};
    for (var i = 0; i < fxSystem.list.length; i++) {
      var e = fxSystem.list[i];
      var eu = fxSystem.u(e, t);
      if (eu < 0 || e.k !== 'edge') continue;
      grow[edgeKey(e.sx, e.sy, e.ex, e.ey)] = e;
      if (eu < 1) {
        var fk = e.ex + ',' + e.ey;
        growFar[fk] = (fk in growFar) ? Math.min(growFar[fk], eu) : eu;
      }
    }

    /* --- 纸 --- */
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, cw, ch);

    /* --- 格线：本身是周期性的，直接按视觉坐标画，两侧各多画一格盖住拖动时的缝 --- */
    var x, y, vx, vy;
    var majorX = function (v) { return (((v + viewX) % 3) + 3) % 3 === 0; };
    var majorY = function (v) { return (((v + viewY) % 3) + 3) % 3 === 0; };

    ctx.lineWidth = 1;
    ctx.strokeStyle = T.gridMinor;
    ctx.beginPath();
    for (vx = -1; vx <= W + 1; vx++) {
      if (majorX(vx)) continue;
      ctx.moveTo(px(vx) + .5, py(-1)); ctx.lineTo(px(vx) + .5, py(H + 1));
    }
    for (vy = -1; vy <= H + 1; vy++) {
      if (majorY(vy)) continue;
      ctx.moveTo(px(-1), py(vy) + .5); ctx.lineTo(px(W + 1), py(vy) + .5);
    }
    ctx.stroke();

    ctx.strokeStyle = T.gridMajor;
    ctx.beginPath();
    for (vx = -1; vx <= W + 1; vx++) {
      if (!majorX(vx)) continue;
      ctx.moveTo(px(vx) + .5, py(-1)); ctx.lineTo(px(vx) + .5, py(H + 1));
    }
    for (vy = -1; vy <= H + 1; vy++) {
      if (!majorY(vy)) continue;
      ctx.moveTo(px(-1), py(vy) + .5); ctx.lineTo(px(W + 1), py(vy) + .5);
    }
    ctx.stroke();

    /* --- 格点小十字：可落子的点画深画长，但只画在鼠标附近 ---
       大棋盘上可落子的点有上千个，全画出来就是一片糊；
       跟着鼠标走既能看清该往哪落，又不吵。 */
    var armMinor = Math.max(1.8, cell * 0.046);
    var armHot = Math.max(2.8, cell * 0.082);
    var showHints = game.cfg.hints && game.isHumanTurn() && mouse;
    var hintR2 = (cell * 2.8) * (cell * 2.8);
    var legal = game.legalCorners();
    ctx.lineWidth = 1;

    ctx.strokeStyle = T.cross;
    ctx.beginPath();
    for (vx = -1; vx <= W + 1; vx++) {
      for (vy = -1; vy <= H + 1; vy++) cross(px(vx), py(vy), armMinor);
    }
    ctx.stroke();

    if (showHints) {
      ctx.strokeStyle = T.crossHot;
      ctx.beginPath();
      for (vx = -1; vx <= W + 1; vx++) {
        var hx = px(vx), dx2 = hx - mouse.x;
        dx2 *= dx2;
        if (dx2 > hintR2) continue;
        for (vy = -1; vy <= H + 1; vy++) {
          var hy = py(vy), dy2 = hy - mouse.y;
          if (dx2 + dy2 * dy2 > hintR2) continue;
          if (!legal.has(R.wrapX(state, vx + viewX) + ',' + R.wrapY(state, vy + viewY))) continue;
          cross(hx, hy, armHot);
        }
      }
      ctx.stroke();
    }

    /* --- 棋盘外框：固定不动，它就是观察窗口 --- */
    ctx.lineWidth = 1;
    ctx.strokeStyle = T.ink;
    ctx.strokeRect(px(0) + .5, py(0) + .5, W * cell - 1, H * cell - 1);

    /* --- 线段与格点 ---
       白方分三遍画：先把所有黑描边铺满 → 再画黑方 → 最后统一铺白芯。
       这样黑只会留在整块的轮廓上：拐弯、分叉、交叉处的内部黑边会被白芯盖掉。 */
    var nodes = {};                     // "x,y" → {b, w}：黑白各自在这点上有几条边
    var mark = function (nx, ny, p) {
      var k = nx + ',' + ny;
      var o = nodes[k] || (nodes[k] = { b: 0, w: 0 });
      if (p === R.RED) o.b++; else o.w++;
    };
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var hp = state.h[y * W + x];
        if (hp === R.EMPTY) continue;
        mark(x, y, hp); mark((x + 1) % W, y, hp);
      }
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var vp = state.v[y * W + x];
        if (vp === R.EMPTY) continue;
        mark(x, y, vp); mark(x, (y + 1) % H, vp);
      }
    }

    drawSegments(state, nodes, grow, t, R.BLUE, 'casing');
    drawNodes(state, nodes, growFar, R.BLUE, 'casing');
    drawSegments(state, nodes, grow, t, R.RED, 'solid');
    drawNodes(state, nodes, growFar, R.RED, 'solid');
    drawSegments(state, nodes, grow, t, R.BLUE, 'core');
    drawNodes(state, nodes, growFar, R.BLUE, 'core');

    /* --- 已经成格的格子：画在棋子之后 ---
       填充盖住棋子靠内的那一半，于是黑只留在整块的外轮廓上。
       白方成格因此是「实心白 + 一圈黑框」，内圈不再多一道黑边。 */
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var owner2 = state.cell[y * W + x];
        if (owner2 === R.EMPTY) continue;
        (function (lx, ly, o) {
          var ax = LX(lx), ay = LY(ly);
          eachWrap(state, ax, ay, ax + 1, ay + 1, function () { drawCell(px(ax), py(ay), o); });
        })(x, y, owner2);
      }
    }

    /* --- 起笔留下的起点 --- */
    for (i = 0; i < state.seedMarks.length; i++) {
      (function (mx, my) {
        var ax = LX(mx), ay = LY(my);
        eachWrap(state, ax - 0.2, ay - 0.2, ax + 0.2, ay + 0.2, function () {
          drawSeedMark(px(ax), py(ay), state.seedMarks[i].p);
        });
      })(state.seedMarks[i].x, state.seedMarks[i].y);
    }

    /* --- 选中格点 / 悬停 --- */
    if (selected) {
      drawSelection(state, selected, t);
    } else if (hover) {
      var ok = legal.has(vkey(hover));
      var pul = 0.5 + 0.5 * Math.sin(t / 420);
      var hr = cell * (ok ? 0.13 + 0.02 * pul : 0.11);
      var hx2 = px(LX(hover.x)), hy2 = py(LY(hover.y));
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = ok ? T.inkOf(state.turn, 0.45 + 0.4 * pul) : 'rgba(150,150,150,.55)';
      ctx.strokeRect(hx2 - hr, hy2 - hr, hr * 2, hr * 2);
    }

    /* --- 终局四连：四格逐个亮起（不画连线，接缝上才不会拉出一条假线） --- */
    if (state.winLine && t < fxSystem.winPulseUntil) {
      var pulse = 0.55 + 0.45 * Math.sin(t / 300);
      for (var wi = 0; wi < state.winLine.length; wi++) {
        wrapWinMark(state, state.winLine[wi][0], state.winLine[wi][1], state.winner, pulse);
      }
    }

    /* --- 特效层 --- */
    drawEffects(state, t);
  }

  /* 往当前路径上添一个小十字 */
  function cross(cx0, cy0, a) {
    ctx.moveTo(cx0 - a, cy0 + .5); ctx.lineTo(cx0 + a, cy0 + .5);
    ctx.moveTo(cx0 + .5, cy0 - a); ctx.lineTo(cx0 + .5, cy0 + a);
  }

  function isLast(x, y, kind, t) {
    var lm = game.state().lastMove;
    if (!lm) return false;
    if (t - game.lastMoveAt() > T.dur.lastMove) return false;
    for (var i = 0; i < lm.edges.length; i++) {
      var e = lm.edges[i];
      if (e.kind === kind && e.x === x && e.y === y) return true;
    }
    return false;
  }

  /* ---- 棋子 ---- */

  /* 一条线段，三种画法：
       solid  黑方：纯黑实心
       casing 白方轮廓：更粗的黑
       core   白方内芯：白
     线端一律方头，拐弯靠格点方块补成直角。 */
  function strokeSeg(x1, y1, x2, y2, p, halo, u, mode) {
    if (u != null && u < 1) { x2 = x1 + (x2 - x1) * u; y2 = y1 + (y2 - y1) * u; }

    var w = cell * 0.16;
    var ring = Math.max(1.8, cell * 0.05);
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    if (halo) {                       // 刚落下的那一步：淡淡一圈光晕
      ctx.strokeStyle = 'rgba(17,17,17,.09)';
      ctx.lineWidth = w + cell * 0.13;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    if (mode === 'core') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = w;
    } else {
      ctx.strokeStyle = T.ink;
      ctx.lineWidth = (mode === 'casing') ? w + ring * 2 : w;
    }
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  /* 按「属于哪一方」遍历全部线段；正在折出来的线段也在这里画，终点按动画进度收短。
     白芯在「自由端点」（该方在这点上只有这一条边）要往回收一个描边宽度，
     好让黑描边在端点处合拢 —— 否则两条黑壁到端点就断了，轮廓是敞口的。 */
  function drawSegments(state, nodes, grow, t, want, mode) {
    var W = state.W, H = state.H;
    var halo = (mode !== 'core');
    var cap = (mode === 'core') ? Math.max(1.8, cell * 0.05) : 0;

    var isFree = function (lx, ly) {
      var n = nodes[lx + ',' + ly];
      return !!(n && n.w === 1);
    };

    var one = function (kind, ex, ey) {
      var u = 1, sx = ex, sy = ey;
      var fx = ex + (kind === 'h' ? 1 : 0), fy = ey + (kind === 'h' ? 0 : 1);
      var eff = grow[kind + ':' + ex + ',' + ey];
      if (eff) {
        sx = eff.sx; sy = eff.sy; fx = eff.ex; fy = eff.ey;
        u = U.clamp01(fxSystem.u(eff, t));
      }
      /* Animation endpoints are sometimes stored as the unwrapped far
         vertex (W or -1).  Keep the segment local before applying the
         torus copies; otherwise an edge crossing the seam can interpolate
         through the entire board. */
      if (kind === 'h' && Math.abs(fx - sx) > 1.5) fx = sx + (fx > sx ? 1 : -1);
      if (kind === 'v' && Math.abs(fy - sy) > 1.5) fy = sy + (fy > sy ? 1 : -1);
      var ax = LX(ex), ay = LY(ey);
      var box = (kind === 'h') ? [ax, ay, ax + 1, ay] : [ax, ay, ax, ay + 1];
      eachWrap(state, box[0], box[1], box[2], box[3], function () {
        var x1 = px(LX(sx)), y1 = py(LY(sy)), x2 = px(LX(fx)), y2 = py(LY(fy));
        var e = U.easeOut(u);
        if (e < 1) { x2 = x1 + (x2 - x1) * e; y2 = y1 + (y2 - y1) * e; }

        if (cap) {
          var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
          if (len <= cap * 2.2) return;              // 太短就不收回，免得反向画
          var ux = dx / len, uy = dy / len;
          if (isFree(sx, sy)) { x1 += ux * cap; y1 += uy * cap; }
          if (u >= 1 && isFree(fx, fy)) { x2 -= ux * cap; y2 -= uy * cap; }
        }
        strokeSeg(x1, y1, x2, y2, want, halo && isLast(ex, ey, kind, t), null, mode);
      });
    };

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (state.h[y * W + x] === want) one('h', x, y);
      }
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (state.v[y * W + x] === want) one('v', x, y);
      }
    }
  }

  /* 格点：只给「拐弯 / 分叉」的点补方块，把接缝收成直角；
     自由的端点不补（补了会凸出去一小块），靠上面的白芯回收来封口。 */
  function drawNodes(state, nodes, fade, want, mode) {
    var bit = (want === R.RED) ? 'b' : 'w';
    ctx.save();
    for (var k in nodes) {
      var o = nodes[k];
      if (!o[bit] || o[bit] < 2) continue;
      var xy = k.split(','), ax = LX(+xy[0]), ay = LY(+xy[1]);
      ctx.globalAlpha = (k in fade) ? U.clamp01(fade[k]) : 1;
      nodeSquare(px(ax), py(ay), want, mode);
      eachWrap(state, ax, ay, ax, ay, function (secondary) {
        if (secondary) nodeSquare(px(ax), py(ay), want, mode);
      });
    }
    ctx.restore();
  }

  function nodeSquare(x, y, p, mode) {
    var w = cell * 0.16;
    var ring = Math.max(1.8, cell * 0.05);
    if (p === R.RED) {
      ctx.fillStyle = T.ink;
      ctx.fillRect(x - w / 2, y - w / 2, w, w);
    } else if (mode === 'casing') {
      ctx.fillStyle = T.ink;
      ctx.fillRect(x - w / 2 - ring, y - w / 2 - ring, w + ring * 2, w + ring * 2);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - w / 2, y - w / 2, w, w);
    }
  }

  /* ---- 格子 ---- */

  /* 一个格子：形成了就直接涂实 —— 黑方实心黑、白方实心白（把底下的格线盖掉）。
     相邻同色自然连成一整块，边界交给棋子本身充当，不再另画记号。 */
  function drawCell(x, y, p) {
    ctx.fillStyle = (p === R.RED) ? T.ink : '#ffffff';
    ctx.fillRect(x, y, cell, cell);
  }

  /* 终局的一格：在格子里画一圈「反色」内框 —— 黑格里描白、白格里描黑，
     这样格子涂实之后四连依旧一眼可辨。 */
  function winMark(cx, cy, p, alpha) {
    var x = px(cx), y = py(cy);
    var i2 = Math.max(2, cell * 0.09);
    ctx.lineWidth = Math.max(2, cell * 0.07);
    ctx.strokeStyle = (p === R.RED)
      ? 'rgba(255,255,255,' + (0.30 + 0.60 * alpha) + ')'
      : 'rgba(17,17,17,' + (0.30 + 0.60 * alpha) + ')';
    ctx.strokeRect(x + i2, y + i2, cell - i2 * 2, cell - i2 * 2);
  }

  function wrapWinMark(state, lx, ly, p, alpha) {
    var ax = LX(lx), ay = LY(ly);
    ctx.save();
    ctx.globalAlpha = alpha;
    eachWrap(state, ax, ay, ax + 1, ay + 1, function () { winMark(ax, ay, p, 1); });
    ctx.restore();
  }

  /* 起点标记：空心方框 + 中心点（白色垫底，压在粗线上也看得清） */
  function drawSeedMark(x, y, p) {
    var s = cell * 0.30;
    var isBlack = p === R.RED;
    ctx.fillStyle = isBlack ? T.ink : '#ffffff';
    ctx.fillRect(x - s / 2 - 1.5, y - s / 2 - 1.5, s + 3, s + 3);
    ctx.lineWidth = Math.max(1.2, cell * 0.03);
    ctx.strokeStyle = isBlack ? '#ffffff' : T.ink;
    ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    ctx.fillStyle = isBlack ? '#ffffff' : T.ink;
    ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
  }

  /* ---- 选中与待选折角 ---- */

  function drawSelection(state, v, t) {
    var pulse = 0.5 + 0.5 * Math.sin(t / 460);
    var vx = px(LX(v.x)), vy = py(LY(v.y));
    for (var q = 0; q < 4; q++) {
      var m = R.validateMove(state, v.x, v.y, q);
      if (!m) continue;
      drawGhost(state, v, q, m.isSeed, q === hoverQ, t);
    }
    var hr = cell * (0.15 + 0.025 * pulse);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = T.inkOf(state.turn, 0.85);
    ctx.strokeRect(vx - hr, vy - hr, hr * 2, hr * 2);
    hr = cell * (0.28 + 0.10 * pulse);
    ctx.lineWidth = 1;
    ctx.strokeStyle = T.inkOf(state.turn, 0.28 * (1 - pulse));
    ctx.strokeRect(vx - hr, vy - hr, hr * 2, hr * 2);
  }

  /* 待选折角：实线＝续线，点线＝起笔；白方用空心虚线 */
  function drawGhost(state, v, q, isSeed, active, t) {
    var ori = R.ORIENTATIONS[q];
    var a = ori.arms[0], b = ori.arms[1];
    var ox = px(LX(v.x)), oy = py(LY(v.y));
    var ax = px(LX(v.x + a[0])), ay = py(LY(v.y + a[1]));
    var bx = px(LX(v.x + b[0])), by = py(LY(v.y + b[1]));
    var dash = isSeed ? [cell * 0.07, cell * 0.12] : [cell * 0.26, cell * 0.16];
    var offset = -((t / 26) % (dash[0] + dash[1]));

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.globalAlpha = active ? 0.95 : 0.22;

    /* 淡淡的 L 形面 */
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(ox, oy); ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fillStyle = 'rgba(17,17,17,' + (active ? 0.07 : 0.02) + ')';
    ctx.fill();

    ctx.setLineDash(dash);
    ctx.lineDashOffset = offset;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(ox, oy); ctx.lineTo(bx, by);

    if (state.turn === R.BLUE) {                 // 白方：黑描边 + 白芯
      ctx.lineWidth = Math.max(3.2, cell * 0.115);
      ctx.strokeStyle = T.ink;
      ctx.stroke();
      ctx.lineWidth = Math.max(1.2, cell * 0.045);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else {                                     // 黑方：实线
      ctx.lineWidth = Math.max(1.8, cell * 0.062);
      ctx.strokeStyle = T.ink;
      ctx.stroke();
    }
    ctx.setLineDash([]);

    /* 起笔：角点上再画个小方框（唯一用来区分「花一次起笔」的记号） */
    if (isSeed) {
      var k = cell * 0.22;
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = T.ink;
      ctx.strokeRect(ox - k / 2, oy - k / 2, k, k);
    }
    ctx.restore();
  }

  /* ---- 特效绘制：怎么画由这里决定，播什么由 fx.js 决定 ---- */
  function drawEffects(state, t) {
    for (var i = 0; i < fxSystem.list.length; i++) {
      var e = fxSystem.list[i], u = fxSystem.u(e, t);
      if (u < 0) continue;
      u = U.clamp01(u);
      switch (e.k) {
        case 'ring': {
          var rr = (e.r0 + (e.r1 - e.r0) * U.easeOut(u)) * cell;
          ctx.beginPath();
          ctx.arc(px(LX(e.x)), py(LY(e.y)), Math.max(0.5, rr), 0, U.TAU);
          ctx.lineWidth = Math.max(1, cell * e.w * (1 - u));
          ctx.strokeStyle = T.inkOf(e.p, (1 - u) * 0.65);
          ctx.stroke();
          break;
        }
        case 'spark': {
          var eu = U.easeOut(u);
          var sx = px(LX(e.x) + e.vx * eu);
          var sy = py(LY(e.y) + e.vy * eu + 0.55 * u * u);
          var r = cell * e.size * (1 - u);
          if (r <= 0.25) break;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, U.TAU);
          ctx.fillStyle = T.inkOf(e.p, (1 - u) * 0.75);
          ctx.fill();
          break;
        }
        case 'glow': {
          var ga = (u < 0.25 ? u / 0.25 : 1) * (1 - U.clamp01((u - 0.6) / 0.4) * 0.5);
          wrapWinMark(state, e.cx, e.cy, e.p, ga);
          break;
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 命中测试（给 input 用）                                             */
  /* ------------------------------------------------------------------ */

  function hitVertex(mx, my) {
    var state = game.state();
    var vx = Math.round((mx - pad) / cell), vy = Math.round((my - pad) / cell);
    /* 允许点到盘外那一圈：它显示的就是接过来的那一列 / 行 */
    if (vx < -1 || vx > state.W || vy < -1 || vy > state.H) return null;
    if (Math.hypot(mx - px(vx), my - py(vy)) > cell * 0.55) return null;
    return { x: R.wrapX(state, vx + viewX), y: R.wrapY(state, vy + viewY) };
  }

  function quadrantAt(v, mx, my) {
    var dx = mx - px(LX(v.x)), dy = my - py(LY(v.y));
    if (Math.hypot(dx, dy) > cell * 1.75) return -1;
    var dead = cell * 0.20;
    if (Math.abs(dx) < dead || Math.abs(dy) < dead) return -1;
    if (dx >= 0 && dy < 0) return 0;   // 右上
    if (dx >= 0 && dy >= 0) return 1;  // 右下
    if (dx < 0 && dy >= 0) return 2;   // 左下
    return 3;                          // 左上
  }

  /* ------------------------------------------------------------------ */

  return {
    init: init,
    layout: layout,
    draw: draw,
    invalidate: invalidate,
    needsFrame: needsFrame,
    canvas: function () { return canvas; },

    /* 换接缝 */
    setView: setView,
    resetView: resetView,
    view: function () { return { x: viewX, y: viewY }; },

    /* 视图状态 */
    selected: function () { return selected; },
    select: function (v) { selected = v || null; markViewDirty(); },
    hover: function () { return hover; },
    setHover: function (v) { hover = v || null; markViewDirty(); },
    quadrant: function () { return hoverQ; },
    setQuadrant: function (q) { hoverQ = q; markViewDirty(); },
    pointer: function () { return mouse; },
    setPointer: function (mx, my) { mouse = { x: mx, y: my }; wakeUntil = U.now() + 260; markViewDirty(); },
    clearPointer: function () { mouse = null; hover = null; hoverQ = -1; markViewDirty(); },

    hitVertex: hitVertex,
    quadrantAt: quadrantAt
  };
}
