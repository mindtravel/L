/* =====================================================================
 * 直角 · 通用小工具
 * ---------------------------------------------------------------------
 *   $        取元素
 *   now()    统一时钟（必须与 requestAnimationFrame 的时间戳同源）
 *   clamp01 / easeOut / TAU
 *   reduced  系统是否开启了「减弱动态效果」
 * ===================================================================== */
export function createUtil({ documentRef = globalThis.document, windowRef = globalThis } = {}) {
  const PERF = windowRef.performance || globalThis.performance || null;
  return {
    TAU: Math.PI * 2,

    $: function (id) { return documentRef.getElementById(id); },

    now: function () { return PERF ? PERF.now() : Date.now(); },

    clamp01: function (u) { return u < 0 ? 0 : (u > 1 ? 1 : u); },

    easeOut: function (u) { return 1 - Math.pow(1 - u, 3); },

    reduced: !!(windowRef.matchMedia && windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches)
  };
}
