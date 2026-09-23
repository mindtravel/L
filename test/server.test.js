'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const port = 18999;
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) } });
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

async function main() {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start: ' + output)), 4000);
    const check = () => { if (output.includes('listening')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', check); child.on('error', reject);
  });
  const a = new WebSocket('ws://127.0.0.1:' + port);
  const b = new WebSocket('ws://127.0.0.1:' + port);
  await Promise.all([new Promise(r => a.once('open', r)), new Promise(r => b.once('open', r))]);
  a.send(JSON.stringify({ type: 'create', size: 15 }));
  const created = await waitFor(a, 'created');
  assert.strictEqual(created.state.W, 15);
  b.send(JSON.stringify({ type: 'join', roomId: created.roomId }));
  const joined = await waitFor(b, 'joined');
  assert.strictEqual(joined.player, 1);
  const reconnectToken = joined.token;

  const acceptedA = waitFor(a, 'moveAccepted');
  const acceptedB = waitFor(b, 'moveAccepted');
  a.send(JSON.stringify({ type: 'move', x: 3, y: 3, q: 1, version: 0 }));
  const [moveA, moveB] = await Promise.all([acceptedA, acceptedB]);
  assert.strictEqual(moveA.version, 1);
  assert.strictEqual(moveB.state.moveCount, 1);
  assert.strictEqual(moveB.state.records.length, 1);

  b.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  const reconnected = new WebSocket('ws://127.0.0.1:' + port);
  await new Promise(resolve => reconnected.once('open', resolve));
  reconnected.send(JSON.stringify({ type: 'join', roomId: created.roomId, token: reconnectToken }));
  const rejoined = await waitFor(reconnected, 'joined');
  assert.strictEqual(rejoined.player, 1);
  assert.strictEqual(rejoined.state.moveCount, 1);

  reconnected.send(JSON.stringify({ type: 'move', x: 5, y: 5, q: 1, version: 1 }));
  const move2 = await waitFor(a, 'moveAccepted');
  assert.strictEqual(move2.version, 2);
  assert.strictEqual(move2.state.records.length, 2);

  const reset = waitFor(reconnected, 'state');
  a.send(JSON.stringify({ type: 'reset' }));
  const resetState = await reset;
  assert.strictEqual(resetState.state.moveCount, 0);
  assert.strictEqual(resetState.state.records.length, 0);
  a.close(); reconnected.close(); child.kill();
  console.log('WebSocket integration: passed');
}

main().catch(err => { console.error(err.stack || err); child.kill(); process.exitCode = 1; });
