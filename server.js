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

function publicState(room) {
  const s = room.state;
  return {
    W: s.W, H: s.H, turn: s.turn, winner: s.winner,
    moveCount: s.moveCount, seeds: s.seeds,
    h: Array.from(s.h), v: Array.from(s.v), cell: Array.from(s.cell),
    seedMarks: s.seedMarks, winLine: s.winLine, lastMove: s.lastMove
  };
}

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload) {
  for (const player of room.players) if (player) send(player.ws, type, payload);
  for (const viewer of room.viewers) send(viewer, type, payload);
}

function joinRoom(ws, id) {
  const room = rooms.get(String(id || '').toUpperCase());
  if (!room) return send(ws, 'error', { code: 'ROOM_NOT_FOUND', message: '房间不存在' });
  const slot = room.players[0] ? (room.players[1] ? -1 : 1) : 0;
  if (slot < 0) return send(ws, 'error', { code: 'ROOM_FULL', message: '房间已满' });
  room.players[slot] = { ws, slot };
  ws.room = room; ws.slot = slot;
  send(ws, 'joined', { roomId: room.id, player: slot, state: publicState(room) });
  broadcast(room, 'presence', { players: room.players.map(Boolean).length });
}

function createRoom(ws) {
  let id;
  do id = roomId(); while (rooms.has(id));
  const room = { id, state: rules.createGame(13, 13, 3), players: [], viewers: [] };
  rooms.set(id, room);
  room.players[0] = { ws, slot: 0 };
  ws.room = room; ws.slot = 0;
  send(ws, 'created', { roomId: id, player: 0, state: publicState(room) });
}

function handle(ws, msg) {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'create') return createRoom(ws);
  if (msg.type === 'join') return joinRoom(ws, msg.roomId);
  const room = ws.room;
  if (!room) return send(ws, 'error', { code: 'NOT_IN_ROOM', message: '请先创建或加入房间' });
  if (msg.type === 'state') return send(ws, 'state', { state: publicState(room) });
  if (msg.type === 'reset') {
    if (ws.slot !== 0) return send(ws, 'error', { code: 'FORBIDDEN', message: '只有房主可以重开' });
    room.state = rules.createGame(room.state.W, room.state.H, room.state.seedsPerPlayer);
    return broadcast(room, 'state', { state: publicState(room) });
  }
  if (msg.type !== 'move') return;
  if (room.state.winner != null) return send(ws, 'error', { code: 'GAME_OVER', message: '本局已经结束' });
  if (room.state.turn !== ws.slot) return send(ws, 'error', { code: 'NOT_YOUR_TURN', message: '还没轮到你' });
  const move = rules.validateMove(room.state, Number(msg.x), Number(msg.y), Number(msg.q));
  if (!move) return send(ws, 'error', { code: 'ILLEGAL_MOVE', message: '这一步不合法' });
  const record = rules.applyMove(room.state, move);
  broadcast(room, 'move', { move: record, state: publicState(room) });
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
    if (ws.slot != null) room.players[ws.slot] = null;
    room.viewers = room.viewers.filter(viewer => viewer !== ws);
    broadcast(room, 'presence', { players: room.players.map(Boolean).length });
    if (!room.players.some(Boolean) && !room.viewers.length) rooms.delete(room.id);
  });
});
server.listen(PORT, () => console.log(`L server listening on http://localhost:${PORT}`));
