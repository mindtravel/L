/* =====================================================================
 * 直角 · 侧栏
 * ---------------------------------------------------------------------
 * 回合指示、双方比数、着法记录、底部提示、终局遮罩、轻提示条。
 * 只做「把局面画到 DOM 上」，不改局面。
 * ===================================================================== */
(function (root) {
  'use strict';

  var ZJ = root.ZJ = root.ZJ || {};
  var U = ZJ.util, T = ZJ.theme, R = ZJ.rules;

  var lastSeeds = [0, 0];      // 上一次的起笔次数（用来判断哪一枚刚被用掉）
  var lastLogLen = 0;          // 上一次的着法条数（用来给新的一条加入场动画）
  var toastTimer, overlayTimer;

  var FAIL_TEXT = '这一步不合法';
  var OPENING_TEXT = '开局：双方各先放置一枚种子';

  /* ---------------- 着法记录 ---------------- */

  function renderLog(records) {
    var ol = U.$('log');
    ol.innerHTML = '';
    for (var i = records.length - 1; i >= 0; i--) {
      var rec = records[i], ori = R.ORIENTATIONS[rec.q];
      var li = document.createElement('li');
      li.className = rec.player === R.RED ? 'p0' : 'p1';
      if (i === records.length - 1 && records.length > lastLogLen) li.classList.add('new');
      var html = '<span class="n">' + (i + 1) + '</span>' +
                 '<span class="tag">' + T.players[rec.player] + '</span>' +
                 '<span class="desc">' + ori.arrow + ori.label +
                 ' (' + rec.x + ',' + rec.y + ') ' + (rec.isSeed ? '种子' : '续线') + '</span>';
      if (rec.claimed.length) html += '<span class="claim">成格 ' + rec.claimed.length + '</span>';
      li.innerHTML = html;
      ol.appendChild(li);
    }
    if (!records.length) ol.innerHTML = '<li style="color:#a6a6a6">' + OPENING_TEXT + '</li>';
    lastLogLen = records.length;
  }

  /* ---------------- 小部件 ---------------- */

  /* 起笔次数：小方块；刚用掉的那一枚弹一下 */
  function pips(el, n, prev, total) {
    el.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var s = document.createElement('span');
      if (i < n) s.classList.add('on');
      else if (i < prev) s.classList.add('pop');
      el.appendChild(s);
    }
  }

  /* 数字变了才弹一下 */
  function bump(el, txt) {
    if (el.textContent === txt) return;
    el.textContent = txt;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /* ---------------- 刷新整块侧栏 ---------------- */

  function refresh() {
    var state = ZJ.game.state();
    var cfg = ZJ.game.cfg;
    var thinking = ZJ.game.thinking();
    var players = ZJ.game.players();
    var selected = ZJ.board.selected();
    var meta = U.$('sessionMeta');
    if (meta) {
      var modeText = { pvp: '双人同机', pve: '人机 · 执黑', evp: '人机 · 执白', eve: 'AI 自弈', online: '联机对弈' }[cfg.mode] || cfg.mode;
      var detail = cfg.mode === 'online' && ZJ.online && ZJ.online.room() ? ' · 房间 ' + ZJ.online.room() : '';
      if (cfg.mode !== 'pvp' && cfg.mode !== 'online') detail += ' · 强度 ' + cfg.level;
      meta.textContent = modeText + detail;
    }

    /* 回合指示 */
    var pill = U.$('turnpill'), txt = U.$('turntext');
    pill.classList.remove('p0', 'p1', 'over', 'thinking');
    if (state.winner == null) {
      pill.classList.add(state.turn === R.RED ? 'p0' : 'p1');
      if (thinking) pill.classList.add('thinking');
      txt.textContent = thinking ? T.players[state.turn] + '思考中' : T.players[state.turn] + '回合';
    } else {
      pill.classList.add('over');
      txt.textContent = state.winner === 'draw' ? '和棋' : T.players[state.winner] + '胜';
    }

    /* 双方比数 */
    U.$('sideRed').classList.toggle('active', state.winner == null && state.turn === R.RED);
    U.$('sideBlue').classList.toggle('active', state.winner == null && state.turn === R.BLUE);
    pips(U.$('pipsRed'), state.seeds[0], lastSeeds[0], cfg.seeds);
    pips(U.$('pipsBlue'), state.seeds[1], lastSeeds[1], cfg.seeds);
    lastSeeds = [state.seeds[0], state.seeds[1]];
    bump(U.$('cellRed'), R.countCells(state, R.RED) + ' 格');
    bump(U.$('cellBlue'), R.countCells(state, R.BLUE) + ' 格');
    U.$('btnUndo').disabled = ZJ.game.history().length === 0;

    /* 底部提示 */
    var hint = U.$('hintline');
    if (state.winner != null) {
      hint.innerHTML = state.winner === 'draw'
        ? '棋盘再也放不下折角了 —— <b>和棋</b>'
        : '<b>' + T.players[state.winner] + '</b>连成四格，赢下此局';
    } else if (thinking) {
      hint.textContent = T.players[state.turn] + '正在思考…';
    } else if (players[state.turn] === 'ai') {
      hint.textContent = '电脑回合';
    } else if (selected) {
      hint.innerHTML = '点四周的<b>虚线折角</b>落子 · 实线＝续线，点线＝种子落子（消耗 1 枚）· Esc 取消';
    } else {
      hint.innerHTML = '点一个<b>格点</b>，再从四个虚线折角里挑一个 · 快捷键 1–4 / U 悔棋 / R 新局';
    }
  }

  /* ---------------- 终局遮罩 ---------------- */

  function showOverlay() {
    var state = ZJ.game.state();
    if (state.winner == null) return;          // 期间可能已经开了新局
    var black = R.countCells(state, R.RED), white = R.countCells(state, R.BLUE);
    if (state.winner === 'draw') {
      U.$('ovEmoji').textContent = '＝';
      U.$('ovTitle').textContent = '和棋';
      U.$('ovTitle').style.color = T.ink2;
      U.$('ovSub').textContent = '再没有可画的折角了';
    } else {
      U.$('ovEmoji').textContent = state.winner === R.RED ? '■' : '□';
      U.$('ovTitle').textContent = T.players[state.winner] + '胜';
      U.$('ovTitle').style.color = T.ink;
      U.$('ovSub').textContent = '连成四格 · 黑 ' + black + ' 格 · 白 ' + white + ' 格';
    }
    var ov = U.$('overlay');
    ov.hidden = false;
    var box = ov.querySelector ? ov.querySelector('.box') : null;
    if (box) { box.style.animation = 'none'; void box.offsetWidth; box.style.animation = ''; }
  }

  function hideOverlay() { U.$('overlay').hidden = true; }

  /* 延时弹出终局卡：先让连成四格的高亮播完 */
  function scheduleOverlay(delay) {
    clearTimeout(overlayTimer);
    if (delay > 0) overlayTimer = setTimeout(showOverlay, delay);
    else showOverlay();
  }

  function clearOverlayTimer() { clearTimeout(overlayTimer); }

  /* ---------------- 轻提示条 ---------------- */

  function toast(msg, duration) {
    var el = U.$('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, duration || 2200);
  }

  /* ---------------- 开局时把面板归零 ---------------- */

  function reset(cfg) {
    lastSeeds = [cfg.seeds, cfg.seeds];
    lastLogLen = 0;
    hideOverlay();
  }

  ZJ.hud = {
    renderLog: renderLog,
    refresh: refresh,
    showOverlay: showOverlay,
    scheduleOverlay: scheduleOverlay,
    clearOverlayTimer: clearOverlayTimer,
    hideOverlay: hideOverlay,
    toast: toast,
    fail: function () { toast(FAIL_TEXT); },
    reset: reset
  };
})(typeof window !== 'undefined' ? window : globalThis);
