/* =====================================================================
 * 直角 · 音效
 * ---------------------------------------------------------------------
 * 全部用 WebAudio 现场合成，不带任何音频文件。
 * 黑方音高略高、白方略低，闭着眼也能听出是谁落的子。
 * 浏览器不支持 WebAudio（或没开音效）时，所有方法都是空操作。
 * ===================================================================== */
(function (root) {
  'use strict';

  var ZJ = root.ZJ = root.ZJ || {};

  var ac = null;

  function audio() {
    if (!ZJ.sfx.enabled) return null;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ac) { try { ac = new AC(); } catch (e) { return null; } }
    if (ac.state === 'suspended' && ac.resume) { try { ac.resume(); } catch (e) {} }
    return ac;
  }

  function tone(freq, dur, type, gain, delay) {
    var a = audio();
    if (!a) return;
    try {
      var t0 = a.currentTime + (delay || 0);
      var osc = a.createOscillator(), g = a.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(a.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    } catch (e) {}
  }

  ZJ.sfx = {
    enabled: true,

    /* 落子：p 是 0/1，isSeed 加一声上行的泛音 */
    place: function (p, isSeed) {
      var base = (p === 0) ? 392 : 330;
      tone(base, 0.09, 'square', 0.028);
      if (isSeed) tone(base * 1.5, 0.16, 'sine', 0.02, 0.03);
    },

    /* 成格：n 是这一步占下的格数 */
    claim: function (n) {
      tone(659, 0.09, 'square', 0.024);
      tone(988, 0.14, 'square', 0.018, 0.07);
      if (n > 1) tone(1319, 0.16, 'square', 0.014, 0.14);
    },

    win: function () {
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++) tone(notes[i], 0.26, 'square', 0.026, i * 0.10);
    },

    draw: function () { tone(440, 0.18, 'sine', 0.03); tone(330, 0.26, 'sine', 0.026, 0.12); },
    bad: function () { tone(150, 0.12, 'square', 0.02); },
    undo: function () { tone(300, 0.08, 'sine', 0.022); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
