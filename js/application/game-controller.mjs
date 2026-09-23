import { SessionStatus } from './session-state.mjs';

const messages = {
  NOT_YOUR_TURN: '当前轮到{player}方',
  WAITING_FOR_PLAYER: '正在等待另一位玩家加入',
  OPPONENT_DISCONNECTED: '对手已断线，等待对方重连',
  PENDING_MOVE: '正在等待服务器确认落子',
  DISCONNECTED: '联机已断开，正在尝试重连',
  GAME_OVER: '本局已经结束'
};

export class GameController {
  constructor({ game, getMode, getOnlineSession, feedback, now = () => Date.now(), feedbackInterval = 1000 }) {
    this.game = game;
    this.getMode = getMode;
    this.getOnlineSession = getOnlineSession;
    this.feedback = feedback || (() => {});
    this.now = now;
    this.feedbackInterval = feedbackInterval;
    this.lastFeedback = new Map();
  }

  reportBoardAttempt() {
    const state = this.game.state();
    if (!state || state.winner != null) return this.reject('GAME_OVER');
    if (this.getMode() !== 'online') {
      if (!this.game.isHumanTurn()) return this.reject('NOT_YOUR_TURN');
      return { ok: true };
    }
    const online = this.getOnlineSession();
    const session = online && online.state();
    if (session && session.error) return this.reject('SESSION_ERROR', session.error);
    if (!session || session.status === SessionStatus.DISCONNECTED || session.status === SessionStatus.RECONNECTING) {
      return this.reject('DISCONNECTED');
    }
    if (session.status === SessionStatus.CONNECTING) return this.reject('CONNECTING', '正在连接服务器，请稍候');
    if (session.status === SessionStatus.PENDING_MOVE) return this.reject('PENDING_MOVE');
    if (session.status === SessionStatus.OPPONENT_DISCONNECTED) return this.reject('OPPONENT_DISCONNECTED');
    if (session.status === SessionStatus.WAITING || session.connectedPlayers < 2) return this.reject('WAITING_FOR_PLAYER');
    if (session.player !== state.turn) return this.reject('NOT_YOUR_TURN');
    return { ok: true };
  }

  requestMove(x, y, q) {
    const permission = this.reportBoardAttempt();
    if (!permission.ok) return permission;
    const move = this.game.validateMove(x, y, q);
    if (!move) {
      const reason = this.game.moveError(x, y, q);
      const message = reason === 'seed-exhausted' ? '种子已用完，只能从自己的线继续' : '这一步不合法';
      this.feedback(message, reason || 'ILLEGAL_MOVE');
      return { ok: false, code: reason || 'ILLEGAL_MOVE', message };
    }
    if (this.getMode() === 'online') {
      const result = this.getOnlineSession().move(x, y, q);
      if (!result.ok) this.reject(result.code, result.code === 'PENDING_MOVE' ? messages.PENDING_MOVE : undefined);
      return result;
    }
    this.game.tryMove(x, y, q);
    return { ok: true };
  }

  requestUndo() {
    if (this.getMode() === 'online') return this.reject('ONLINE_UNDO_UNAVAILABLE', '联机对局不能悔棋');
    const history = this.game.history();
    if (!history.length) return this.reject('NO_UNDO', '没有可悔的棋');
    const players = this.game.players();
    const bothAi = players[0] === 'ai' && players[1] === 'ai';
    const previous = history[history.length - 1];
    const plies = !bothAi && players[previous.turn] === 'ai' && history.length > 1 ? 2 : 1;
    this.game.undo(plies);
    return { ok: true };
  }

  requestNewGame() {
    if (this.getMode() === 'online') {
      const result = this.getOnlineSession().requestRematch();
      if (!result.ok) this.reject(result.code, result.code === 'DISCONNECTED' ? messages.DISCONNECTED : '当前无法申请再来一局');
      return result;
    }
    this.game.newGame();
    return { ok: true };
  }

  applyRemoteState(snapshot, meta) {
    this.game.applyOnlineState(snapshot, meta);
  }

  reject(code, override) {
    const state = this.game.state();
    const player = state && state.turn === 0 ? '黑' : '白';
    const message = override || (messages[code] || '当前操作无法完成').replace('{player}', player);
    const time = this.now();
    const previous = this.lastFeedback.get(code);
    if (!previous || previous.message !== message || time - previous.time >= this.feedbackInterval) {
      this.feedback(message, code);
      this.lastFeedback.set(code, { message, time });
    }
    return { ok: false, code, message };
  }
}
