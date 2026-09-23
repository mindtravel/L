/* L 联机服务：静态文件 + WebSocket 房间。
 * 服务端持有唯一规则状态，客户端只能提交 move 命令。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const rules = require('./js/rules.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8000);
const rooms = new Map();

function roomId() {
  return crypto.randomBytes(4).toString('base64url').toUpperCase();
}

function playerToken() { return crypto.randomBytes(18).toString('base64url'); }

function publicState(room) {
  const s = room.state;
  return {
    W: s.W, H: s.H, turn: s.turn, winner: s.winner,
    moveCount: s.moveCount, seeds: s.seeds,
    h: Array.from(s.h), v: Array.from(s.v), cell: Array.from(s.cell),
    seedMarks: s.seedMarks, winLine: s.winLine, lastMove: s.lastMove,
    version: room.version, records: room.records
  };
}

function send(ws, type, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload) {
  for (const player of room.players) if (player && player.ws) send(player.ws, type, payload);
  for (const viewer of room.viewers) send(viewer, type, payload);
}

function joinRoom(ws, id, reconnectToken) {
  const room = rooms.get(String(id || '').toUpperCase());
  if (!room) return send(ws, 'error', { code: 'ROOM_NOT_FOUND', message: '房间不存在' });
  const returning = room.players.find(player => player && player.token === reconnectToken && !player.ws);
  const slot = returning ? returning.slot : (room.players[0] ? (room.players[1] ? -1 : 1) : 0);
  if (slot < 0) return send(ws, 'error', { code: 'ROOM_FULL', message: '房间已满' });
  const token = returning ? returning.token : playerToken();
  room.players[slot] = { ws, slot, token };
  ws.room = room; ws.slot = slot;
  send(ws, 'joined', { roomId: room.id, player: slot, token, status: room.players[0] && room.players[0].ws && room.players[1] && room.players[1].ws ? 'playing' : 'waiting', state: publicState(room) });
  broadcast(room, 'presence', { players: room.players.filter(player => player && player.ws).length });
}

function createRoom(ws, requestedSize) {
  let id;
  do id = roomId(); while (rooms.has(id));
  const size = [13, 15, 17, 19, 21].includes(Number(requestedSize)) ? Number(requestedSize) : 13;
  const room = { id, state: rules.createGame(size, size, 3), records: [], version: 0, players: [], viewers: [] };
  rooms.set(id, room);
  const token = playerToken();
  room.players[0] = { ws, slot: 0, token };
  ws.room = room; ws.slot = 0;
  send(ws, 'created', { roomId: id, player: 0, token, status: 'waiting', state: publicState(room) });
}

function handle(ws, msg) {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'create') return createRoom(ws, msg.size);
  if (msg.type === 'join') return joinRoom(ws, msg.roomId, msg.token);
  const room = ws.room;
  if (!room) return send(ws, 'error', { code: 'NOT_IN_ROOM', message: '请先创建或加入房间' });
  if (msg.type === 'state') return send(ws, 'state', { version: room.version, state: publicState(room) });
  if (msg.type === 'reset') {
    if (ws.slot !== 0) return send(ws, 'error', { code: 'FORBIDDEN', message: '只有房主可以重开' });
    room.state = rules.createGame(room.state.W, room.state.H, room.state.seedsPerPlayer);
    room.records = [];
    room.version += 1;
    return broadcast(room, 'state', { version: room.version, state: publicState(room) });
  }
  if (msg.type !== 'move') return;
  if (room.state.winner != null) return send(ws, 'error', { code: 'GAME_OVER', message: '本局已经结束' });
  if (!room.players[0] || !room.players[1]) return send(ws, 'error', { code: 'WAITING_FOR_PLAYER', message: '等待另一位玩家加入' });
  if (room.state.turn !== ws.slot) return send(ws, 'error', { code: 'NOT_YOUR_TURN', message: '还没轮到你' });
  if (Number(msg.version) !== room.version) return send(ws, 'sync', { version: room.version, state: publicState(room) });
  const move = rules.validateMove(room.state, Number(msg.x), Number(msg.y), Number(msg.q));
  if (!move) return send(ws, 'error', { code: 'ILLEGAL_MOVE', message: '这一步不合法' });
  const record = rules.applyMove(room.state, move);
  room.records.push(record);
  room.version += 1;
  broadcast(room, 'moveAccepted', { version: room.version, move: record, state: publicState(room) });
}

function serve(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.resolve(ROOT, '.' + requested);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serve);
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.on('message', raw => { try { handle(ws, JSON.parse(raw)); } catch (_) { send(ws, 'error', { code: 'BAD_MESSAGE', message: '消息格式错误' }); } });
  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    if (ws.slot != null && room.players[ws.slot] && room.players[ws.slot].ws === ws) room.players[ws.slot].ws = null;
    room.viewers = room.viewers.filter(viewer => viewer !== ws);
    broadcast(room, 'presence', { players: room.players.filter(player => player && player.ws).length });
    if (!room.players.some(player => player && player.ws) && !room.viewers.length) {
      setTimeout(() => { if (rooms.get(room.id) === room && !room.players.some(player => player && player.ws)) rooms.delete(room.id); }, 30 * 60 * 1000);
    }
  });
});
server.listen(PORT, () => console.log(`L server listening on http://localhost:${PORT}`));
