export class SetupController {
  constructor({ game, controller, online, hud, documentRef = globalThis.document }) {
    this.game = game;
    this.controller = controller;
    this.online = online;
    this.hud = hud;
    this.document = documentRef;
    this.initialized = false;
  }

  element(id) { return this.document.getElementById(id); }

  setMode(mode) {
    const isAI = mode === 'pve' || mode === 'evp' || mode === 'eve';
    this.game.cfg.mode = mode;
    this.element('roomControls').hidden = mode !== 'online';
    this.element('btnStartGame').hidden = mode === 'online';
    this.element('levelLabel').hidden = !isAI;
    this.element('selLevel').hidden = !isAI;
    this.element('roomChoice').hidden = false;
    this.element('joinRoomForm').hidden = true;
    this.hud.refresh();
  }

  bindMode() {
    this.element('selMode').addEventListener('change', event => this.setMode(event.currentTarget.value));
    this.setMode(this.element('selMode').value || 'pvp');
    this.element('selSize').addEventListener('change', event => {
      this.game.cfg.size = Number(event.currentTarget.value);
    });
    this.element('selLevel').addEventListener('change', event => {
      this.game.cfg.level = Number(event.currentTarget.value);
      this.hud.refresh();
    });
  }

  bindStart() {
    this.element('btnStartGame').addEventListener('click', () => {
      this.element('startScreen').hidden = true;
      this.controller.requestNewGame();
    });
  }

  bindRooms() {
    this.element('btnCreateRoom').addEventListener('click', () => this.online.create(this.game.cfg.size));
    this.element('btnJoinRoom').addEventListener('click', () => {
      this.element('roomChoice').hidden = true;
      this.element('joinRoomForm').hidden = false;
      this.element('roomIdInput').focus();
    });
    const joinRoom = () => this.online.join(this.element('roomIdInput').value.trim());
    this.element('btnJoinRoomConfirm').addEventListener('click', joinRoom);
    this.element('btnCancelJoin').addEventListener('click', () => {
      this.element('joinRoomForm').hidden = true;
      this.element('roomChoice').hidden = false;
    });
    this.element('roomIdInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); joinRoom(); }
    });
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.bindMode();
    this.bindStart();
    this.bindRooms();
  }
}
