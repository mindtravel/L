'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const port = 18999;
const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) } });
let output = '';
child.stdout.on('data', chunk => { output += chunk; });

function waitFor(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + type)), 4000);
    function onMessage(raw) {
      const msg = JSON.parse(raw);
      if (msg.type !== type) return;
      clearTimeout(timer); ws.off('message', onMessage); resolve(msg);
    }
    ws.on('message', onMessage);
  });
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + port + pathname, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject);
  });
}

async function main() {
  const { isValidServerMessage } = await import('../js/infrastructure/protocol.mjs');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start: ' + output)), 4000);
    const check = () => { if (output.includes('listening')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', check); child.on('error', reject);
  });
  const page = await get('/');
  assert.strictEqual(page.status, 200);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.strictEqual((await get('/package.json')).status, 404);
  const a = new WebSocket('ws://127.0.0.1:' + port);
  const b = new WebSocket('ws://127.0.0.1:' + port);
  await Promise.all([new Promise(r => a.once('open', r)), new Promise(r => b.once('open', r))]);
  const invalidRoom = waitFor(b, 'error');
  b.send(JSON.stringify({ type: 'join', roomId: '<script>' }));
  assert.strictEqual((await invalidRoom).code, 'INVALID_ROOM_ID');
  a.send(JSON.stringify({ type: 'create', size: 15 }));
  const created = await waitFor(a, 'created');
  assert.strictEqual(isValidServerMessage(created), true, 'created 响应满足客户端协议');
  assert.strictEqual(created.state.W, 15);
  b.send(JSON.stringify({ type: 'join', roomId: created.roomId }));
  const joined = await waitFor(b, 'joined');
  assert.strictEqual(isValidServerMessage(joined), true, 'joined 响应满足客户端协议');
  assert.strictEqual(joined.player, 1);
  const reconnectToken = joined.token;

  const wrongTurn = waitFor(b, 'error');
  b.send(JSON.stringify({ type: 'move', x: 3, y: 3, q: 1, version: 0, commandId: 'client-b-early' }));
  assert.strictEqual((await wrongTurn).code, 'NOT_YOUR_TURN');
  const malformedMove = waitFor(a, 'error');
  a.send(JSON.stringify({ type: 'move', x: '3', y: 3, q: 1, version: 0, commandId: 'client-a-bad' }));
  assert.strictEqual((await malformedMove).code, 'BAD_COMMAND');

  const acceptedA = waitFor(a, 'moveAccepted');
  const acceptedB = waitFor(b, 'moveAccepted');
  const firstMove = { type: 'move', x: 3, y: 3, q: 1, version: 0, commandId: 'client-a-1' };
  a.send(JSON.stringify(firstMove));
  const [moveA, moveB] = await Promise.all([acceptedA, acceptedB]);
  assert.strictEqual(isValidServerMessage(moveA), true, '包含首枚种子和历史记录的落子响应满足客户端协议');
  assert.strictEqual(isValidServerMessage(moveB), true, '广播给对手的落子响应满足客户端协议');
  assert.strictEqual(moveA.version, 1);
  assert.strictEqual(moveB.state.moveCount, 1);
  assert.strictEqual(moveB.state.records.length, 1);
  const duplicate = waitFor(a, 'sync');
  a.send(JSON.stringify(firstMove));
  const duplicateSync = await duplicate;
  assert.strictEqual(duplicateSync.duplicate, true);
  assert.strictEqual(duplicateSync.state.moveCount, 1);

  b.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  const reconnected = new WebSocket('ws://127.0.0.1:' + port);
  await new Promise(resolve => reconnected.once('open', resolve));
  reconnected.send(JSON.stringify({ type: 'join', roomId: created.roomId, token: reconnectToken }));
  const rejoined = await waitFor(reconnected, 'joined');
  assert.strictEqual(rejoined.player, 1);
  assert.strictEqual(rejoined.state.moveCount, 1);

  reconnected.send(JSON.stringify({ type: 'move', x: 4, y: 3, q: 1, version: 1, commandId: 'client-b-1' }));
  const move2 = await waitFor(a, 'moveAccepted');
  assert.strictEqual(move2.version, 2);
  assert.strictEqual(isValidServerMessage(move2), true, '接触对手的种子着法广播仍满足客户端协议');
  assert.strictEqual(move2.state.records.length, 2);
  assert.strictEqual(move2.move.isSeed, true, '与对手共用格点的独立起笔仍是种子着法');
  assert.strictEqual(move2.state.seeds[1], 2, '接触对手的种子着法消耗一枚种子');

  const requestA = waitFor(a, 'rematchStatus');
  const requestB = waitFor(reconnected, 'rematchStatus');
  a.send(JSON.stringify({ type: 'rematch' }));
  const [statusA, statusB] = await Promise.all([requestA, requestB]);
  assert.strictEqual(statusA.accepted, true);
  assert.strictEqual(statusB.players.length, 1);

  const resetA = waitFor(a, 'state');
  const resetB = waitFor(reconnected, 'state');
  reconnected.send(JSON.stringify({ type: 'rematch' }));
  const [resetStateA, resetStateB] = await Promise.all([resetA, resetB]);
  assert.strictEqual(resetStateA.state.moveCount, 0);
  assert.strictEqual(resetStateA.state.records.length, 0);
  assert.strictEqual(resetStateB.version, 3);
  a.close(); reconnected.close(); child.kill();
  console.log('WebSocket integration: passed');
}

main().catch(err => { console.error(err.stack || err); child.kill(); process.exitCode = 1; });
