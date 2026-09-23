import { cloneRecords, fromSnapshot } from './game-snapshot.mjs';

export class GameEngine {
  constructor({ rules, util, config = {} }) {
    this.rules = rules;
    this.util = util;
    this.presentation = null;
    this.cfg = {
      size: 13,
      seeds: 3,
      mode: 'pvp',
      level: 2,
      hints: true,
      overlayDelay: 1100,
      ...config
    };
    this.currentState = null;
    this.snapshots = [];
    this.moveRecords = [];
    this.legalMoves = new Set();
    this.isThinking = false;
    this.lastMoveTime = -1e9;
    this.onlinePlayer = null;
    this.stateObserver = null;
  }

  configure({ presentation }) { this.presentation = presentation; }
  state() { return this.currentState; }
  history() { return this.snapshots; }
  records() { return this.moveRecords; }
  legalCorners() { return this.legalMoves; }
  thinking() { return this.isThinking; }
  lastMoveAt() { return this.lastMoveTime; }
  onlinePlayerSlot() { return this.onlinePlayer; }
  setOnlinePlayer(player) { this.onlinePlayer = player; }
  setStateObserver(observer) { this.stateObserver = observer; }

  players() {
    if (this.cfg.mode === 'online' || this.cfg.mode === 'pvp') return ['human', 'human'];
    if (this.cfg.mode === 'pve') return ['human', 'ai'];
    if (this.cfg.mode === 'evp') return ['ai', 'human'];
    return ['ai', 'ai'];
  }

  isHumanTurn() {
    const state = this.currentState;
    if (!state || state.winner != null || this.isThinking) return false;
    if (this.cfg.mode === 'online') return this.onlinePlayer != null && state.turn === this.onlinePlayer;
    return this.players()[state.turn] === 'human';
  }

  refreshLegal() {
    this.legalMoves = new Set(this.rules.legalMoves(this.currentState).map(move => move.x + ',' + move.y));
  }

  validateMove(x, y, q) { return this.rules.validateMove(this.currentState, x, y, q); }
  moveError(x, y, q) { return this.rules.moveError(this.currentState, x, y, q); }

  tryMove(x, y, q) {
    const move = this.validateMove(x, y, q);
    if (!move) return { ok: false, code: this.moveError(x, y, q) };
    this.applyLocalMove(move);
    return { ok: true };
  }

  applyOnlineState(snapshot, meta) {
    const previous = this.currentState;
    this.currentState = fromSnapshot(snapshot, this.rules);
    this.snapshots = [];
    this.moveRecords = snapshot.records ? cloneRecords(snapshot.records) : (this.currentState.lastMove ? [this.currentState.lastMove] : []);
    this.refreshLegal();
    this.presentation.remoteState(previous, this.currentState, this.moveRecords, meta, this.cfg.overlayDelay);
    this.notifyStateChanged();
  }

  applyLocalMove(move) {
    const previous = this.rules.cloneState(this.currentState);
    const record = this.rules.applyMove(this.currentState, move);
    if (!record) return null;
    this.snapshots.push(previous);
    this.moveRecords.push(record);
    this.lastMoveTime = this.util.now();
    this.refreshLegal();
    this.presentation.move(record, this.currentState, this.moveRecords, this.cfg.overlayDelay);
    this.notifyStateChanged();
    return record;
  }

  newGame() {
    this.currentState = this.rules.createGame(this.cfg.size, this.cfg.size, this.cfg.seeds);
    this.snapshots = [];
    this.moveRecords = [];
    this.isThinking = false;
    this.lastMoveTime = -1e9;
    this.refreshLegal();
    this.presentation.reset(this.cfg, this.moveRecords);
    this.notifyStateChanged();
  }

  undo(count = 1) {
    if (!this.snapshots.length) return false;
    this.isThinking = false;
    let steps = Math.min(this.snapshots.length, Math.max(1, Number(count) || 1));
    while (steps-- > 0) {
      this.currentState = this.snapshots.pop();
      this.moveRecords.pop();
    }
    this.lastMoveTime = -1e9;
    this.refreshLegal();
    this.presentation.undo(this.moveRecords);
    this.notifyStateChanged();
    return true;
  }

  setThinking(value) {
    const next = !!value;
    if (this.isThinking === next) return;
    this.isThinking = next;
    this.presentation.thinking();
  }

  notifyStateChanged() {
    if (this.stateObserver) this.stateObserver(this.currentState);
  }

  renderFrame(time) { this.presentation.renderFrame(time, this.isThinking); }

  boot() {
    if (!this.presentation) throw new Error('Game presentation adapter must be configured before boot');
    this.presentation.boot();
    this.presentation.installRenderer(time => this.renderFrame(time));
    this.newGame();
  }
}
