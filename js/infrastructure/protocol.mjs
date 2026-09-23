import { SNAPSHOT_VERSION } from '../application/game-snapshot.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const isPlayer = value => value === 0 || value === 1;

function validRecord(record, width, height) {
  if (!isObject(record) || !isPlayer(record.player) || !isInt(record.x, 0, width - 1) ||
      !isInt(record.y, 0, height - 1) || !isInt(record.q, 0, 3) || typeof record.isSeed !== 'boolean' ||
      !Array.isArray(record.edges) || record.edges.length !== 2 || !Array.isArray(record.claimed)) return false;
  return record.edges.every(edge => isObject(edge) && (edge.kind === 'h' || edge.kind === 'v') &&
    isInt(edge.x, 0, width - 1) && isInt(edge.y, 0, height - 1)) &&
    record.claimed.every(cell => Array.isArray(cell) && cell.length === 2 &&
      isInt(cell[0], 0, width - 1) && isInt(cell[1], 0, height - 1));
}

export function isValidSnapshot(state, version) {
  if (!isObject(state) || !isInt(state.W, 3, 21) || !isInt(state.H, 3, 21)) return false;
  const size = state.W * state.H;
  if (state.rulesVersion != null && state.rulesVersion !== SNAPSHOT_VERSION) return false;
  if (state.torus != null && state.torus !== true) return false;
  if (state.seedsPerPlayer != null && !isInt(state.seedsPerPlayer, 0, 3)) return false;
  if (!isInt(version, 0, Number.MAX_SAFE_INTEGER) || state.version != null && state.version !== version) return false;
  if (!isInt(state.turn, 0, 1) || !isInt(state.moveCount, 0, size) ||
      !(state.winner == null || isPlayer(state.winner) || state.winner === 'draw')) return false;
  if (!Array.isArray(state.h) || state.h.length !== size || !Array.isArray(state.v) || state.v.length !== size ||
      !Array.isArray(state.cell) || state.cell.length !== size ||
      ![state.h, state.v, state.cell].every(values => values.every(value => value === -1 || isPlayer(value)))) return false;
  if (!Array.isArray(state.seeds) || state.seeds.length !== 2 || !state.seeds.every(value => isInt(value, 0, 3))) return false;
  if (!Array.isArray(state.records) || state.records.length > size ||
      !state.records.every(record => validRecord(record, state.W, state.H))) return false;
  if (!Array.isArray(state.seedMarks) || state.seedMarks.length > size ||
      !state.seedMarks.every(mark => isObject(mark) && isInt(mark.x, 0, state.W - 1) &&
        isInt(mark.y, 0, state.H - 1) && isPlayer(mark.p))) return false;
  if (state.winLine != null && (!Array.isArray(state.winLine) || state.winLine.length !== 4 ||
      !state.winLine.every(cell => Array.isArray(cell) && cell.length === 2 &&
        isInt(cell[0], 0, state.W - 1) && isInt(cell[1], 0, state.H - 1)))) return false;
  return state.lastMove == null || validRecord(state.lastMove, state.W, state.H);
}

export function isValidServerMessage(message) {
  if (!isObject(message) || typeof message.type !== 'string') return false;
  if (message.type === 'created' || message.type === 'joined') {
    return typeof message.roomId === 'string' && /^[A-Z0-9_-]{6,8}$/.test(message.roomId) &&
      isPlayer(message.player) && (message.status === 'waiting' || message.status === 'playing') &&
      typeof message.token === 'string' && message.token.length <= 64 &&
      isValidSnapshot(message.state, message.state && message.state.version);
  }
  if (message.type === 'moveAccepted' || message.type === 'state' || message.type === 'sync') {
    return isInt(message.version, 0, Number.MAX_SAFE_INTEGER) && isValidSnapshot(message.state, message.version);
  }
  if (message.type === 'presence') return isInt(message.players, 0, 2);
  if (message.type === 'rematchStatus') {
    return (message.requestedBy == null || isPlayer(message.requestedBy)) && typeof message.accepted === 'boolean' &&
      Array.isArray(message.players) && message.players.length <= 2 && message.players.every(isPlayer);
  }
  if (message.type === 'error') {
    return typeof message.message === 'string' && message.message.length <= 200 &&
      (message.code == null || typeof message.code === 'string' && message.code.length <= 40);
  }
  return false;
}
