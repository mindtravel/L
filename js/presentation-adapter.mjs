export function createPresentationAdapter({ board, hud, effects, audio, scheduler, util, theme, rules, documentRef = globalThis.document }) {
  let input = null;

  function clearBoardSelection() {
    board.select(null);
    board.setHover(null);
    board.setQuadrant(-1);
  }

  function finish(state, delay) {
    if (state.winner == null) return;
    if (state.winner === rules.DRAW) audio.draw();
    else {
      effects.winBurst(state.winLine, state.winner);
      audio.win();
    }
    hud.scheduleOverlay(delay);
  }

  return {
    setInput(value) { input = value; },
    boot() {
      audio.enabled = util.$('chkSfx').checked;
      board.init();
      documentRef.title = theme.name;
      util.$('gameName').textContent = theme.name;
    },
    reset(cfg, records) {
      hud.clearOverlayTimer();
      effects.clear();
      clearBoardSelection();
      board.clearPointer();
      board.resetView();
      hud.reset(cfg);
      hud.renderLog(records);
      board.layout();
      if (input) input.syncAxes();
      hud.refresh();
      board.invalidate(500);
    },
    move(record, state, records, delay) {
      clearBoardSelection();
      effects.edgeGrow(record);
      if (record.isSeed) effects.seedRing(record.x, record.y, record.player);
      if (record.claimed.length) audio.claim(record.claimed.length);
      else audio.place(record.player, record.isSeed);
      finish(state, delay);
      hud.renderLog(records);
      hud.refresh();
      board.invalidate(600);
    },
    remoteState(previous, state, records, meta, delay) {
      if (meta && meta.move && state.lastMove) {
        effects.edgeGrow(state.lastMove);
        if (state.lastMove.isSeed) effects.seedRing(state.lastMove.x, state.lastMove.y, state.lastMove.player);
      }
      if (previous && previous.winner == null && state.winner != null) finish(state, delay);
      hud.renderLog(records);
      hud.refresh();
      clearBoardSelection();
      board.layout();
      board.invalidate(600);
    },
    undo(records) {
      clearBoardSelection();
      effects.clear();
      hud.hideOverlay();
      hud.renderLog(records);
      hud.refresh();
      audio.undo();
      board.invalidate(400);
    },
    thinking() {
      hud.refresh();
      board.invalidate();
    },
    renderFrame(time, thinking) {
      effects.step(time);
      if (board.needsFrame(time) || thinking) board.draw(time);
      else scheduler.sleep();
    },
    installRenderer(renderFrame) { scheduler.install(renderFrame); }
  };
}
