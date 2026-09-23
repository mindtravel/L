(function (root) {
  'use strict';
  var ZJ = root.ZJ = root.ZJ || {};
  var socket = null, player = null, roomId = null;
  function endpoint() {
    var proto = root.location && root.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + root.location.host;
  }
  function status(text) { var el = document.getElementById('roomStatus'); if (el) el.textContent = text; }
  function send(msg) { if (socket && socket.readyState === 1) socket.send(JSON.stringify(msg)); else status('尚未连接服务器'); }
  function connect() {
    if (socket && socket.readyState <= 1) return;
    if (!root.WebSocket) return status('当前浏览器不支持联机');
    socket = new root.WebSocket(endpoint());
    status('正在连接…');
    socket.onopen = function () { status('已连接'); };
    socket.onclose = function () { status('连接已断开'); player = null; };
    socket.onerror = function () { status('连接失败'); };
    socket.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.roomId) roomId = msg.roomId;
      if (msg.player != null) player = msg.player;
      if (msg.type === 'created' || msg.type === 'joined') {
        ZJ.game.setOnlinePlayer(player); ZJ.game.applyOnlineState(msg.state);
        status('房间 ' + roomId + ' · ' + (player === 0 ? '黑方' : '白方'));
      } else if (msg.type === 'move' || msg.type === 'state') {
        ZJ.game.applyOnlineState(msg.state);
      } else if (msg.type === 'presence') {
        status('房间 ' + roomId + ' · ' + msg.players + '/2');
      } else if (msg.type === 'error') status(msg.message || '联机请求失败');
    };
  }
  ZJ.online = {
    create: function () { connect(); setTimeout(function () { send({ type: 'create' }); }, 0); },
    join: function (id) { connect(); setTimeout(function () { send({ type: 'join', roomId: id }); }, 0); },
    move: function (x, y, q) { send({ type: 'move', x: x, y: y, q: q }); },
    reset: function () { send({ type: 'reset' }); },
    room: function () { return roomId; },
    player: function () { return player; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
