import { GameController } from './application/game-controller.mjs';
import { AiSession } from './application/ai-session.mjs';
import { GameEngine } from './application/game-engine.mjs';
import { InputController } from './application/input-controller.mjs';
import { SetupController } from './application/setup-controller.mjs';
import { createPresentationAdapter } from './presentation-adapter.mjs';
import { createHudView } from './presentation/hud-view.mjs';
import { OnlineSession } from './application/online-session.mjs';
import { sessionMessage } from './application/session-state.mjs';
import { WebSocketClient } from './infrastructure/websocket-client.mjs';
import { createBoard } from './board-view.mjs';
import * as rules from './rules.mjs';
import * as ai from './ai.mjs';
import { theme } from './theme.mjs';
import { createUtil } from './util.mjs';
import { createScheduler } from './scheduler.mjs';
import { createEffects } from './effects.mjs';
import { createAudio } from './audio.mjs';

const util = createUtil({ documentRef: document, windowRef: globalThis });
const scheduler = createScheduler(globalThis);
const effects = createEffects({ util, theme });
const audio = createAudio(globalThis);
const game = new GameEngine({ rules, util });
const board = createBoard({ game, util, theme, rules, effects, scheduler, documentRef: document, windowRef: globalThis });
let onlineSession = null;
const hud = createHudView({
  game,
  board,
  getOnlineState: () => onlineSession ? onlineSession.state() : null,
  theme,
  rules,
  util
});
const presentation = createPresentationAdapter({
  board,
  hud,
  effects,
  audio,
  scheduler,
  util,
  theme,
  rules
});
const transport = new WebSocketClient();
let lastNotice = null;
let controller = null;
onlineSession = new OnlineSession({
  transport,
  onState(snapshot, meta) {
    if (meta.player != null) game.setOnlinePlayer(meta.player);
    if (controller) controller.applyRemoteState(snapshot, meta);
    else game.applyOnlineState(snapshot, meta);
    const start = document.getElementById('startScreen');
    if (start) start.hidden = true;
    hud.refresh();
  },
  onStatus(session) {
    const status = document.getElementById('roomStatus');
    if (status) status.textContent = session.error || sessionMessage(session, game.state());
    const busy = session.status === 'connecting' || session.status === 'reconnecting' || session.status === 'pending-move';
    for (const id of ['btnCreateRoom', 'btnJoinRoom', 'btnJoinRoomConfirm', 'btnCancelJoin']) {
      const button = document.getElementById(id);
      if (button) button.disabled = busy;
    }
    hud.refresh();
    if (session.error && session.error !== lastNotice) hud.toast(session.error);
    lastNotice = session.error;
  }
});

const onlineApi = {
  create: size => onlineSession.create(size),
  join: id => onlineSession.join(id),
  move: (x, y, q) => onlineSession.move(x, y, q),
  reset: () => onlineSession.requestRematch(),
  requestRematch: () => onlineSession.requestRematch(),
  room: () => onlineSession.room(),
  player: () => onlineSession.player(),
  version: () => onlineSession.version(),
  state: () => onlineSession.state()
};

controller = new GameController({
  game,
  getMode: () => game.cfg.mode,
  getOnlineSession: () => onlineSession,
  feedback(message) {
    hud.toast(message);
    audio.bad();
  }
});

const input = new InputController({
  game,
  board,
  hud,
  controller,
  online: onlineApi,
  sfx: audio
});
const setup = new SetupController({ game, controller, online: onlineApi, hud });
presentation.setInput(input);
game.configure({ presentation });
const aiSession = new AiSession({ game, chooseMove: ai.chooseAIMove });
game.setStateObserver(() => aiSession.sync());
game.boot();
input.init();
setup.init();

globalThis.addEventListener('beforeunload', () => {
  aiSession.destroy();
  onlineSession.destroy();
}, { once: true });
