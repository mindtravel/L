/* =====================================================================
 * 直角 · 通用小工具
 * ---------------------------------------------------------------------
 *   $        取元素
 *   now()    统一时钟（必须与 requestAnimationFrame 的时间戳同源）
 *   clamp01 / easeOut / TAU
 *   reduced  系统是否开启了「减弱动态效果」
 * ===================================================================== */
(function (root) {
  'use strict';

  var ZJ = root.ZJ = root.ZJ || {};

  var PERF = root.performance || (typeof performance !== 'undefined' ? performance : null);

  ZJ.util = {
    TAU: Math.PI * 2,

    $: function (id) { return document.getElementById(id); },

    now: function () { return PERF ? PERF.now() : Date.now(); },

    clamp01: function (u) { return u < 0 ? 0 : (u > 1 ? 1 : u); },

    easeOut: function (u) { return 1 - Math.pow(1 - u, 3); },

    reduced: !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)
  };
})(typeof window !== 'undefined' ? window : globalThis);
