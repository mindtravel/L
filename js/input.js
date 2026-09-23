/* =====================================================================
 * 直角 · 输入
 * ---------------------------------------------------------------------
 * 指针 / 键盘 / 面板控件 → 翻译成对 board（视图状态）和 game（行棋）的调用。
 *
 * 换接缝用的是棋盘下面那两根滚动轴，不占用鼠标拖动 ——
 * 左键在棋盘上就只剩「选格点、落子」一件事。
 * ===================================================================== */
(function (root) {
  'use strict';

  var ZJ = root.ZJ = root.ZJ || {};
  var U = ZJ.util;

  function canvasEl() { return ZJ.board.canvas(); }

  function pos(ev) {
    var r = canvasEl().getBoundingClientRect();
    return { mx: ev.clientX - r.left, my: ev.clientY - r.top };
  }

  /* ---------------- 指针：点击 = 选点 / 落子 ---------------- */

  function onDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;   // 只认左键
    if (!ZJ.game.isHumanTurn()) return;
    if (ev.preventDefault) ev.preventDefault();

    var p = pos(ev);
    var legal = ZJ.game.legalCorners();
    var sel = ZJ.board.selected();

    if (sel) {
      /* 已经选中一个格点：点在某个象限就落子 */
      var q = ZJ.board.quadrantAt(sel, p.mx, p.my);
      if (q >= 0) { ZJ.game.tryMove(sel.x, sel.y, q); return; }

      var v = ZJ.board.hitVertex(p.mx, p.my);
      if (v && v.x === sel.x && v.y === sel.y) { ZJ.board.select(null); return; }   // 再点一下取消
      if (v && legal.has(v.x + ',' + v.y)) { ZJ.board.select(v); return; }
      ZJ.board.select(null);
      return;
    }

    var w = ZJ.board.hitVertex(p.mx, p.my);
    if (w && legal.has(w.x + ',' + w.y)) ZJ.board.select(w);
    else if (w && ZJ.game.state().seeds[ZJ.game.state().turn] === 0) {
      ZJ.hud.toast('种子已用完，只能点击自己的线继续', 3200);
    }
  }

  function onMove(ev) {
    var p = pos(ev);
    ZJ.board.setPointer(p.mx, p.my);
    ZJ.board.setHover(ZJ.board.hitVertex(p.mx, p.my));
    var sel = ZJ.board.selected();
    ZJ.board.setQuadrant(sel ? ZJ.board.quadrantAt(sel, p.mx, p.my) : -1);
  }

  function onLeave() { ZJ.board.clearPointer(); }

  function onRight(ev) {
    if (ev.preventDefault) ev.preventDefault();
    ZJ.board.select(null);
  }

  /* ---------------- 键盘 ---------------- */

  function onKey(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    var k = e.key;

    if (k === 'Escape') { ZJ.board.select(null); return; }
    if (k === 'u' || k === 'U') { ZJ.game.undo(); return; }
    if (k === 'r' || k === 'R') { ZJ.game.newGame(); return; }
    if (k === 'h' || k === 'H') { setHints(!ZJ.game.cfg.hints); return; }
    if (k >= '1' && k <= '4') {
      var v = ZJ.board.selected() || ZJ.board.hover();
      if (v && ZJ.game.isHumanTurn()) ZJ.game.tryMove(v.x, v.y, +k - 1);
    }
  }

  /* ---------------- 换接缝：两根滚动轴 ---------------- */

  function syncAxes() {
    var state = ZJ.game.state();
    if (!state) return;
    var ax = U.$('axisX'), ay = U.$('axisY'), v = ZJ.board.view();
    ax.max = state.W - 1;
    ay.max = state.H - 1;
    ax.value = v.x;
    ay.value = v.y;
    U.$('axisXVal').textContent = v.x;
    U.$('axisYVal').textContent = v.y;
  }

  function bindAxes() {
    var ax = U.$('axisX'), ay = U.$('axisY');
    var apply = function () {
      ZJ.board.setView(+ax.value, +ay.value);
      syncAxes();
    };
    ax.addEventListener('input', apply);
    ay.addEventListener('input', apply);
    ax.addEventListener('change', apply);
    ay.addEventListener('change', apply);
  }

  /* ---------------- 面板控件 ---------------- */

  function setHints(on) {
    ZJ.game.cfg.hints = on;
    U.$('chkHints').checked = on;
    ZJ.board.invalidate();
  }

  function bindControls() {
    U.$('btnNew').addEventListener('click', function () { ZJ.game.newGame(); });
    U.$('btnUndo').addEventListener('click', function () { ZJ.game.undo(); });
    U.$('ovAgain').addEventListener('click', function () { ZJ.game.newGame(); });
    U.$('ovView').addEventListener('click', function () { ZJ.hud.hideOverlay(); });

    U.$('selMode').addEventListener('change', function () {
      var isAI = this.value === 'pve' || this.value === 'evp' || this.value === 'eve';
      ZJ.game.cfg.mode = this.value;
      U.$('roomControls').hidden = this.value !== 'online';
      U.$('levelLabel').hidden = !isAI;
      U.$('selLevel').hidden = !isAI;
      ZJ.hud.refresh();
    });
    U.$('selMode').addEventListener('change', function () { if (this.value === 'online') ZJ.hud.toast('请创建房间或输入房间号加入'); });
    U.$('btnStartGame').addEventListener('click', function () {
      if (ZJ.game.cfg.mode === 'online') {
        ZJ.hud.toast('请先创建房间或加入房间');
        return;
      }
      U.$('startScreen').hidden = true;
      ZJ.game.newGame();
    });
    U.$('btnCreateRoom').addEventListener('click', function () { ZJ.online.create(); });
    U.$('btnJoinRoom').addEventListener('click', function () { ZJ.online.join(U.$('roomIdInput').value.trim()); });
    U.$('selSize').addEventListener('change', function () { ZJ.game.cfg.size = +this.value; ZJ.game.newGame(); });
    U.$('selLevel').addEventListener('change', function () { ZJ.game.cfg.level = +this.value; ZJ.hud.refresh(); });

    U.$('chkHints').addEventListener('change', function () { setHints(this.checked); });
    U.$('chkSfx').addEventListener('change', function () {
      ZJ.sfx.enabled = this.checked;
      if (this.checked) ZJ.sfx.place(0, false);      // 开的时候给一声反馈
    });
  }

  function bindResize() {
    var timer;
    root.addEventListener('resize', function () {
      if (!ZJ.game.state()) return;
      clearTimeout(timer);
      timer = setTimeout(function () { ZJ.board.layout(); ZJ.board.invalidate(); }, 90);
    });
  }

  ZJ.input = {
    init: function () {
      var c = canvasEl();
      c.addEventListener('pointerdown', onDown);
      c.addEventListener('pointermove', onMove);
      c.addEventListener('pointerleave', onLeave);
      c.addEventListener('contextmenu', onRight);
      document.addEventListener('keydown', onKey);
      bindControls();
      bindAxes();
      bindResize();
    },
    syncAxes: syncAxes
  };
})(typeof window !== 'undefined' ? window : globalThis);
