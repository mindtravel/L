import { createSessionState, reduceSession, SessionStatus } from './session-state.mjs';

export class OnlineSession {
  constructor({ transport, onState = () => {}, onStatus = () => {}, storage,
    schedule = (...args) => globalThis.setTimeout(...args),
    cancel = (...args) => globalThis.clearTimeout(...args), random = Math.random }) {
    this.transport = transport;
    this.onState = onState;
    this.onStatus = onStatus;
    this.schedule = schedule;
    this.cancelTimer = cancel;
    try { this.storage = storage === undefined ? globalThis.sessionStorage : storage; }
    catch (_) { this.storage = null; }
    this.session = createSessionState();
    this.queuedCommand = null;
    this.reconnectTimer = null;
    this.commandSequence = 0;
    this.commandSession = random().toString(36).slice(2, 10);
    this.unsubscribe = transport.subscribe(event => this.handleTransport(event));
  }

  state() { return { ...this.session, rematch: { ...this.session.rematch } }; }
  room() { return this.session.roomId; }
  player() { return this.session.player; }
  version() { return this.session.version; }

  transition(event) {
    this.session = reduceSession(this.session, event);
    this.onStatus(this.state());
  }

  create(size) {
    this.transition({ type: 'connecting' });
    this.queuedCommand = { type: 'create', size: Number(size) || 13 };
    try { this.transport.connect(); } catch (error) { this.transition({ type: 'error', message: error.message }); }
  }

  join(id) {
    const roomId = String(id || '').trim().toUpperCase();
    if (!roomId) {
      this.transition({ type: 'error', message: '请输入房间号', recoverable: true });
      return;
    }
    let token = null;
    try { token = this.storage && this.storage.getItem('l-room-' + roomId); } catch (_) {}
    this.transition({ type: 'connecting' });
    this.queuedCommand = { type: 'join', roomId, token: token || undefined };
    try { this.transport.connect(); } catch (error) { this.transition({ type: 'error', message: error.message }); }
  }

  move(x, y, q) {
    if (this.session.status === SessionStatus.PENDING_MOVE) return { ok: false, code: 'PENDING_MOVE' };
    if (this.session.status !== SessionStatus.PLAYING) return { ok: false, code: 'SESSION_NOT_PLAYING' };
    const commandId = this.commandSession + '-' + (++this.commandSequence);
    const command = { type: 'move', x, y, q, version: this.session.version, commandId };
    if (!this.transport.send(command)) {
      this.transition({ type: 'disconnected' });
      return { ok: false, code: 'DISCONNECTED' };
    }
    this.transition({ type: 'move-pending', commandId });
    return { ok: true, pending: true };
  }

  requestRematch() {
    if (!this.session.roomId) return { ok: false, code: 'NOT_IN_ROOM' };
    if (!this.transport.send({ type: 'rematch' })) return { ok: false, code: 'DISCONNECTED' };
    return { ok: true, pending: true };
  }

  handleTransport(event) {
    if (event.type === 'open') {
      if (this.queuedCommand) {
        const command = this.queuedCommand;
        this.queuedCommand = null;
        this.transport.send(command);
      } else if (this.session.roomId && this.session.player != null) {
        this.transition({ type: 'reconnecting' });
        let token = null;
        try { token = this.storage && this.storage.getItem('l-room-' + this.session.roomId); } catch (_) {}
        this.transport.send({ type: 'join', roomId: this.session.roomId, token: token || undefined });
      }
      return;
    }
    if (event.type === 'close') {
      if (this.session.roomId) this.scheduleReconnect();
      this.transition({ type: 'disconnected' });
      return;
    }
    if (event.type === 'error') {
      this.transition({ type: 'error', message: '连接服务器失败', recoverable: true });
      return;
    }
    if (event.type === 'invalid-message') {
      this.transition({ type: 'error', message: '服务器消息格式错误', recoverable: true });
      return;
    }
    if (event.type === 'message') this.handleMessage(event.message);
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      this.transition({ type: 'reconnecting' });
      try { this.transport.connect(); } catch (error) { this.transition({ type: 'error', message: error.message, recoverable: true }); }
    }, 1200);
  }

  handleMessage(message) {
    if (message.roomId) this.session.roomId = message.roomId;
    if (message.token && message.roomId) {
      try { this.storage && this.storage.setItem('l-room-' + message.roomId, message.token); } catch (_) {}
    }
    if (message.type === 'created' || message.type === 'joined') {
      this.cancelReconnect();
      this.transition({ type: message.type === 'created' ? 'room-created' : 'room-joined', roomId: message.roomId,
        player: message.player, version: message.state.version, status: message.status,
        connectedPlayers: message.status === 'playing' ? 2 : 1 });
      this.onState(message.state, { initial: true, version: message.state.version, player: message.player, roomId: message.roomId });
      return;
    }
    if (message.type === 'moveAccepted' || message.type === 'state' || message.type === 'sync') {
      if (message.version != null && message.version < this.session.version) return;
      this.transition({ type: 'state-applied', version: message.version, finished: message.state && message.state.winner != null, rematch: message.rematch });
      this.onState(message.state, { version: message.version, move: message.move });
      return;
    }
    if (message.type === 'presence') {
      this.transition({ type: 'presence', connectedPlayers: message.players });
      return;
    }
    if (message.type === 'rematchStatus') {
      this.transition({ type: 'rematch-status', requestedBy: message.requestedBy, accepted: message.accepted });
      return;
    }
    if (message.type === 'error') {
      this.transition({ type: 'error', message: message.message || '联机请求失败', recoverable: true });
    }
  }

  cancelReconnect() {
    this.cancelTimer(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  destroy() {
    this.cancelTimer(this.reconnectTimer);
    this.unsubscribe();
    this.transport.close();
  }
}
