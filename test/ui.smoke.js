/*!
 * 直角 · 界面冒烟测试  (node test/ui.smoke.js)
 * ---------------------------------------------------------------------
 * 自带一套极简 DOM / Canvas 替身，然后装配真实 ES Modules，
 * 检查初始化、点击落子、悔棋、整局推进、终局遮罩、渲染调度是否都不炸。
 *
 * 脚本清单直接从 index.html 里读，所以两边不会走散。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- 极简 Canvas 2D 替身 ---------------- */
const ctxCalls = {};
const gradient = { addColorStop() {} };
const ctx = new Proxy({}, {
  get(t, p) {
    if (p in t) return t[p];
    if (/^create/.test(String(p))) {
      return function () { ctxCalls[p] = (ctxCalls[p] || 0) + 1; return gradient; };
    }
    return function () { ctxCalls[p] = (ctxCalls[p] || 0) + 1; };
  },
  set(t, p, v) { t[p] = v; return true; }
});

/* ---------------- 极简 DOM 替身 ---------------- */
function makeEl(tag, id) {
  const listeners = {};
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, children: [],
    textContent: '', value: '', checked: false, disabled: false,
    hidden: ['levelLabel', 'selLevel', 'roomControls', 'joinRoomForm', 'overlay', 'btnCopyRoom'].includes(String(id)),
    className: '', width: 0, height: 0,
    clientWidth: 520, clientHeight: 520,
    classList: {
      _s: new Set(),
      add() { for (const c of arguments) this._s.add(c); },
      remove() { for (const c of arguments) this._s.delete(c); },
      toggle(c, f) { const on = (f === undefined) ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    focus() {},
    appendChild(c) { this.children.push(c); return c; },
    dispatch(type, ev) {
      const event = Object.assign({ target: this, currentTarget: this, preventDefault() {} }, ev || {});
      (listeners[type] || []).forEach(fn => fn.call(this, event));
    },
    getContext() { return ctx; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 520, height: 520, right: 520, bottom: 520 }; }
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = String(v); if (v === '') el.children = []; }
  });
  return el;
}

const els = {};
const documentStub = {
  _listeners: {},
  getElementById(id) { return els[id] || (els[id] = makeEl(id === 'board' ? 'canvas' : 'div', id)); },
  createElement(tag) { return makeEl(tag); },
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
};
let rafCb = null;
const windowStub = {
  devicePixelRatio: 1,
  navigator: { clipboard: { writeText: async value => { windowStub.copiedText = value; } } },
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  requestAnimationFrame(cb) { rafCb = cb; return 1; },   // 浏览器里 window 自带
  cancelAnimationFrame() {}
};

global.window = windowStub;
global.document = documentStub;
global.requestAnimationFrame = windowStub.requestAnimationFrame;
global.cancelAnimationFrame = windowStub.cancelAnimationFrame;

/* ---------------- 按 index.html 的声明顺序加载 ---------------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
const moduleSrcs = [...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map(m => m[1]);
const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1]).filter(href => !href.startsWith('data:'));

section('1. 资源清单（index.html 引用到的文件都得在）');
ok(srcs.length === 0 && moduleSrcs.length === 1 && hrefs.length >= 3,
   '声明了 ' + srcs.length + ' 个经典脚本、' + moduleSrcs.length + ' 个 ES Module 入口、' + hrefs.length + ' 张样式表');
let missing = [];
for (const f of srcs.concat(moduleSrcs, hrefs)) if (!fs.existsSync(path.join(ROOT, f))) missing.push(f);
ok(missing.length === 0, '所有引用的文件都存在' + (missing.length ? '：缺 ' + missing.join(', ') : ''));

async function run() {
const { InputController } = await import('../js/application/input-controller.mjs');
const { SetupController } = await import('../js/application/setup-controller.mjs');
const { GameController } = await import('../js/application/game-controller.mjs');
const { GameEngine } = await import('../js/application/game-engine.mjs');
const { createPresentationAdapter } = await import('../js/presentation-adapter.mjs');
const { createHudView } = await import('../js/presentation/hud-view.mjs');
const [{ createBoard }, R, AI, { theme }, { createUtil }, { createScheduler }, { createEffects }, { createAudio }] = await Promise.all([
  import('../js/board-view.mjs'), import('../js/rules.mjs'), import('../js/ai.mjs'),
  import('../js/theme.mjs'), import('../js/util.mjs'), import('../js/scheduler.mjs'),
  import('../js/effects.mjs'), import('../js/audio.mjs')
]);
const util = createUtil({ documentRef: documentStub, windowRef: windowStub });
const scheduler = createScheduler(windowStub);
const effects = createEffects({ util, theme, random: () => 0.5 });
const audio = createAudio(windowStub);
const modules = { rules: R, ai: AI, theme, util, scheduler, fx: effects, sfx: audio };
ok(windowStub.ZJ === undefined, '运行模块不向 window.ZJ 注册全局');
ok(Object.keys(modules).length === 7, '渲染与规则依赖均由模块实例提供');
ok(typeof GameEngine === 'function', '局面引擎由 ES Module 导出');
ok(moduleSrcs[0] === 'js/main.mjs', '联机与命令入口由 ES Modules 组装');
ok(typeof windowStub.VineRules === 'undefined' && typeof windowStub.VineAI === 'undefined', '不暴露旧规则 / AI 全局名');

/* 便捷取用（等价于浏览器控制台里的写法） */
const G = new GameEngine({ rules: R, util: modules.util });
const B = createBoard({ game: G, util: modules.util, theme: modules.theme, rules: R, effects: modules.fx,
  scheduler: modules.scheduler, documentRef: documentStub, windowRef: windowStub });
