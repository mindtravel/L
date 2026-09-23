import { isValidServerMessage } from './protocol.mjs';

export class WebSocketClient {
  constructor({ WebSocketImpl = globalThis.WebSocket, locationRef = globalThis.location, url = null } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.location = locationRef;
    this.url = url || this.defaultUrl();
    this.socket = null;
    this.generation = 0;
    this.listeners = new Set();
  }

  defaultUrl() {
    const protocol = this.location && this.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return protocol + '//' + (this.location ? this.location.host : 'localhost:8000');
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  connect() {
    if (!this.WebSocketImpl) throw new Error('当前浏览器不支持联机');
    if (this.socket && this.socket.readyState <= 1) return;
    const generation = ++this.generation;
    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;
    socket.onopen = () => { if (generation === this.generation) this.emit({ type: 'open' }); };
    socket.onmessage = event => {
      if (generation !== this.generation) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) { this.emit({ type: 'invalid-message' }); }
      if (message === undefined) return;
      if (!isValidServerMessage(message)) return this.emit({ type: 'invalid-message' });
      this.emit({ type: 'message', message });
    };
    socket.onerror = () => { if (generation === this.generation) this.emit({ type: 'error' }); };
    socket.onclose = () => { if (generation === this.generation) this.emit({ type: 'close' }); };
  }

  isOpen() { return !!this.socket && this.socket.readyState === 1; }

  send(message) {
    if (!this.isOpen()) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.generation++;
    if (this.socket && this.socket.readyState < 2) this.socket.close();
    this.socket = null;
  }
}
