export class AiSession {
  constructor({ game, chooseMove, schedule = setTimeout, cancel = clearTimeout }) {
    this.game = game;
    this.chooseMove = chooseMove;
    this.schedule = schedule;
    this.cancelTimer = cancel;
    this.timer = null;
    this.token = 0;
  }

  sync() {
    this.cancel();
    const state = this.game.state();
    if (!state || state.winner != null || this.game.players()[state.turn] !== 'ai') return;
    const token = ++this.token;
    const mode = this.game.cfg.mode;
    this.game.setThinking(true);
    this.timer = this.schedule(() => {
      if (token !== this.token) return;
      this.timer = null;
      const current = this.game.state();
      if (!current || current.winner != null || this.game.players()[current.turn] !== 'ai') {
        this.game.setThinking(false);
        return;
      }
      const move = this.chooseMove(current, { level: this.game.cfg.level });
      this.game.setThinking(false);
      if (move) this.game.tryMove(move.x, move.y, move.q);
    }, mode === 'eve' ? 210 : 330);
  }

  cancel() {
    this.token++;
    if (this.timer != null) this.cancelTimer(this.timer);
    this.timer = null;
    if (this.game.thinking()) this.game.setThinking(false);
  }

  destroy() { this.cancel(); }
}