let fakeHudOnlineState = null;
const HUD = createHudView({
  game: G, board: B, getOnlineState: () => fakeHudOnlineState || { status: 'disconnected' }, theme: modules.theme,
  rules: R, util: modules.util, documentRef: documentStub
});
const frame = (t) => { if (rafCb) rafCb(t === undefined ? performance.now() : t); };
ok(G.state() === null, '创建模块实例时不会提前启动对局');
const controller = new GameController({
  game: G,
  getMode: () => G.cfg.mode,
  getOnlineSession: () => null,
  feedback: message => HUD.toast(message)
});
const presentation = createPresentationAdapter({
  board: B, hud: HUD, effects: modules.fx, audio: modules.sfx, scheduler: modules.scheduler,
  util: modules.util, theme: modules.theme, rules: R, documentRef: documentStub
});
const input = new InputController({
  game: G, board: B, hud: HUD, controller,
  online: { create() {}, join() {}, room: () => 'ABCDEF12' }, sfx: modules.sfx,
  documentRef: documentStub, windowRef: windowStub
});
const setup = new SetupController({ game: G, controller, online: { create() {}, join() {} }, hud: HUD,
  documentRef: documentStub });
presentation.setInput(input);
G.configure({ presentation });
G.boot();
input.init();
setup.init();

section('3. 启动与渲染');
G.cfg.overlayDelay = 0;                                         // 测试里不等终局动画
ok(!!G.state(), '组合应用并显式 boot 后已有局面');
ok(G.state().W === 13 && G.state().H === 13, '默认棋盘为 13 × 13');
ok(els.turntext.textContent === '黑方回合', '状态栏显示「黑方回合」');
ok(/开局/.test(els.log.innerHTML || els.log.textContent) || els.log.children.length === 1, '着法区显示开局提示');

frame();
ok(ctxCalls.fillRect > 0 && ctxCalls.stroke > 0 && ctxCalls.strokeRect > 0 && ctxCalls.clearRect > 0,
   '画布完成一次绘制（铺底 / 格线 / 方框 / 清屏都有调用）');
ok(els.pipsRed.children.length === 3 && els.pipsBlue.children.length === 3, '双方各种子数渲染为 3 枚');
ok(els.cellRed.textContent === '0 格' && els.cellBlue.textContent === '0 格', '成格数初始为 0');
ok(!!els.chkSfx, '设置里有音效开关');
documentStub.getElementById('roomControls').hidden = true; // The stub does not parse HTML attributes.
ok(/id="roomControls"[^>]*hidden/.test(html), '普通对弈模式隐藏房间操作');
ok(documentStub.getElementById('btnStartGame').hidden === false, '普通对弈模式保留开始按钮');
const initialGameState = G.state();
const sizeSetting = documentStub.getElementById('selSize');
sizeSetting.value = '15';
sizeSetting.dispatch('change', { target: sizeSetting });
ok(G.state() === initialGameState, '更改棋盘设置不会在按「开始」前重置对局');
sizeSetting.value = '13';
sizeSetting.dispatch('change', { target: sizeSetting });

