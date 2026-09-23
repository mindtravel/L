/*!
 * 直角 · 界面冒烟测试  (node test/ui.smoke.js)
 * ---------------------------------------------------------------------
 * 自带一套极简 DOM / Canvas 替身，然后按 index.html 里声明的顺序加载所有脚本，
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
function makeEl(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, children: [],
    textContent: '', value: '', checked: false, disabled: false, hidden: false,
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
    appendChild(c) { this.children.push(c); return c; },
    dispatch(type, ev) { (listeners[type] || []).forEach(fn => fn(ev)); },
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
  getElementById(id) { return els[id] || (els[id] = makeEl(id === 'board' ? 'canvas' : 'div')); },
  createElement(tag) { return makeEl(tag); },
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
};
let rafCb = null;
const windowStub = {
  devicePixelRatio: 1,
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
const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1]);

section('1. 资源清单（index.html 引用到的文件都得在）');
ok(srcs.length >= 8 && hrefs.length >= 3, '声明了 ' + srcs.length + ' 个脚本、' + hrefs.length + ' 张样式表');
let missing = [];
for (const f of srcs.concat(hrefs)) if (!fs.existsSync(path.join(ROOT, f))) missing.push(f);
ok(missing.length === 0, '所有引用的文件都存在' + (missing.length ? '：缺 ' + missing.join(', ') : ''));

section('2. 按声明顺序加载所有脚本');
let loadErr = null;
for (const f of srcs) {
  try { (0, eval)(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
  catch (e) { loadErr = new Error(f + ' → ' + e.message); break; }
}
ok(!loadErr, '全部脚本加载无异常' + (loadErr ? '：' + loadErr.message : ''));
if (loadErr) { console.log(loadErr.stack); process.exit(1); }

const ZJ = windowStub.ZJ;
ok(!!ZJ, '挂在 window.ZJ 命名空间下');
const MODS = ['rules', 'ai', 'theme', 'util', 'scheduler', 'fx', 'sfx', 'board', 'hud', 'input', 'game', 'online'];
const lost = MODS.filter(m => !ZJ || !ZJ[m]);
ok(lost.length === 0, '十个模块各就各位' + (lost.length ? '：缺 ' + lost.join(', ') : ''));
ok(typeof windowStub.VineRules === 'undefined' && typeof windowStub.VineAI === 'undefined',
   '旧的 VineRules / VineAI 全局名已清掉');

/* 便捷取用（等价于浏览器控制台里的写法） */
const R = ZJ.rules, AI = ZJ.ai, G = ZJ.game, B = ZJ.board, HUD = ZJ.hud;
const frame = (t) => { if (rafCb) rafCb(t === undefined ? performance.now() : t); };

section('3. 启动与渲染');
ZJ.game.cfg.overlayDelay = 0;                                  // 测试里不等终局动画
ok(!!G.state(), '启动后已有局面（模块会自动 boot）');
ok(G.state().W === 13 && G.state().H === 13, '默认棋盘为 13 × 13');
ok(els.turntext.textContent === '黑方回合', '状态栏显示「黑方回合」');
ok(/开局/.test(els.log.innerHTML || els.log.textContent) || els.log.children.length === 1, '着法区显示开局提示');

frame();
ok(ctxCalls.fillRect > 0 && ctxCalls.stroke > 0 && ctxCalls.strokeRect > 0 && ctxCalls.clearRect > 0,
   '画布完成一次绘制（铺底 / 格线 / 方框 / 清屏都有调用）');
ok(els.pipsRed.children.length === 3 && els.pipsBlue.children.length === 3, '双方各种子数渲染为 3 枚');
ok(els.cellRed.textContent === '0 格' && els.cellBlue.textContent === '0 格', '成格数初始为 0');
ok(!!els.chkSfx, '设置里有音效开关');

section('4. 鼠标点击落子（选点 → 选折角方向）');
/* 按 board.layout() 的公式算出格宽与边距（含环绕预览那一圈） */
const WRAP = ZJ.theme.wrap, BASE = 20;
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
ok(els.log.children.length === 0 || /开局/.test(els.log.innerHTML), '着法区回到开局提示');

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
ZJ.input.syncAxes();
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

console.log('\n=====================================');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
console.log('=====================================');
process.exit(failed ? 1 : 0);
