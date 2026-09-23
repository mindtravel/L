import assert from 'node:assert/strict';
import { SetupController } from '../js/application/setup-controller.mjs';

function element(id) {
  const listeners = new Map();
  return {
    id,
    value: '',
    hidden: ['levelLabel', 'selLevel', 'roomControls', 'joinRoomForm'].includes(id),
    disabled: false,
    textContent: '',
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    focus() { this.focused = true; },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) {
        handler({ currentTarget: this, target: this, preventDefault() {}, ...event });
      }
    }
  };
}

const elements = new Map();
const documentRef = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  }
};
const calls = [];
const game = { cfg: { mode: 'pvp', size: 13, level: 2 } };
const controller = { requestNewGame: () => calls.push(['start']) };
const online = {
  create: size => calls.push(['create', size]),
  join: id => calls.push(['join', id])
};
const hud = { refresh: () => calls.push(['refresh']) };
const setup = new SetupController({ game, controller, online, hud, documentRef });
setup.init();

const byId = id => documentRef.getElementById(id);
const selectMode = mode => {
  byId('selMode').value = mode;
  byId('selMode').dispatch('change');
};

assert.equal(byId('roomControls').hidden, true, 'local mode hides room actions');
assert.equal(byId('btnStartGame').hidden, false, 'local mode keeps the start action');
assert.equal(byId('selLevel').hidden, true, 'local mode hides AI strength');

selectMode('pve');
assert.equal(game.cfg.mode, 'pve');
assert.equal(byId('selLevel').hidden, false, 'AI mode exposes AI strength');
assert.equal(byId('roomControls').hidden, true, 'AI mode does not expose room actions');
byId('selLevel').value = '3';
byId('selLevel').dispatch('change');
assert.equal(game.cfg.level, 3, 'AI strength updates game configuration');

selectMode('online');
assert.equal(byId('roomControls').hidden, false, 'online mode exposes room actions');
assert.equal(byId('roomChoice').hidden, false, 'online mode first asks create or join');
assert.equal(byId('joinRoomForm').hidden, true, 'room number is hidden until join is selected');
assert.equal(byId('btnStartGame').hidden, true, 'online mode does not start a local game');
byId('btnCreateRoom').dispatch('click');
assert.deepEqual(calls.find(call => call[0] === 'create'), ['create', 13]);

byId('btnJoinRoom').dispatch('click');
assert.equal(byId('roomChoice').hidden, true);
assert.equal(byId('joinRoomForm').hidden, false);
assert.equal(byId('roomIdInput').focused, true);
byId('roomIdInput').value = ' ab12cd ';
byId('roomIdInput').dispatch('keydown', { key: 'Enter' });
assert.deepEqual(calls.find(call => call[0] === 'join'), ['join', 'ab12cd']);
byId('btnCancelJoin').dispatch('click');
assert.equal(byId('roomChoice').hidden, false);
assert.equal(byId('joinRoomForm').hidden, true);

selectMode('pvp');
assert.equal(byId('roomControls').hidden, true, 'returning to local mode hides room actions');
assert.equal(byId('btnStartGame').hidden, false);
byId('btnStartGame').dispatch('click');
assert.equal(byId('startScreen').hidden, true);
assert.equal(calls.filter(call => call[0] === 'start').length, 1);

console.log('Setup controller tests: passed');
