import assert from 'node:assert/strict';
import { createSessionState, reduceSession, SessionStatus, sessionMessage } from '../js/application/session-state.mjs';
import { GameController } from '../js/application/game-controller.mjs';
import { AiSession } from '../js/application/ai-session.mjs';
import { isValidServerMessage, isValidSnapshot } from '../js/infrastructure/protocol.mjs';
import { WebSocketClient } from '../js/infrastructure/websocket-client.mjs';
import { OnlineSession } from '../js/application/online-session.mjs';

let state = createSessionState();
state = reduceSession(state, { type: 'room-created', roomId: 'ABCD', player: 0, version: 0, status: 'waiting' });
assert.equal(state.status, SessionStatus.WAITING);
state = reduceSession(state, { type: 'presence', connectedPlayers: 2 });
assert.equal(state.status, SessionStatus.PLAYING);
assert.equal(state.hasOpponent, true);
state = reduceSession(state, { type: 'move-pending', commandId: 'move-1' });
assert.equal(state.status, SessionStatus.PENDING_MOVE);
state = reduceSession(state, { type: 'error', message: '非法着法', recoverable: true });
assert.equal(state.status, SessionStatus.PLAYING);
assert.equal(state.pendingCommandId, null);
state = reduceSession(state, { type: 'presence', connectedPlayers: 1 });
assert.equal(state.status, SessionStatus.OPPONENT_DISCONNECTED);
let failedJoin = reduceSession(createSessionState(), { type: 'connecting' });
failedJoin = reduceSession(failedJoin, { type: 'error', message: '房间不存在', recoverable: true });
assert.equal(failedJoin.status, SessionStatus.DISCONNECTED);
assert.equal(sessionMessage(failedJoin), '房间不存在');

const messages = [];
const mockGame = {
  current: { turn: 1, winner: null },
  state() { return this.current; },
  isHumanTurn() { return true; },
  validateMove() { return { x: 2, y: 2, q: 0 }; },
  moveError() { return null; },
  tryMove() { this.localMoves = (this.localMoves || 0) + 1; },
  undo() {}, newGame() {}
};
let onlineState = { status: SessionStatus.PLAYING, player: 0, connectedPlayers: 2 };
const controller = new GameController({
  game: mockGame,
  getMode: () => 'online',
  getOnlineSession: () => ({
    state: () => onlineState,
    move: () => ({ ok: true, pending: true }),
    requestRematch: () => ({ ok: true })
  }),
  feedback: message => messages.push(message)
});

assert.equal(controller.requestMove(2, 2, 0).code, 'NOT_YOUR_TURN');
assert.match(messages.at(-1), /白方/);
const feedbackCount = messages.length;
assert.equal(controller.reportBoardAttempt().code, 'NOT_YOUR_TURN');
assert.equal(messages.length, feedbackCount, '连续点棋盘时重复的回合提示会节流');
onlineState = { ...onlineState, player: 1, status: SessionStatus.PENDING_MOVE };
assert.equal(controller.reportBoardAttempt().code, 'PENDING_MOVE');
onlineState = { ...onlineState, status: SessionStatus.WAITING, connectedPlayers: 1 };
assert.equal(controller.reportBoardAttempt().code, 'WAITING_FOR_PLAYER');
onlineState = { ...onlineState, status: SessionStatus.OPPONENT_DISCONNECTED, connectedPlayers: 1 };
assert.equal(controller.reportBoardAttempt().code, 'OPPONENT_DISCONNECTED');
onlineState = { ...onlineState, status: SessionStatus.PLAYING, connectedPlayers: 2 };
assert.deepEqual(controller.requestMove(2, 2, 0), { ok: true, pending: true });

let undonePlies = 0;
const undoGame = {
  history: () => [{ turn: 0 }, { turn: 1 }],
  players: () => ['human', 'ai'],
  undo: count => { undonePlies = count; }
};
const localController = new GameController({
  game: undoGame, getMode: () => 'pve', getOnlineSession: () => null
});
assert.equal(localController.requestUndo().ok, true);
assert.equal(undonePlies, 2);

let scheduled = null;
let delayed = 0;
let thinking = false;
let aiMoves = 0;
const aiGame = {
  cfg: { mode: 'pve', level: 2 },
  state: () => ({ turn: 1, winner: null }),
  players: () => ['human', 'ai'],
  thinking: () => thinking,
  setThinking: value => { thinking = value; },
  tryMove: () => { aiMoves++; }
};
const aiSession = new AiSession({
  game: aiGame,
  chooseMove: () => ({ x: 1, y: 2, q: 0 }),
  schedule: callback => { scheduled = callback; delayed++; return delayed; },
  cancel: () => {}
});
aiSession.sync();
assert.equal(thinking, true);
const runAi = scheduled;
runAi();
assert.equal(aiMoves, 1);
assert.equal(thinking, false);
aiSession.sync();
const staleAi = scheduled;
aiSession.cancel();
staleAi();
assert.equal(aiMoves, 1);
assert.equal(thinking, false);

const snapshot = {
  W: 13, H: 13, version: 0, turn: 0, winner: null, moveCount: 0,
  seeds: [3, 3], h: Array(169).fill(-1), v: Array(169).fill(-1), cell: Array(169).fill(-1),
  seedMarks: [], lastMove: null, winLine: null, records: []
};
assert.equal(isValidSnapshot(snapshot, 0), true);
assert.equal(isValidSnapshot({ ...snapshot, rulesVersion: 2 }, 0), false,
  '客户端拒绝未知规则快照版本');
