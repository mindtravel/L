export const SessionStatus = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  WAITING: 'waiting',
  PLAYING: 'playing',
  PENDING_MOVE: 'pending-move',
  OPPONENT_DISCONNECTED: 'opponent-disconnected',
  RECONNECTING: 'reconnecting',
  FINISHED: 'finished',
  ERROR: 'error'
});

export function createSessionState() {
  return {
    status: SessionStatus.DISCONNECTED,
    roomId: null,
    player: null,
    connectedPlayers: 0,
    hasOpponent: false,
    version: -1,
    pendingCommandId: null,
    error: null,
    rematch: { requestedBy: null, accepted: false }
  };
}

export function reduceSession(state, event) {
  const next = { ...state, rematch: { ...state.rematch } };
  switch (event.type) {
    case 'connecting':
      next.status = SessionStatus.CONNECTING;
      next.error = null;
      break;
    case 'connected':
      next.status = SessionStatus.CONNECTING;
      break;
    case 'room-created':
    case 'room-joined':
      next.roomId = event.roomId;
      next.player = event.player;
      next.version = event.version;
      next.connectedPlayers = event.connectedPlayers || 1;
      next.hasOpponent = event.status === 'playing';
      next.status = event.status === 'playing' ? SessionStatus.PLAYING : SessionStatus.WAITING;
      next.error = null;
      next.pendingCommandId = null;
      next.rematch = { requestedBy: null, accepted: false };
      break;
    case 'move-pending':
      next.status = SessionStatus.PENDING_MOVE;
      next.pendingCommandId = event.commandId;
      next.error = null;
      break;
    case 'state-applied':
      next.version = event.version;
      next.pendingCommandId = null;
      next.status = event.finished ? SessionStatus.FINISHED :
        (next.connectedPlayers < 2 ? (next.hasOpponent ? SessionStatus.OPPONENT_DISCONNECTED : SessionStatus.WAITING) : SessionStatus.PLAYING);
      next.error = null;
      if (event.rematch) next.rematch = { requestedBy: null, accepted: false };
      break;
    case 'presence':
      next.connectedPlayers = event.connectedPlayers;
      if (event.connectedPlayers < 2) next.status = next.hasOpponent ? SessionStatus.OPPONENT_DISCONNECTED : SessionStatus.WAITING;
      else if (next.status === SessionStatus.WAITING || next.status === SessionStatus.OPPONENT_DISCONNECTED) {
        next.status = SessionStatus.PLAYING;
        next.hasOpponent = true;
      }
      break;
    case 'reconnecting':
      next.status = SessionStatus.RECONNECTING;
      break;
    case 'disconnected':
      next.status = next.roomId ? SessionStatus.RECONNECTING : SessionStatus.DISCONNECTED;
      break;
    case 'error':
      next.pendingCommandId = null;
      next.error = event.message || '联机请求失败';
      if (!event.recoverable) next.status = SessionStatus.ERROR;
      else if (state.status === SessionStatus.PENDING_MOVE) {
        next.status = state.connectedPlayers < 2 ? SessionStatus.WAITING : SessionStatus.PLAYING;
      } else if (!state.roomId) next.status = SessionStatus.DISCONNECTED;
      break;
    case 'rematch-status':
      next.rematch = { requestedBy: event.requestedBy, accepted: !!event.accepted };
      break;
    case 'reset':
      return createSessionState();
    default:
      return state;
  }
  return next;
}

export function sessionMessage(state, gameState) {
  if (state.error) return state.error;
  switch (state.status) {
    case SessionStatus.CONNECTING: return '正在连接服务器…';
    case SessionStatus.WAITING: return '房间 ' + (state.roomId || '') + ' · 等待另一位玩家加入';
    case SessionStatus.PENDING_MOVE: return '正在等待服务器确认落子…';
    case SessionStatus.OPPONENT_DISCONNECTED: return '对手已断线，正在等待重连';
    case SessionStatus.RECONNECTING: return '连接中断，正在尝试重连…';
    case SessionStatus.FINISHED: return '本局结束';
    case SessionStatus.ERROR: return state.error || '联机连接异常';
    case SessionStatus.PLAYING:
      if (gameState && gameState.turn !== state.player) return '房间 ' + state.roomId + ' · 等待对手落子';
      return '房间 ' + state.roomId + ' · 你执' + (state.player === 0 ? '黑' : '白');
    default: return '未连接';
  }
}
