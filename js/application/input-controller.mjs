export class InputController {
  constructor({ game, board, hud, controller, online, sfx, documentRef = globalThis.document, windowRef = globalThis }) {
    this.game = game;
    this.board = board;
    this.hud = hud;
    this.controller = controller;
    this.online = online;
    this.sfx = sfx;
    this.document = documentRef;
    this.window = windowRef;
    this.initialized = false;
  }

  element(id) { return this.document.getElementById(id); }

  position(event) {
    const rect = this.board.canvas().getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  commandMove(x, y, q) { return this.controller.requestMove(x, y, q); }

  onPointerDown = event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();
    const permission = this.controller.reportBoardAttempt();
    if (!permission.ok) return;

    const point = this.position(event);
    const legal = this.game.legalCorners();
    const selected = this.board.selected();
    if (selected) {
      const quadrant = this.board.quadrantAt(selected, point.x, point.y);
      if (quadrant >= 0) { this.commandMove(selected.x, selected.y, quadrant); return; }
      const vertex = this.board.hitVertex(point.x, point.y);
      if (vertex && vertex.x === selected.x && vertex.y === selected.y) { this.board.select(null); return; }
      if (vertex && legal.has(vertex.x + ',' + vertex.y)) { this.board.select(vertex); return; }
      this.board.select(null);
      return;
    }

    const vertex = this.board.hitVertex(point.x, point.y);
    if (vertex && legal.has(vertex.x + ',' + vertex.y)) this.board.select(vertex);
    else if (vertex && this.game.state().seeds[this.game.state().turn] === 0) {
      this.hud.toast('种子已用完，只能点击自己的线继续', 3200);
    }
  };

  onPointerMove = event => {
    const point = this.position(event);
    this.board.setPointer(point.x, point.y);
    this.board.setHover(this.board.hitVertex(point.x, point.y));
    const selected = this.board.selected();
    this.board.setQuadrant(selected ? this.board.quadrantAt(selected, point.x, point.y) : -1);
  };

  onPointerLeave = () => this.board.clearPointer();
  onContextMenu = event => { event.preventDefault(); this.board.select(null); };

  onKeyDown = event => {
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const key = event.key;
    if (key === 'Escape') { this.board.select(null); return; }
    if (key === 'u' || key === 'U') { this.controller.requestUndo(); return; }
    if (key === 'r' || key === 'R') { this.controller.requestNewGame(); return; }
    if (key === 'h' || key === 'H') { this.setHints(!this.game.cfg.hints); return; }
    if (key >= '1' && key <= '4') {
      const vertex = this.board.selected() || this.board.hover();
      if (vertex) this.commandMove(vertex.x, vertex.y, Number(key) - 1);
    }
  };

  syncAxes() {
    const state = this.game.state();
    if (!state) return;
    const axisX = this.element('axisX'), axisY = this.element('axisY'), view = this.board.view();
    axisX.max = state.W - 1;
    axisY.max = state.H - 1;
    axisX.value = view.x;
    axisY.value = view.y;
    this.element('axisXVal').textContent = view.x;
    this.element('axisYVal').textContent = view.y;
  }

  setHints(enabled) {
    this.game.cfg.hints = enabled;
    this.element('chkHints').checked = enabled;
    this.board.invalidate();
  }

  copyRoom() {
    const roomId = this.online.room && this.online.room();
    if (!roomId) return;
    const clipboard = this.window.navigator && this.window.navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      this.hud.toast('房间号：' + roomId, 4000);
      return;
    }
    try {
      clipboard.writeText(roomId).then(
        () => this.hud.toast('房间号已复制'),
        () => this.hud.toast('复制失败，房间号：' + roomId, 4000)
      );
    } catch (_) {
      this.hud.toast('复制失败，房间号：' + roomId, 4000);
    }
  }

  bindAxes() {
    const axisX = this.element('axisX'), axisY = this.element('axisY');
    const apply = () => {
      this.board.setView(Number(axisX.value), Number(axisY.value));
      this.syncAxes();
    };
    axisX.addEventListener('input', apply);
    axisY.addEventListener('input', apply);
    axisX.addEventListener('change', apply);
    axisY.addEventListener('change', apply);
  }

  bindGameControls() {
    this.element('btnNew').addEventListener('click', () => this.controller.requestNewGame());
    this.element('btnUndo').addEventListener('click', () => this.controller.requestUndo());
    this.element('btnCopyRoom').addEventListener('click', () => this.copyRoom());
    this.element('ovAgain').addEventListener('click', () => this.controller.requestNewGame());
    this.element('ovView').addEventListener('click', () => this.hud.hideOverlay());

    this.element('chkHints').addEventListener('change', event => this.setHints(event.currentTarget.checked));
    this.element('chkSfx').addEventListener('change', event => {
      this.sfx.enabled = event.currentTarget.checked;
      if (event.currentTarget.checked) this.sfx.place(0, false);
    });
  }

  bindResize() {
    let timer;
    this.window.addEventListener('resize', () => {
      if (!this.game.state()) return;
      clearTimeout(timer);
      timer = setTimeout(() => { this.board.layout(); this.board.invalidate(); }, 90);
    });
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const canvas = this.board.canvas();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    this.document.addEventListener('keydown', this.onKeyDown);
    this.bindGameControls();
    this.bindAxes();
    this.bindResize();
  }
}