section('4. 鼠标点击落子（选点 → 选折角方向）');
/* 按 board.layout() 的公式算出格宽与边距（含环绕预览那一圈） */
const WRAP = modules.theme.wrap, BASE = 20;
const boardW = G.state().W;
const cell = Math.max(16, Math.min(56, Math.floor((Math.min(520, 680) - BASE * 2) / (boardW + WRAP * 2))));
const pad = BASE + Math.round(cell * WRAP);
const V = (a, b) => ({ clientX: pad + a * cell, clientY: pad + b * cell, button: 0, pointerId: 1, preventDefault() {} });
const tap = (a, b) => canvasEl.dispatch('pointerdown', V(a, b));   // 点一下 = 选点 / 落子

const canvasEl = B.canvas();
tap(3, 3);
ok(G.state().moveCount === 0, '选中操作本身不落子');
frame();
ok(ctxCalls.setLineDash > 0 && typeof ctx.lineDashOffset === 'number',
   '四个待选折角画成了流动虚线（蚂蚁线）');

tap(3.6, 3.6);                                                 // 右下方 → SE 折角
ok(G.state().moveCount === 1, '点击后确实落下一手');
ok(G.state().seeds[0] === 2, '首手为起笔，黑方起笔 3 → 2');
ok(els.pipsRed.children.filter(s => s.classList.contains('pop')).length === 1, '用掉的起笔播放分离动画');
ok(R.edgeOwner(G.state(), { kind: 'h', x: 3, y: 3 }) === R.RED &&
   R.edgeOwner(G.state(), { kind: 'v', x: 3, y: 3 }) === R.RED, '两条线段归属黑方');
ok(els.log.children.length === 1, '着法记录新增一条');
ok(els.log.children[0].classList.contains('new'), '新记录带入场动画标记');
ok(els.turntext.textContent === '白方回合', '轮到白方');
frame();
ok(ctxCalls.arc > 0, '落子后起笔涟漪（圆弧）被绘制');

section('5. 悔棋');
els.btnUndo.dispatch('click', {});
ok(G.state().moveCount === 0 && G.state().seeds[0] === 3, '悔棋回到开局状态');
ok(els.log.children.length === 0 || /开局/.test(els.log.children[0].textContent), '着法区回到开局提示');

section('6. 换接缝：两根滚动轴（环面上换个观察原点）');
els.axisX.value = 4;
els.axisX.dispatch('input', {});
ok(B.view().x === 4, '横向轴把观察原点挪到 4');
els.axisY.value = 2;
els.axisY.dispatch('input', {});
ok(B.view().x === 4 && B.view().y === 2, '纵向轴独立：x 仍是 4，y 变成 2');
ok(G.state().moveCount === 0, '换接缝不会落子');
ok(els.axisXVal.textContent === 4 && els.axisYVal.textContent === 2, '轴旁边显示当前格号');

/* 挪过原点后，画布左上角那个格点应该对应挪过去的逻辑格点 */
tap(0, 0);
ok(!!B.selected() && B.selected().x === 4 && B.selected().y === 2,
   '落点跟着原点走：视觉 (0,0) → 逻辑 (4,2)');
B.select(null);
frame();
ok(ctxCalls.fillRect > 0, '挪过原点后照样能画');
B.setView(0, 0);
input.syncAxes();
ok(B.view().x === 0 && B.view().y === 0 && els.axisX.value === 0, '轴能回到 0');

section('7. 整局推进（AI 代打，逐手校验渲染）');
let plies = 0, renderErr = null;
try {
  while (G.state().winner == null && plies < 300) {
    const m = AI.chooseAIMove(G.state(), { level: 2 });
    if (!m) break;
    G.tryMove(m.x, m.y, m.q);
    frame();
    plies++;
  }
  frame();
} catch (e) { renderErr = e; }
ok(!renderErr, '整局推进 ' + plies + ' 手且无异常' + (renderErr ? '：' + renderErr.message : ''));
ok(G.state().winner != null, '对局分出胜负：' + G.state().winner);
ok(els.overlay.hidden === false, '终局遮罩已弹出');
ok(!!els.ovTitle.textContent, '终局标题：' + els.ovTitle.textContent + ' / ' + els.ovSub.textContent);
ok(G.state().winner === 'draw' || R.findWinLine(G.state(), G.state().winner, null) !== null,
   '胜者的四格线真实存在');

