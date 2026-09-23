/* =====================================================================
 * 直角 · 局面与流程
 * ---------------------------------------------------------------------
 * 持有局面状态、驱动行棋流程（落子 / 悔棋 / 开局 / 电脑走棋），
 * 并把「该画了、该刷面板了、该响了」分发给其它模块。所有模块由这里启动。
 * ===================================================================== */
(function (root) {
  'use strict';

  var ZJ = root.ZJ = root.ZJ || {};
  var U = ZJ.util, T = ZJ.theme, R = ZJ.rules, AI = ZJ.ai;

  var cfg = {
    size: 13,           // 棋盘边长（格）
    seeds: 3,           // 每人起笔次数
    mode: 'pvp',        // pvp | pve | evp | eve
    level: 2,           // 电脑强度 1..3
    hints: true,        // 可落子提示
    overlayDelay: 1100  // 终局遮罩延迟（毫秒）
  };

  var state = null;              // 规则内核里的局面
  var history = [], records = [];// 悔棋快照 / 着法记录
  var legal = new Set();         // 合法角点 "x,y"
  var thinking = false;
  var aiToken = 0, aiTimer = null, lastMoveAt = -1e9;
  var onlinePlayer = null;

  /* ---------------- 只读接口 ---------------- */

  function players() {
    if (cfg.mode === 'online') return ['human', 'human'];
    if (cfg.mode === 'pvp') return ['human', 'human'];
    if (cfg.mode === 'pve') return ['human', 'ai'];
    if (cfg.mode === 'evp') return ['ai', 'human'];
    return ['ai', 'ai'];
  }

  function isHumanTurn() {
    if (!state || state.winner != null || thinking) return false;
    if (cfg.mode === 'online') return onlinePlayer != null && state.turn === onlinePlayer;
    return players()[state.turn] === 'human';
  }

  function refreshLegal() {
    legal = new Set();
    var ms = R.legalMoves(state);
    for (var i = 0; i < ms.length; i++) legal.add(ms[i].x + ',' + ms[i].y);
  }

  /* ---------------- 行棋 ---------------- */

  function tryMove(x, y, q) {
    var m = R.validateMove(state, x, y, q);
    if (!m) {
      var reason = R.moveError(state, x, y, q);
      ZJ.hud.toast(reason === 'seed-exhausted' ? '种子已用完，只能从自己的线继续' : '这一步不合法');
      ZJ.sfx.bad();
      return;
    }
    if (cfg.mode === 'online') { ZJ.online.move(x, y, q); return; }
    doMove(m);
  }

  function applyOnlineState(snapshot, meta) {
    var previous = state;
    state = R.hydrateState(snapshot); history = []; records = [];
    records = snapshot.records ? snapshot.records.slice() : (state.lastMove ? [state.lastMove] : []);
    if (meta && meta.move && state.lastMove && ZJ.fx) {
      ZJ.fx.edgeGrow(state.lastMove);
      if (state.lastMove.isSeed) ZJ.fx.seedRing(state.lastMove.x, state.lastMove.y, state.lastMove.player);
    }
    if (previous && previous.winner == null && state.winner != null) {
      if (state.winner === R.DRAW) ZJ.sfx.draw();
      else { ZJ.fx.winBurst(state.winLine, state.winner); ZJ.sfx.win(); }
      ZJ.hud.scheduleOverlay(cfg.overlayDelay);
    }
    refreshLegal(); ZJ.hud.renderLog(records); ZJ.hud.refresh();
    ZJ.board.select(null); ZJ.board.setHover(null); ZJ.board.setQuadrant(-1);
    ZJ.board.layout(); ZJ.board.invalidate(600);
  }

  function doMove(m) {
    var before = R.cloneState(state);
    var rec = R.applyMove(state, m);
    if (!rec) return;

    history.push(before);
    records.push(rec);
    ZJ.board.select(null);
    ZJ.board.setHover(null);
    ZJ.board.setQuadrant(-1);
    lastMoveAt = U.now();

    /* —— 特效与音效 —— */
    ZJ.fx.edgeGrow(rec);
    if (rec.isSeed) ZJ.fx.seedRing(rec.x, rec.y, rec.player);
    /* 成格不做动画：格子直接落定，只留一声提示音 */
    if (rec.claimed.length) ZJ.sfx.claim(rec.claimed.length);
    else ZJ.sfx.place(rec.player, rec.isSeed);

    if (state.winner != null) {
      if (state.winner === 'draw') {
        ZJ.sfx.draw();
      } else {
        ZJ.fx.winBurst(state.winLine, state.winner);
        ZJ.sfx.win();
      }
      ZJ.hud.scheduleOverlay(cfg.overlayDelay);
    }

    refreshLegal();
    ZJ.hud.renderLog(records);
    ZJ.hud.refresh();
    ZJ.board.invalidate(600);

    if (state.winner == null) maybeAI();
  }

  function maybeAI() {
    if (state.winner != null) return;
    if (players()[state.turn] !== 'ai') return;

    var token = ++aiToken;
    thinking = true;
    ZJ.hud.refresh();
    ZJ.board.invalidate();

    var delay = (cfg.mode === 'eve') ? 210 : 330;    // 留一点思考的观感
    aiTimer = setTimeout(function () {
      if (token !== aiToken) return;                 // 期间开过新局 / 悔过棋
      if (state.winner != null) { thinking = false; ZJ.hud.refresh(); return; }
      var m = AI.chooseAIMove(state, { level: cfg.level });
      thinking = false;
      if (!m) { ZJ.hud.refresh(); return; }
      doMove(m);
    }, delay);
  }

  /* ---------------- 开局 / 悔棋 ---------------- */

  function newGame() {
    if (cfg.mode === 'online' && ZJ.online && ZJ.online.room()) {
      ZJ.online.reset();
      return;
    }
    state = R.createGame(cfg.size, cfg.size, cfg.seeds);
    history = []; records = [];
    thinking = false;
    aiToken++;
    if (aiTimer) clearTimeout(aiTimer);
    ZJ.hud.clearOverlayTimer();
    ZJ.fx.clear();
    lastMoveAt = -1e9;
    ZJ.board.select(null);
    ZJ.board.clearPointer();
    ZJ.board.resetView();
    ZJ.hud.reset(cfg);
    ZJ.hud.renderLog(records);
    ZJ.board.layout();
    ZJ.input.syncAxes();
    refreshLegal();
    ZJ.hud.refresh();
    ZJ.board.invalidate(500);
    if (cfg.mode !== 'online') maybeAI();
  }

  function undo() {
    if (!history.length) { ZJ.hud.toast('没有可悔的棋'); ZJ.sfx.bad(); return; }
    aiToken++;
    if (aiTimer) clearTimeout(aiTimer);
    ZJ.hud.clearOverlayTimer();
    thinking = false;

    state = history.pop();
    records.pop();
    /* 人机模式：连退到轮到自己 */
    var bothAI = players()[0] === 'ai' && players()[1] === 'ai';
    if (!bothAI && players()[state.turn] === 'ai' && history.length) {
      state = history.pop();
      records.pop();
    }

    ZJ.board.select(null);
    ZJ.board.setHover(null);
    ZJ.fx.clear();
    lastMoveAt = -1e9;
    ZJ.hud.hideOverlay();
    refreshLegal();
    ZJ.hud.renderLog(records);
    ZJ.hud.refresh();
    ZJ.sfx.undo();
    ZJ.board.invalidate(400);
  }

  /* ---------------- 渲染调度 ---------------- */
  function renderFrame(t) {
    ZJ.fx.step(t);
    if (ZJ.board.needsFrame(t) || thinking) ZJ.board.draw(t);
    else ZJ.scheduler.sleep();
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    ZJ.sfx.enabled = U.$('chkSfx').checked;
    ZJ.board.init();
    ZJ.input.init();

    document.title = T.name;
    U.$('gameName').textContent = T.name;

    ZJ.scheduler.install(renderFrame);
    newGame();
  }

  ZJ.game = {
    cfg: cfg,
    state: function () { return state; },
    history: function () { return history; },
    records: function () { return records; },
    legalCorners: function () { return legal; },
    players: players,
    isHumanTurn: isHumanTurn,
    thinking: function () { return thinking; },
    lastMoveAt: function () { return lastMoveAt; },

    tryMove: tryMove,
    undo: undo,
    newGame: newGame,
    setOnlinePlayer: function (p) { onlinePlayer = p; },
    onlinePlayer: function () { return onlinePlayer; },
    applyOnlineState: applyOnlineState,
    boot: boot
  };

  /* 供调试与自动化测试使用（不影响正常游玩） */
  root.ZJ = ZJ;

  /* 脚本都放在 </body> 之前，DOM 已就绪；仍然留一道 readyState 的保险 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
