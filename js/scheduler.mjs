/* 直角 · 渲染调度器：唯一负责 requestAnimationFrame。 */
export function createScheduler(windowRef = globalThis) {
  let handle = 0, running = false, source = null;
  function frame(t) {
    handle = 0;
    if (!source) return;
    source(t);
    if (running) handle = windowRef.requestAnimationFrame(frame);
  }
  return {
    install: function (fn) { source = fn; },
    wake: function () { if (!handle && source) { running = true; handle = windowRef.requestAnimationFrame(frame); } },
    sleep: function () { running = false; if (handle) windowRef.cancelAnimationFrame(handle); handle = 0; },
    active: function () { return running || !!handle; }
  };
}
