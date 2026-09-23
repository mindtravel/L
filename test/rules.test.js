/*!
 * 直角 · 规则自测  (node test/rules.test.js)
 */
'use strict';

const R = require('../js/rules.js');
const AI = require('../js/ai.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}
function section(t) { console.log('\n' + t); }
const key = (x, y) => x + ',' + y;

/* ---------------------------------------------------------------- */
section('1. 建局');
{
  const s = R.createGame(9, 9, 3);
  ok(s.W === 9 && s.H === 9, '棋盘 9x9');
  ok(s.h.length === 81 && s.v.length === 81, '线段数组尺寸正确（环面：每格点 4 条边，共 2×W×H）');
  ok(s.cell.length === 81 && s.cell.every(v => v === R.EMPTY), '方格初始为空');
  ok(s.seeds[0] === 3 && s.seeds[1] === 3, '双方各 3 次起笔');
  ok(s.turn === R.RED && s.winner === null, '黑先行、无胜者');
}

/* ---------------------------------------------------------------- */
section('2. 起笔：开局第一手与已有棋子不相接，消耗起笔');
{
  const s = R.createGame(9, 9, 3);
  const m = R.validateMove(s, 3, 3, 1);            // SE：右一格 + 下一格
  ok(!!m, '空格点可落子');
  ok(m && m.isSeed === true, '与任何棋子都不相接 → 判定为起笔');
  R.applyMove(s, m);
  ok(s.seeds[0] === 2, '黑方起笔 3 → 2');
  ok(R.edgeOwner(s, { kind: 'h', x: 3, y: 3 }) === R.RED, '横线段归属黑方');
  ok(R.edgeOwner(s, { kind: 'v', x: 3, y: 3 }) === R.RED, '竖线段归属黑方');
  ok(s.turn === R.BLUE, '轮到白方');
  ok(s.seedMarks.length === 1, '记录了一个起点');
}

/* ---------------------------------------------------------------- */
section('3. 不许重叠');
{
  const s = R.createGame(9, 9, 3);
  R.applyMove(s, R.validateMove(s, 3, 3, 1));       // 黑：h(3,3)+v(3,3)
  s.turn = R.RED;                                   // 强制黑再走，专测重叠
  ok(R.validateMove(s, 3, 3, 1) === null, '同一折角不能重复落');
  ok(R.validateMove(s, 3, 3, 0) === null, '共用 v(3,3) 的折角不能落');
  ok(R.validateMove(s, 4, 3, 2) === null, '共用 h(3,3) 的折角不能落');
  ok(R.validateMove(s, 5, 5, 1) !== null, '远处空位仍可落子');
}

/* ---------------------------------------------------------------- */
section('4. 续线：从自己的线上长出，不消耗起笔');
{
  const s = R.createGame(9, 9, 3);
  R.applyMove(s, R.validateMove(s, 3, 3, 1));       // 黑 h(3,3) v(3,3)
  s.turn = R.RED;
  const m = R.validateMove(s, 4, 3, 1);             // 角点 (4,3) 是黑方顶点
  ok(!!m && m.isSeed === false, '接在自己顶点上 → 续线');
  const before = s.seeds[0];
  R.applyMove(s, m);
  ok(s.seeds[0] === before, '续线不消耗起笔');
}

/* ---------------------------------------------------------------- */
section('5. 起笔 vs 续线，以及起笔耗尽');
{
  const s = R.createGame(9, 9, 3);
  s.turn = R.RED;
  const first = R.validateMove(s, 5, 5, 1);
  ok(first && first.isSeed === true, '空白处落子算起笔');
  R.applyMove(s, first);                            // 起笔 → 2
  s.turn = R.RED;

  const grow = R.validateMove(s, 6, 5, 1);          // 角点 (6,5) 是黑方顶点
  ok(grow && grow.isSeed === false, '接在自己线上 → 续线');
  const seedsBefore = s.seeds[0];
  R.applyMove(s, grow);
  ok(s.seeds[0] === seedsBefore, '续线不扣起笔');

  s.turn = R.RED;
  R.applyMove(s, R.validateMove(s, 7, 7, 1));       // 起笔 → 1
  s.turn = R.RED;
  R.applyMove(s, R.validateMove(s, 2, 7, 1));       // 起笔 → 0
  s.turn = R.RED;
  ok(s.seeds[0] === 0, '起笔已用尽');
  ok(R.validateMove(s, 0, 0, 1) === null, '没起笔就不许在不相接处开新头');
  ok(R.validateMove(s, 7, 5, 1) !== null, '没起笔时仍可从自己的线上长出');
}

/* ---------------------------------------------------------------- */
section('6. 交叉：允许与对方共享格点，但不许共用线段');
{
  const s = R.createGame(9, 9, 3);
  R.applyMove(s, R.validateMove(s, 3, 3, 1));       // 黑 h(3,3) v(3,3)
  s.turn = R.RED;
  R.applyMove(s, R.validateMove(s, 4, 3, 1));       // 黑再接一条
  s.turn = R.BLUE;
  s.seeds[1] = 5;
  ok(R.validateMove(s, 3, 3, 1) === null, '白方不能占用黑方已有线段');

  const t = R.createGame(9, 9, 3);
  t.turn = R.RED;
  R.applyMove(t, R.validateMove(t, 3, 3, 1));       // 黑 h(3,3) v(3,3)，顶点 (3,4)
  t.turn = R.BLUE;
  R.applyMove(t, R.validateMove(t, 3, 5, 1));       // 白起笔 h(3,5) v(3,5)
  t.turn = R.BLUE;
  const bm = R.validateMove(t, 3, 4, 1);            // 白 SE：h(3,4)+v(3,4)，在 (3,4) 与黑交叉
  ok(bm && bm.isSeed === false, '白可贴着黑方交叉续线（共享格点、不共享线段）');
  R.applyMove(t, bm);
  ok(R.edgeOwner(t, { kind: 'v', x: 3, y: 3 }) === R.RED &&
     R.edgeOwner(t, { kind: 'v', x: 3, y: 4 }) === R.BLUE, '交叉点上两条边分属黑白');
}

section('6b. 死边：所有折角都被占满时，线段再也放不下去');
{
  const s = R.createGame(9, 9, 3);
  // v(4,0) 的四种折角搭档：h(4,0)、h(3,0)（角点 (4,0)）与 h(4,1)、h(3,1)（角点 (4,1)）
  R.setEdgeOwner(s, { kind: 'h', x: 4, y: 0 }, R.RED);
  R.setEdgeOwner(s, { kind: 'h', x: 3, y: 0 }, R.RED);
  R.setEdgeOwner(s, { kind: 'h', x: 4, y: 1 }, R.RED);
  R.setEdgeOwner(s, { kind: 'h', x: 3, y: 1 }, R.BLUE);
  s.turn = R.RED;
  s.seeds[0] = 5;
  const covered = R.legalMoves(s).filter(m => m.edges.some(e => e.kind === 'v' && e.x === 4 && e.y === 0));
  ok(covered.length === 0, '搭档全被占满后 v(4,0) 无折角可放（死边）');
}

/* ---------------------------------------------------------------- */
section('7. 成格：四边同色即占格');
{
  const s = R.createGame(9, 9, 3);
  s.turn = R.RED;
  R.applyMove(s, R.validateMove(s, 0, 0, 1));       // h(0,0)+v(0,0)
  s.turn = R.RED;
  R.applyMove(s, R.validateMove(s, 1, 1, 3));       // NW：h(0,1)+v(1,0) → 围成 cell(0,0)
  ok(s.cell[R.cIdx(s, 0, 0)] === R.RED, 'cell(0,0) 归黑方');
  ok(R.countCells(s, R.RED) === 1, '黑方成格 1 格');
  ok(s.lastMove.claimed.length === 1, '本步成格数记录为 1');
}

/* ---------------------------------------------------------------- */
section('8. 胜负：横竖斜 4 连格');
{
  // 直接布置局面，专测 findWinLine
  for (const [name, cells, dx, dy] of [
    ['横向 4 连', [[0, 5], [1, 5], [2, 5], [3, 5]]],
    ['竖向 4 连', [[5, 0], [5, 1], [5, 2], [5, 3]]],
    ['斜向 4 连', [[1, 1], [2, 2], [3, 3], [4, 4]]],
    ['反斜 4 连', [[6, 1], [5, 2], [4, 3], [3, 4]]]
  ]) {
    const s = R.createGame(9, 9, 3);
    for (const [cx, cy] of cells) s.cell[R.cIdx(s, cx, cy)] = R.RED;
    const line = R.findWinLine(s, R.RED, [cells[3]]);
    ok(!!line && line.length === 4, name + '可被识别');
  }
  const s = R.createGame(9, 9, 3);
  s.cell[R.cIdx(s, 0, 0)] = R.RED; s.cell[R.cIdx(s, 1, 0)] = R.RED;
  s.cell[R.cIdx(s, 2, 0)] = R.RED; s.cell[R.cIdx(s, 3, 0)] = R.BLUE;
  ok(R.findWinLine(s, R.RED, [[2, 0]]) === null, '混入对方格子不算连成');
}

/* ---------------------------------------------------------------- */
section('9. 完整对局：AI 接力，规则始终自洽');
{
  const s = R.createGame(7, 7, 3);
  let plies = 0, consistent = true;
  while (s.winner == null && plies < 200) {
    const m = AI.chooseAIMove(s, { level: 2, random: Math.random });
    if (!m) break;
    const before = s.seeds.slice();
    const rec = R.applyMove(s, m);
    if (!rec) { consistent = false; break; }
    if (m.isSeed && s.seeds[rec.player] !== before[rec.player] - 1) consistent = false;
    if (R.edgeOwner(s, rec.edges[0]) !== rec.player ||
        R.edgeOwner(s, rec.edges[1]) !== rec.player) consistent = false;
    plies++;
  }
  ok(consistent, '每一手都合法：两条边归属正确、起笔正确扣次');
  ok(plies > 6, '对局能推进（' + plies + ' 手）');
  ok(s.winner !== null, '对局在有限手数内收束（winner=' + s.winner + '）');
  ok(s.winner === 'draw' || R.findWinLine(s, s.winner, null) !== null, '胜者的四格线真实存在');
  console.log('    → 终局：' + (s.winner === 'draw' ? '和棋' : R.playerName(s.winner) + '方胜') +
              '，黑成格 ' + R.countCells(s, R.RED) + ' 格，白成格 ' + R.countCells(s, R.BLUE) + ' 格');
}

/* ---------------------------------------------------------------- */
section('10. AI：必须抓住必胜着法');
{
  const s = R.createGame(9, 9, 3);
  s.cell[R.cIdx(s, 0, 0)] = R.RED;
  s.cell[R.cIdx(s, 1, 0)] = R.RED;
  s.cell[R.cIdx(s, 2, 0)] = R.RED;
  // 黑方已围出 cell(3,0) 的 3 条边，只差右边 v(4,0)
  R.setEdgeOwner(s, { kind: 'h', x: 3, y: 0 }, R.RED);
  R.setEdgeOwner(s, { kind: 'h', x: 3, y: 1 }, R.RED);
  R.setEdgeOwner(s, { kind: 'v', x: 3, y: 0 }, R.RED);
  s.turn = R.RED;
  const m = AI.chooseAIMove(s, { level: 3, random: () => 0.5 });
  const t = R.cloneState(s);
  R.applyMove(t, m, { skipDraw: true });
  ok(t.winner === R.RED, 'AI 补上第四边、连成四格获胜');
}

/* ---------------------------------------------------------------- */
section('11. AI：必须堵住对手的下一步必胜');
{
  const s = R.createGame(9, 9, 3);
  s.turn = R.RED;
  // 白方（对手）已有 cell(0,0..2) 三格，且 cell(3,0) 只差右边 v(4,0)
  s.cell[R.cIdx(s, 0, 0)] = R.BLUE;
  s.cell[R.cIdx(s, 1, 0)] = R.BLUE;
  s.cell[R.cIdx(s, 2, 0)] = R.BLUE;
  R.setEdgeOwner(s, { kind: 'h', x: 3, y: 0 }, R.BLUE);
  R.setEdgeOwner(s, { kind: 'h', x: 3, y: 1 }, R.BLUE);
  R.setEdgeOwner(s, { kind: 'v', x: 3, y: 0 }, R.BLUE);
  // 给黑方一条能碰到 v(4,0) 的线：黑已占 h(4,0)，故角点 (4,0) 是黑方顶点
  R.setEdgeOwner(s, { kind: 'h', x: 4, y: 0 }, R.RED);
  const m = AI.chooseAIMove(s, { level: 3, random: () => 0.5 });
  const t = R.cloneState(s);
  R.applyMove(t, m, { skipDraw: true });
  // 白方威胁是补上 cell(3,0) 的 v(4,0)。黑方可以抢占它，也可以把它变成"死边"。
  let blueCanStillWin = false;
  for (const om of R.legalMoves(t)) {
    const t2 = R.cloneState(t);
    R.applyMove(t2, om, { skipDraw: true });
    if (t2.winner === R.BLUE) { blueCanStillWin = true; break; }
  }
  ok(!blueCanStillWin, 'AI 拆掉了白方的下一步必胜（抢占或封死 v(4,0)）');
}

/* ---------------------------------------------------------------- */
section('12. 克隆不串味');
{
  const s = R.createGame(9, 9, 3);
  const t = R.cloneState(s);
  R.applyMove(t, R.validateMove(t, 2, 2, 1));
  ok(s.h.every(v => v === R.EMPTY) && s.seeds[0] === 3, '改动克隆体不影响原局面');
}

/* ---------------------------------------------------------------- */
section('13. 和棋：轮到的一方无折角可下');
{
  /* 3×3 棋盘连不出 4 连格，必定收于和棋 */
  for (let trial = 0; trial < 12; trial++) {
    const s = R.createGame(3, 3, 3);
    let plies = 0;
    while (s.winner == null && plies < 100) {
      const ms = R.legalMoves(s);
      if (!ms.length) break;
      R.applyMove(s, ms[(Math.random() * ms.length) | 0]);
      plies++;
    }
    ok(s.winner === R.DRAW, '3×3 第 ' + (trial + 1) + ' 局判和（' + plies + ' 手，winner=' + s.winner + '）');
    if (s.winner !== R.DRAW) break;
  }
  /* 换手后必须检查「下一位」有没有棋走 */
  const t = R.createGame(3, 3, 3);
  R.applyMove(t, R.validateMove(t, 1, 1, 1));
  ok(t.turn === R.BLUE && t.winner === null, '正常一手后换手且未误判和棋');
}

/* ---------------------------------------------------------------- */
section('14. 首尾相连：接缝两侧是连着的');
{
  const s = R.createGame(9, 9, 3);
  ok(s.torus === true, '建局标记为环面');
  s.turn = R.RED;
  R.applyMove(s, R.validateMove(s, 8, 4, 1));      // 红在右边缘：h(8,4) 直接连到 (0,4)
  ok(R.edgeOwner(s, { kind: 'h', x: 8, y: 4 }) === R.RED, 'h(8,4) 归属红方');
  s.turn = R.RED;
  const grow = R.validateMove(s, 0, 4, 1);          // 角点 (0,4) 落在接缝另一侧
  ok(grow && grow.isSeed === false, '可以从左边缘接着右边缘的线继续画（同一格点）');
  ok(R.vertexTouches(s, 0, 4, R.RED), '格点 (0,4) 上确实有红方的线');
}

section('15. 首尾相连：四格线可以跨过接缝');
{
  const s = R.createGame(9, 9, 3);
  for (const [cx, cy] of [[7, 3], [8, 3], [0, 3], [1, 3]]) s.cell[R.cIdx(s, cx, cy)] = R.RED;
  const line = R.findWinLine(s, R.RED, [[0, 3]]);
  ok(!!line && line.length === 4, '横向绕一圈的 4 连能被识别');
  ok(line.map(c => c.join(',')).sort().join(' ') === '0,3 1,3 7,3 8,3', '连的正是那 4 格');

  const t = R.createGame(9, 9, 3);
  for (const [cx, cy] of [[8, 8], [0, 0], [1, 1], [2, 2]]) t.cell[R.cIdx(t, cx, cy)] = R.BLUE;
  ok(!!R.findWinLine(t, R.BLUE, [[0, 0]]), '斜向跨过角落的 4 连能被识别');
}

/* ---------------------------------------------------------------- */
console.log('\n=====================================');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
console.log('=====================================');
process.exit(failed ? 1 : 0);
