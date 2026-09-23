/* =====================================================================
 * 直角 · 特效队列
 * ---------------------------------------------------------------------
 * 这里只管「什么时候播什么」—— 每条特效是一份纯数据（k 决定画法），
 * 具体怎么画在 board.js 里。四种：
 *
 *   edge   线段从角点折出来     {sx,sy,ex,ey,p}
 *   ring   扩散的圈             {x,y,p,r0,r1,w}
 *   glow   一格亮起             {cx,cy,p}
 *   spark  终局粒子             {x,y,vx,vy,p,size}
 *
 * 系统开了「减弱动态效果」时 add() 直接丢弃，什么都不播。
 * ===================================================================== */
export function createEffects({ util, theme, random = Math.random }) {
  const fx = {
    list: [],
    winPulseUntil: 0,          // 终局高亮画到什么时候（由 board 读）

    add: function (e) {
      if (util.reduced) return null;
      e.t0 = util.now();
      e.delay = e.delay || 0;
      this.list.push(e);
      return e;
    },

    clear: function () {
      this.list.length = 0;
      this.winPulseUntil = 0;
    },

    step: function (t) {
      var out = [];
      for (var i = 0; i < this.list.length; i++) {
        var e = this.list[i];
        if (t - e.t0 - e.delay < e.dur) out.push(e);
      }
      this.list = out;
    },

    /* 进度：0..1，还没轮到它出场时为负 */
    u: function (e, t) { return (t - e.t0 - e.delay) / e.dur; },

    alive: function () { return this.list.length > 0; },

    /* ---------------- 构造器 ---------------- */

    /* 刚落下的一步：两条线段从角点长出来 */
    edgeGrow: function (rec) {
      for (var i = 0; i < rec.edges.length; i++) {
        var e = rec.edges[i], from = (rec.x === e.x && rec.y === e.y);
        var far = (e.kind === 'h')
          ? (from ? [e.x + 1, e.y] : [e.x, e.y])
          : (from ? [e.x, e.y + 1] : [e.x, e.y]);
        fx.add({
          k: 'edge', sx: rec.x, sy: rec.y, ex: far[0], ey: far[1],
          p: rec.player, dur: theme.dur.edge
        });
      }
    },

    /* 起笔：起点扩散一圈涟漪 */
    seedRing: function (x, y, p) {
      fx.add({
        k: 'ring', x: x, y: y, p: p,
        r0: 0.10, r1: 0.62, w: 0.04, dur: theme.dur.seedRing
      });
    },

    /* 连成四格：四格依次亮起 + 一把粒子 */
    winBurst: function (line, p) {
      var i;
      for (i = 0; i < line.length; i++) {
        fx.add({
          k: 'ring', x: line[i][0] + 0.5, y: line[i][1] + 0.5, p: p,
          r0: 0.2, r1: 1.25, w: 0.04, dur: 780, delay: i * 95
        });
        fx.add({
          k: 'glow', cx: line[i][0], cy: line[i][1], p: p,
          dur: theme.dur.glow, delay: i * 95
        });
      }
      if (!util.reduced) {
        var TAU = util.TAU;
        for (var j = 0; j < 18; j++) {
          var c = line[j % line.length];
          var a = random() * TAU, sp = 0.5 + random() * 1.4;
          fx.add({
            k: 'spark',
            x: c[0] + 0.5 + (random() - 0.5) * 0.6,
            y: c[1] + 0.5 + (random() - 0.5) * 0.6,
            vx: Math.cos(a) * sp * 0.35, vy: Math.sin(a) * sp * 0.35 - 0.5,
            p: p, size: 0.022 + random() * 0.022,
            dur: theme.dur.sparks + random() * 700,
            delay: random() * 320
          });
        }
      }
      this.winPulseUntil = util.now() + theme.dur.winPulse;
    }
  };
  return fx;
}
