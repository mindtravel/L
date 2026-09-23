export function createHudView({ game, board, getOnlineState = () => null, theme, rules, util, documentRef = globalThis.document }) {
  const statusLabels = {
    connecting: '正在连接', waiting: '等待对手加入', playing: '联机对弈中',
    'pending-move': '等待服务器确认', 'opponent-disconnected': '对手已断线',
    reconnecting: '正在重连', finished: '本局结束', error: '联机异常', disconnected: '未连接'
  };
  let lastSeeds = [0, 0];
  let lastLogLength = 0;
  let toastTimer = null;
  let overlayTimer = null;

  const $ = id => util.$(id);

  function renderLog(records) {
    const list = $('log');
    list.innerHTML = '';
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index], orientation = theme.players;
      const li = documentRef.createElement('li');
      li.className = record.player === rules.RED ? 'p0' : 'p1';
      if (index === records.length - 1 && records.length > lastLogLength) li.classList.add('new');
      const direction = rules.ORIENTATIONS[record.q];
      const number = documentRef.createElement('span');
      number.className = 'n';
      number.textContent = String(index + 1);
      const player = documentRef.createElement('span');
      player.className = 'tag';
      player.textContent = orientation[record.player];
      const description = documentRef.createElement('span');
      description.className = 'desc';
      description.textContent = direction.arrow + direction.label +
        ' (' + record.x + ',' + record.y + ') ' + (record.isSeed ? '种子' : '续线');
      li.appendChild(number);
      li.appendChild(player);
      li.appendChild(description);
      if (record.claimed.length) {
        const claim = documentRef.createElement('span');
        claim.className = 'claim';
        claim.textContent = '成格 ' + record.claimed.length;
        li.appendChild(claim);
      }
      list.appendChild(li);
    }
    if (!records.length) {
      const empty = documentRef.createElement('li');
      empty.className = 'empty-log';
      empty.textContent = '开局：双方各先放置一枚种子';
      list.appendChild(empty);
    }
    lastLogLength = records.length;
  }

  function pips(element, count, previous, total) {
    element.innerHTML = '';
    for (let index = 0; index < total; index++) {
      const pip = documentRef.createElement('span');
      if (index < count) pip.classList.add('on');
      else if (index < previous) pip.classList.add('pop');
      element.appendChild(pip);
    }
  }

  function bump(element, text) {
    if (element.textContent === text) return;
    element.textContent = text;
    element.classList.remove('bump');
    void element.offsetWidth;
    element.classList.add('bump');
  }

  function refresh() {
    const state = game.state();
    if (!state) return;
    const cfg = game.cfg;
    const thinking = game.thinking();
    const players = game.players();
    const selected = board.selected();
    const meta = $('sessionMeta');
    const session = cfg.mode === 'online' ? getOnlineState() : null;
    if (meta) {
      const modeText = { pvp: '双人同机', pve: '人机 · 执黑', evp: '人机 · 执白', eve: 'AI 自弈', online: '联机对弈' }[cfg.mode] || cfg.mode;
      let detail = '';
      if (session) {
        if (session.roomId) detail = ' · 房间 ' + session.roomId + ' · ' + (session.player === 0 ? '黑方' : '白方');
        if (session.status) detail += ' · ' + (session.error || statusLabels[session.status] || session.status);
      }
      if (cfg.mode !== 'pvp' && cfg.mode !== 'online') detail += ' · 强度 ' + cfg.level;
      meta.textContent = modeText + detail;
    }
    const copyRoom = $('btnCopyRoom');
    if (copyRoom) copyRoom.hidden = cfg.mode !== 'online' || !session || !session.roomId;

    const pill = $('turnpill'), turnText = $('turntext');
    pill.classList.remove('p0', 'p1', 'over', 'thinking');
    if (state.winner == null) {
      pill.classList.add(state.turn === rules.RED ? 'p0' : 'p1');
      if (thinking) pill.classList.add('thinking');
      turnText.textContent = thinking ? theme.players[state.turn] + '思考中' : theme.players[state.turn] + '回合';
    } else {
      pill.classList.add('over');
      turnText.textContent = state.winner === rules.DRAW ? '和棋' : theme.players[state.winner] + '胜';
    }

    $('sideRed').classList.toggle('active', state.winner == null && state.turn === rules.RED);
    $('sideBlue').classList.toggle('active', state.winner == null && state.turn === rules.BLUE);
    pips($('pipsRed'), state.seeds[0], lastSeeds[0], cfg.seeds);
    pips($('pipsBlue'), state.seeds[1], lastSeeds[1], cfg.seeds);
    lastSeeds = [state.seeds[0], state.seeds[1]];
    bump($('cellRed'), rules.countCells(state, rules.RED) + ' 格');
    bump($('cellBlue'), rules.countCells(state, rules.BLUE) + ' 格');
    $('btnUndo').disabled = game.history().length === 0 || cfg.mode === 'online';

    const hint = $('hintline');
    if (state.winner != null) {
      hint.innerHTML = state.winner === rules.DRAW
        ? '棋盘再也放不下 L 了 —— <b>和棋</b>'
        : '<b>' + theme.players[state.winner] + '</b>连成四格，赢下此局';
    } else if (cfg.mode === 'online' && getOnlineState()) {
      const online = getOnlineState();
      if (online.error) hint.textContent = online.error;
      else if (online.status === 'pending-move') hint.textContent = '正在等待服务器确认落子…';
      else if (online.status === 'waiting') hint.textContent = '房间已创建，等待另一位玩家加入';
      else if (online.status === 'opponent-disconnected') hint.textContent = '对手已断线，对局状态已保留，等待重连';
      else if (online.status === 'reconnecting') hint.textContent = '连接中断，正在尝试重连…';
      else if (online.status === 'connecting') hint.textContent = '正在连接服务器…';
      else if (online.status === 'disconnected') hint.textContent = '选择创建房间或加入房间';
      else if (online.status === 'error') hint.textContent = '联机连接异常，请重试';
      else if (online.status === 'playing' && online.player !== state.turn) hint.textContent = '等待对手落子';
      else if (online.rematch && online.rematch.requestedBy != null) hint.textContent = '一方已申请再来一局，等待另一方确认';
      else hint.textContent = '你的回合';
    } else if (thinking) {
      hint.textContent = theme.players[state.turn] + '正在思考…';
    } else if (players[state.turn] === 'ai') {
      hint.textContent = '电脑回合';
    } else if (selected) {
      hint.innerHTML = '点四周的<b>虚线 L</b>落子 · 实线＝续线，点线＝种子落子（消耗 1 枚）· Esc 取消';
    } else {
      hint.innerHTML = '点一个<b>格点</b>，再从四个虚线 L 里挑一个 · 快捷键 1–4 / U 悔棋 / R 新局';
    }
  }

  function showOverlay() {
    const state = game.state();
    if (!state || state.winner == null) return;
    const black = rules.countCells(state, rules.RED), white = rules.countCells(state, rules.BLUE);
    if (state.winner === rules.DRAW) {
      $('ovEmoji').textContent = '＝';
      $('ovTitle').textContent = '和棋';
      $('ovTitle').style.color = theme.ink2;
      $('ovSub').textContent = '再没有可画的 L 了';
    } else {
      $('ovEmoji').textContent = state.winner === rules.RED ? '■' : '□';
      $('ovTitle').textContent = theme.players[state.winner] + '胜';
      $('ovTitle').style.color = theme.ink;
      $('ovSub').textContent = '连成四格 · 黑 ' + black + ' 格 · 白 ' + white + ' 格';
    }
    const overlay = $('overlay');
    overlay.hidden = false;
    const box = overlay.querySelector ? overlay.querySelector('.box') : null;
    if (box) { box.style.animation = 'none'; void box.offsetWidth; box.style.animation = ''; }
  }

  function hideOverlay() { $('overlay').hidden = true; }

  function scheduleOverlay(delay) {
    clearTimeout(overlayTimer);
    if (delay > 0) overlayTimer = setTimeout(showOverlay, delay);
    else showOverlay();
  }

  function toast(message, duration) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('on'), duration || 2200);
  }

  function reset(cfg) {
    lastSeeds = [cfg.seeds, cfg.seeds];
    lastLogLength = 0;
    hideOverlay();
  }

  return {
    renderLog,
    refresh,
    showOverlay,
    scheduleOverlay,
    clearOverlayTimer: () => clearTimeout(overlayTimer),
    hideOverlay,
    toast,
    fail: () => toast('这一步不合法'),
    reset
  };
}