assert.equal(isValidSnapshot({ ...snapshot, torus: false }, 0), false,
  '客户端拒绝非环面联机局面');
assert.equal(isValidServerMessage({ type: 'created', roomId: 'ABCDEF', player: 0, status: 'waiting', token: 'secret', state: snapshot }), true);
assert.equal(isValidSnapshot({ ...snapshot, seedMarks: [{ x: 3, y: 3, p: 0 }] }, 0), true,
  '合法的黑方种子标记应能通过快照校验');
assert.equal(isValidServerMessage({ type: 'presence', players: 3 }), false);
assert.equal(isValidSnapshot({ ...snapshot, h: ['<script>'] }, 0), false);

class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; FakeSocket.instance = this; }
  send(raw) { this.sent = raw; }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen(); }
  receive(data) { this.onmessage({ data }); }
}
const wsClient = new WebSocketClient({ WebSocketImpl: FakeSocket, locationRef: { protocol: 'https:', host: 'game.example' } });
const transportEvents = [];
wsClient.subscribe(event => transportEvents.push(event));
wsClient.connect();
assert.equal(FakeSocket.instance.url, 'wss://game.example');
FakeSocket.instance.open();
FakeSocket.instance.receive(JSON.stringify({ type: 'presence', players: 1 }));
FakeSocket.instance.receive(JSON.stringify({ type: 'presence', players: 9 }));
assert.equal(transportEvents.filter(event => event.type === 'message').length, 1);
assert.equal(transportEvents.filter(event => event.type === 'invalid-message').length, 1);
wsClient.close();

const throwingClient = new WebSocketClient({ WebSocketImpl: FakeSocket, locationRef: { protocol: 'http:', host: 'game.example' } });
const rejectedMessages = [];
throwingClient.subscribe(event => {
  if (event.type === 'message') throw new Error('subscriber failure');
  rejectedMessages.push(event.type);
});
throwingClient.connect();
FakeSocket.instance.open();
assert.throws(() => FakeSocket.instance.receive(JSON.stringify({ type: 'presence', players: 1 })), /subscriber failure/);
assert.equal(rejectedMessages.includes('invalid-message'), false,
  '应用订阅者异常不能被伪装成服务器协议错误');
throwingClient.close();

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
try {
  globalThis.setTimeout = function () {
    assert.equal(this, globalThis, '浏览器 setTimeout 以全局对象为接收者');
    return 1;
  };
  globalThis.clearTimeout = function () {
    assert.equal(this, globalThis, '浏览器 clearTimeout 以全局对象为接收者');
  };
  const timerSession = new OnlineSession({
    transport: { subscribe: () => () => {}, connect() {}, send: () => true, close() {} }
  });
  timerSession.session.roomId = 'ABCDEF';
  assert.doesNotThrow(() => timerSession.handleTransport({ type: 'close' }));
  assert.doesNotThrow(() => timerSession.destroy());
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}

const transportListeners = new Set();
const sentCommands = [];
const fakeTransport = {
  subscribe(listener) { transportListeners.add(listener); return () => transportListeners.delete(listener); },
  connect() {},
  send(command) { sentCommands.push(command); return true; },
  close() {},
  emit(event) { for (const listener of transportListeners) listener(event); }
};
const appliedSnapshots = [];
const onlineSession = new OnlineSession({
  transport: fakeTransport,
  storage: { getItem: () => null, setItem() {} },
  random: () => 0.5,
  onState: (state, meta) => appliedSnapshots.push({ state, meta })
});
onlineSession.create(15);
fakeTransport.emit({ type: 'open' });
assert.deepEqual(sentCommands.shift(), { type: 'create', size: 15 });
fakeTransport.emit({ type: 'message', message: {
  type: 'created', roomId: 'ABCDEF12', player: 0, status: 'waiting', token: 'token', state: { ...snapshot, W: 15, H: 15,
    h: Array(225).fill(-1), v: Array(225).fill(-1), cell: Array(225).fill(-1) }
} });
assert.equal(onlineSession.state().status, SessionStatus.WAITING);
fakeTransport.emit({ type: 'message', message: { type: 'presence', players: 2 } });
assert.equal(onlineSession.state().status, SessionStatus.PLAYING);
const pending = onlineSession.move(3, 3, 1);
assert.equal(pending.pending, true);
const moveCommand = sentCommands.shift();
assert.equal(moveCommand.version, 0);
assert.match(moveCommand.commandId, /^[a-z0-9]+-1$/);
assert.equal(onlineSession.state().status, SessionStatus.PENDING_MOVE);
assert.equal(onlineSession.move(4, 4, 2).code, 'PENDING_MOVE');
const movedSnapshot = { ...snapshot, moveCount: 1, turn: 1, version: 1 };
fakeTransport.emit({ type: 'message', message: { type: 'moveAccepted', version: 1, state: movedSnapshot, move: { x: 3, y: 3, q: 1 } } });
assert.equal(onlineSession.state().status, SessionStatus.PLAYING);
assert.equal(onlineSession.version(), 1);
const snapshotsAfterMove = appliedSnapshots.length;
fakeTransport.emit({ type: 'message', message: { type: 'sync', version: 0, state: snapshot } });
assert.equal(appliedSnapshots.length, snapshotsAfterMove, '旧版本局面不会覆盖新状态');
onlineSession.destroy();

console.log('Session and command tests: passed');
