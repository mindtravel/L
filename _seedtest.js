const R = require('./js/rules.js'), AI = require('./js/ai.js');
/* 统计：一局里双方各用掉几枚起笔（种子） */
for (const lv of [2, 3]) {
  let spent = [0, 0], games = 0, plies = 0, sumT = 0, worst = 0, n = 0;
  for (let g = 0; g < 12; g++) {
    const s = R.createGame(13, 13, 3);
    const used = [0, 0];
    let cnt = 0;
    while (s.winner == null && cnt < 300) {
      const t = Date.now();
      const m = AI.chooseAIMove(s, { level: lv });
      const dt = Date.now() - t; sumT += dt; n++; worst = Math.max(worst, dt);
      if (!m) break;
      if (m.isSeed) used[s.turn]++;
      R.applyMove(s, m); cnt++;
    }
    spent[0] += used[0]; spent[1] += used[1]; plies += cnt; games++;
  }
  console.log(`level${lv}: 平均每局黑用掉 ${(spent[0]/games).toFixed(2)} 枚、白 ${(spent[1]/games).toFixed(2)} 枚起笔（共 3 枚/人）；平均 ${(plies/games).toFixed(1)} 手，每手 ${(sumT/n).toFixed(0)}ms，最慢 ${worst}ms`);
}