section('8. 动画调度：闲时不空转，有事才重绘');
const future = performance.now() + 20000;
frame(future);
const before = ctxCalls.fillRect;
frame(future); frame(future); frame(future);
ok(ctxCalls.fillRect === before, '静止时不再重复绘制（省电）');

section('9. 再来一局');
els.ovAgain.dispatch('click', {});
ok(G.state().moveCount === 0 && G.state().winner === null, '重开后局面清空');
ok(els.overlay.hidden === true, '遮罩关闭');
frame();
ok(ctxCalls.fillRect > before, '重开后重新绘制');

section('10. 模式选择显隐联机操作');
const mode = documentStub.getElementById('selMode');
ok(els.selLevel.hidden === true, '普通双人模式隐藏 AI 强度');
mode.value = 'pve';
mode.dispatch('change', { target: mode });
ok(els.selLevel.hidden === false, '人机模式显示 AI 强度');
ok(els.roomControls.hidden === true, '非联机模式不显示房间入口');
ok(/人机 · 执黑 · 强度 2/.test(els.sessionMeta.textContent), '进入人机模式后对局信息显示 AI 强度');
mode.value = 'online';
mode.dispatch('change', { target: mode });
ok(documentStub.getElementById('roomControls').hidden === false, '选择联机模式后显示房间操作');
ok(els.hintline.textContent === '选择创建房间或加入房间', '未连接时提示玩家先选择房间操作');
ok(documentStub.getElementById('btnStartGame').hidden === true, '联机模式隐藏普通开始按钮');
ok(els.roomChoice.hidden === false && els.joinRoomForm.hidden === true, '联机下先选择创建或加入，加入表单默认收起');
fakeHudOnlineState = { status: 'playing', roomId: 'ABCDEF12', player: 0, connectedPlayers: 2 };
HUD.refresh();
ok(/联机对弈.*房间 ABCDEF12.*黑方/.test(els.sessionMeta.textContent), '联机对局信息持续显示模式、房间号和执方');
ok(els.btnCopyRoom.hidden === false, '进入联机房间后显示复制房间号操作');
els.btnCopyRoom.dispatch('click', {});
await Promise.resolve();
ok(windowStub.copiedText === 'ABCDEF12', '复制操作写入当前房间号');
fakeHudOnlineState = null;
HUD.refresh();
els.btnJoinRoom.dispatch('click', {});
ok(els.joinRoomForm.hidden === false, '选择加入房间后才显示房间号输入');
els.btnCancelJoin.dispatch('click', {});
ok(els.joinRoomForm.hidden === true, '可以返回创建 / 加入选择');
mode.value = 'pvp';
mode.dispatch('change', { target: mode });
ok(documentStub.getElementById('roomControls').hidden === true, '切回本地模式后隐藏房间操作');
ok(els.btnCopyRoom.hidden === true, '切回本地模式后隐藏复制房间号操作');
ok(documentStub.getElementById('btnStartGame').hidden === false, '切回本地模式后恢复开始按钮');

section('11. 联机权限：非己方回合点击棋盘会反馈但不落子');
const permissionMessages = [];
const lockedController = new GameController({
  game: G,
  getMode: () => 'online',
  getOnlineSession: () => ({ state: () => ({ status: 'playing', player: 1, connectedPlayers: 2 }) }),
  feedback: message => permissionMessages.push(message)
});
const lockedInput = new InputController({ game: G, board: B, hud: HUD, controller: lockedController,
  online: {}, sfx: modules.sfx, documentRef: documentStub, windowRef: windowStub });
const moveCountBeforeLockedClick = G.state().moveCount;
const pointerEvent = { button: 0, preventDefault() {} };
lockedInput.onPointerDown(pointerEvent);
lockedInput.onPointerDown(pointerEvent);
ok(G.state().moveCount === moveCountBeforeLockedClick, '非己方回合点击不会落子');
ok(permissionMessages.length === 1 && /黑方/.test(permissionMessages[0]), '棋盘点击报告当前轮到黑方，重复提示会节流');

console.log('\n=====================================');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
console.log('=====================================');
process.exit(failed ? 1 : 0);
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
