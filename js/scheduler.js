/* 直角 · 渲染调度器：唯一负责 requestAnimationFrame。 */
(function (root) {
  'use strict';
  var ZJ = root.ZJ = root.ZJ || {}, handle = 0, running = false, source = null;
  function frame(t) {
    handle = 0;
    if (!source) return;
    source(t);
    if (running) handle = root.requestAnimationFrame(frame);
  }
  ZJ.scheduler = {
    install: function (fn) { source = fn; },
    wake: function () { if (!handle && source) { running = true; handle = root.requestAnimationFrame(frame); } },
    sleep: function () { running = false; if (handle) root.cancelAnimationFrame(handle); handle = 0; },
    active: function () { return running || !!handle; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
