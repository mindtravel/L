import assert from 'node:assert/strict';
import * as rules from '../js/rules.mjs';
import { SNAPSHOT_VERSION, toSnapshot, fromSnapshot } from '../js/application/game-snapshot.mjs';

const state = rules.createGame(13, 13, 3);
const snapshot = toSnapshot(state, { version: 7, records: [] });

assert.equal(snapshot.rulesVersion, SNAPSHOT_VERSION);
assert.equal(snapshot.version, 7);
assert.equal(snapshot.seedsPerPlayer, 3);
assert.equal(snapshot.torus, true);
assert.ok(Array.isArray(snapshot.h) && Array.isArray(snapshot.v) && Array.isArray(snapshot.cell));
assert.ok(!(snapshot.h instanceof Int8Array), 'transport snapshot must use JSON arrays');

const hydrated = fromSnapshot(snapshot, rules);
assert.equal(hydrated.W, state.W);
assert.equal(hydrated.H, state.H);
assert.equal(hydrated.version, 7);
assert.deepEqual(Array.from(hydrated.h), Array.from(state.h));
assert.deepEqual(hydrated.seeds, state.seeds);

snapshot.seedMarks.push({ x: 1, y: 1, p: 0 });
snapshot.records.push({ x: 1, y: 1, q: 0, player: 0, isSeed: true, edges: [], claimed: [] });
assert.equal(state.seedMarks.length, 0, '修改快照不会污染规则状态的种子标记');
assert.equal(state.lastMove, null, '快照记录与规则状态不共享引用');

const movedState = rules.createGame(13, 13, 3);
rules.applyMove(movedState, rules.validateMove(movedState, 2, 2, 1));
const movedSnapshot = toSnapshot(movedState, { version: 8, records: [movedState.lastMove] });
movedSnapshot.lastMove.edges[0].x = 99;
movedSnapshot.records[0].claimed.push([9, 9]);
assert.equal(movedState.lastMove.edges[0].x, 2, '快照中的着法边对象与规则状态隔离');
assert.equal(movedState.lastMove.claimed.length, 0, '快照中的成格记录与规则状态隔离');

const incoming = toSnapshot(movedState, { version: 9, records: [movedState.lastMove] });
const restored = fromSnapshot(incoming, rules);
incoming.lastMove.edges[0].x = 88;
incoming.records[0].claimed.push([8, 8]);
assert.equal(restored.lastMove.edges[0].x, 2, '恢复局面不会共享输入快照的着法');
assert.equal(restored.lastMove.claimed.length, 0, '恢复局面不会共享输入快照的成格记录');

assert.throws(() => fromSnapshot({ ...snapshot, rulesVersion: SNAPSHOT_VERSION + 1 }, rules), /rules snapshot version/);
console.log('Game snapshot tests: passed');
