/* L 联机服务：静态文件 + WebSocket 房间。
 * 服务端持有唯一规则状态，客户端只能提交 move 命令。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as rules from './js/rules.mjs';
import { toSnapshot } from './js/application/game-snapshot.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8000);
const rooms = new Map();

function roomId() {
  return crypto.randomBytes(6).toString('base64url').toUpperCase();
}

function playerToken() { return crypto.randomBytes(18).toString('base64url'); }

function publicState(room) {
  return toSnapshot(room.state, { version: room.version, records: room.records });
}

function send(ws, type, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload) {
  for (const player of room.players) if (player && player.ws) send(player.ws, type, payload);
  for (const viewer of room.viewers) send(viewer, type, payload);
}

function joinRoom(ws, id, reconnectToken) {
  const roomIdInput = typeof id === 'string' ? id.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{6,8}$/.test(roomIdInput)) return send(ws, 'error', { code: 'INVALID_ROOM_ID', message: '房间号格式不正确' });
  if (ws.room) return send(ws, 'error', { code: 'ALREADY_IN_ROOM', message: '请先离开当前房间' });
  const room = rooms.get(roomIdInput);
  if (!room) return send(ws, 'error', { code: 'ROOM_NOT_FOUND', message: '房间不存在' });
  const validReconnectToken = typeof reconnectToken === 'string' && reconnectToken.length <= 64 ? reconnectToken : '';
  const returning = room.players.find(player => player && player.token === validReconnectToken && !player.ws);
  const slot = returning ? returning.slot : (room.players[0] ? (room.players[1] ? -1 : 1) : 0);
  if (slot < 0) return send(ws, 'error', { code: 'ROOM_FULL', message: '房间已满' });
  const token = returning ? returning.token : playerToken();
  room.players[slot] = { ws, slot, token };
  ws.room = room; ws.slot = slot;
  send(ws, 'joined', { roomId: room.id, player: slot, token, status: room.players[0] && room.players[0].ws && room.players[1] && room.players[1].ws ? 'playing' : 'waiting', state: publicState(room) });
  broadcast(room, 'presence', { players: room.players.filter(player => player && player.ws).length });
}

function createRoom(ws, requestedSize) {
  if (ws.room) return send(ws, 'error', { code: 'ALREADY_IN_ROOM', message: '请先离开当前房间' });
  let id;
  do id = roomId(); while (rooms.has(id));
  const size = [13, 15, 17, 19, 21].includes(Number(requestedSize)) ? Number(requestedSize) : 13;
  const room = { id, state: rules.createGame(size, size, 3), records: [], version: 0, players: [], viewers: [], rematchRequests: new Set(), commandIds: [new Set(), new Set()] };
  rooms.set(id, room);
  const token = playerToken();
  room.players[0] = { ws, slot: 0, token };
  ws.room = room; ws.slot = 0;
  send(ws, 'created', { roomId: id, player: 0, token, status: 'waiting', state: publicState(room) });
}

function handle(ws, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
    return send(ws, 'error', { code: 'BAD_MESSAGE', message: '消息格式错误' });
  }
  if (msg.type === 'create') return createRoom(ws, msg.size);
  if (msg.type === 'join') return joinRoom(ws, msg.roomId, msg.token);
  const room = ws.room;
  if (!room) return send(ws, 'error', { code: 'NOT_IN_ROOM', message: '请先创建或加入房间' });
  if (msg.type === 'state') return send(ws, 'state', { version: room.version, state: publicState(room) });
  if (msg.type === 'reset') {
    return send(ws, 'error', { code: 'REMATCH_REQUIRED', message: '联机重开需要双方确认，请重新申请' });
  }
  if (msg.type === 'rematch') {
    if (ws.slot == null || !room.players[0] || !room.players[1] || !room.players[0].ws || !room.players[1].ws) {
      return send(ws, 'error', { code: 'WAITING_FOR_PLAYER', message: '等待另一位玩家加入' });
    }
    if (room.rematchRequests.has(ws.slot)) room.rematchRequests.delete(ws.slot);
    else room.rematchRequests.add(ws.slot);
    broadcast(room, 'rematchStatus', {
      requestedBy: room.rematchRequests.size ? [...room.rematchRequests][0] : null,
      accepted: room.rematchRequests.size > 0,
      players: [...room.rematchRequests]
    });
    if (room.rematchRequests.size === 2) {
      room.state = rules.createGame(room.state.W, room.state.H, room.state.seedsPerPlayer);
      room.records = [];
      room.version += 1;
      room.rematchRequests.clear();
      broadcast(room, 'state', { version: room.version, state: publicState(room), rematch: true });
    }
    return;
  }
  if (msg.type !== 'move') return;
  const commandId = typeof msg.commandId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(msg.commandId) ? msg.commandId : null;
  if (!commandId || !Number.isInteger(msg.x) || !Number.isInteger(msg.y) || !Number.isInteger(msg.q) ||
      !Number.isInteger(msg.version)) {
    return send(ws, 'error', { code: 'BAD_COMMAND', message: '落子命令格式错误' });
  }
  if (ws.slot == null || !room.players[ws.slot] || room.players[ws.slot].ws !== ws) {
    return send(ws, 'error', { code: 'NOT_A_PLAYER', message: '只有房间玩家可以落子' });
  }
  if (commandId && ws.slot != null && room.commandIds[ws.slot].has(commandId)) {
    return send(ws, 'sync', { version: room.version, state: publicState(room), duplicate: true });
  }
  if (room.state.winner != null) return send(ws, 'error', { code: 'GAME_OVER', message: '本局已经结束' });
  if (!room.players[0] || !room.players[1]) return send(ws, 'error', { code: 'WAITING_FOR_PLAYER', message: '等待另一位玩家加入' });
  if (room.state.turn !== ws.slot) return send(ws, 'error', { code: 'NOT_YOUR_TURN', message: '还没轮到你' });
  if (msg.version !== room.version) return send(ws, 'sync', { version: room.version, state: publicState(room) });
  const move = rules.validateMove(room.state, msg.x, msg.y, msg.q);
  if (!move) return send(ws, 'error', { code: 'ILLEGAL_MOVE', message: '这一步不合法' });
  const record = rules.applyMove(room.state, move);
  if (commandId && ws.slot != null) {
    const commands = room.commandIds[ws.slot];
    commands.add(commandId);
    if (commands.size > 128) commands.delete(commands.values().next().value);
  }
  room.records.push(record);
  room.version += 1;
  broadcast(room, 'moveAccepted', { version: room.version, move: record, state: publicState(room) });
}

function serve(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.writeHead(405, { ...securityHeaders(), Allow: 'GET, HEAD' }).end();
  }
  let requested;
  try { requested = new URL(req.url, 'http://localhost').pathname; }
  catch (_) { return res.writeHead(400).end(); }
  if (requested === '/') requested = '/index.html';
  const file = path.resolve(ROOT, '.' + requested);
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) return res.writeHead(403).end();
  const publicFile = relative === 'index.html' ||
    relative.startsWith('css' + path.sep) && path.extname(relative) === '.css' ||
    relative.startsWith('js' + path.sep) && path.extname(relative) === '.mjs';
  if (!publicFile) return res.writeHead(404, securityHeaders()).end('Not found');
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404, securityHeaders()).end('Not found');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    res.writeHead(200, { ...securityHeaders(), 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
}

const server = http.createServer(serve);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  ws.on('message', raw => { try { handle(ws, JSON.parse(raw)); } catch (_) { send(ws, 'error', { code: 'BAD_MESSAGE', message: '消息格式错误' }); } });
  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    if (ws.slot != null && room.players[ws.slot] && room.players[ws.slot].ws === ws) room.players[ws.slot].ws = null;
    if (ws.slot != null && room.rematchRequests.delete(ws.slot)) {
      broadcast(room, 'rematchStatus', {
        requestedBy: room.rematchRequests.size ? [...room.rematchRequests][0] : null,
        accepted: room.rematchRequests.size > 0,
        players: [...room.rematchRequests]
      });
    }
    room.viewers = room.viewers.filter(viewer => viewer !== ws);
    broadcast(room, 'presence', { players: room.players.filter(player => player && player.ws).length });
    if (!room.players.some(player => player && player.ws) && !room.viewers.length) {
      setTimeout(() => { if (rooms.get(room.id) === room && !room.players.some(player => player && player.ws)) rooms.delete(room.id); }, 30 * 60 * 1000);
    }
  });
});
server.listen(PORT, () => console.log(`L server listening on http://localhost:${PORT}`));
