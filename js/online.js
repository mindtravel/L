/* L 联机会话：连接、房间身份、版本同步。 */
(function (root) {
  'use strict';
  var ZJ = root.ZJ = root.ZJ || {}, socket = null, player = null, roomId = null, version = -1, pending = null;
  function endpoint() { var p = root.location && root.location.protocol === 'https:' ? 'wss:' : 'ws:'; return p + '//' + root.location.host; }
  function status(text) { var el = document.getElementById('roomStatus'); if (el) el.textContent = text; }
  function send(msg) { if (!socket || socket.readyState !== 1) { status('尚未连接服务器'); return false; } socket.send(JSON.stringify(msg)); return true; }
  function handle(msg) {
    if (msg.roomId) roomId = msg.roomId;
    if (msg.player != null) player = msg.player;
    if (msg.type === 'created' || msg.type === 'joined') {
      version = msg.state && msg.state.version != null ? msg.state.version : 0;
      ZJ.game.setOnlinePlayer(player); ZJ.game.applyOnlineState(msg.state, { version: version, initial: true });
      var start = document.getElementById('startScreen'); if (start) start.hidden = true;
      status('房间 ' + roomId + ' · ' + (player === 0 ? '黑方' : '白方')); return;
    }
    if (msg.version != null && msg.version <= version) return;
    if (msg.version != null) version = msg.version;
    if (msg.type === 'moveAccepted' || msg.type === 'state' || msg.type === 'sync') { ZJ.game.applyOnlineState(msg.state, { version: version, move: msg.move }); return; }
    if (msg.type === 'presence') { status('房间 ' + roomId + ' · ' + msg.players + '/2'); return; }
    if (msg.type === 'error') { pending = null; status(msg.message || '联机请求失败'); }
  }
  function connect() {
    if (socket && socket.readyState <= 1) return;
    if (!root.WebSocket) return status('当前浏览器不支持联机');
    socket = new root.WebSocket(endpoint()); status('正在连接…');
    socket.onopen = function () { status('已连接'); if (pending) { var p = pending; pending = null; send(p); } };
    socket.onclose = function () { status('连接已断开'); player = null; };
    socket.onerror = function () { status('连接失败'); };
    socket.onmessage = function (ev) { try { handle(JSON.parse(ev.data)); } catch (_) { status('服务器消息无效'); } };
  }
  ZJ.online = {
    create: function () { connect(); var m = { type: 'create' }; if (socket && socket.readyState === 1) send(m); else pending = m; },
    join: function (id) { connect(); var m = { type: 'join', roomId: String(id || '').trim() }; if (socket && socket.readyState === 1) send(m); else pending = m; },
    move: function (x, y, q) { return send({ type: 'move', x: x, y: y, q: q, version: version }); },
    reset: function () { return send({ type: 'reset' }); }, room: function () { return roomId; }, player: function () { return player; }, version: function () { return version; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
