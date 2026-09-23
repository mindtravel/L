/* Versioned boundary between the rules state and network/persistence data. */
export const SNAPSHOT_VERSION = 1;

export function cloneRecord(record) {
  if (!record) return null;
  return {
    x: record.x, y: record.y, q: record.q, player: record.player, isSeed: record.isSeed,
    edges: (record.edges || []).map(edge => ({ kind: edge.kind, x: edge.x, y: edge.y })),
    claimed: (record.claimed || []).map(cell => [cell[0], cell[1]])
  };
}

export function cloneRecords(records) {
  return (records || []).map(cloneRecord);
}

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    seeds: snapshot.seeds && snapshot.seeds.slice(),
    h: snapshot.h && snapshot.h.slice(),
    v: snapshot.v && snapshot.v.slice(),
    cell: snapshot.cell && snapshot.cell.slice(),
    seedMarks: (snapshot.seedMarks || []).map(mark => ({ x: mark.x, y: mark.y, p: mark.p })),
    winLine: snapshot.winLine && snapshot.winLine.map(cell => [cell[0], cell[1]]),
    lastMove: cloneRecord(snapshot.lastMove),
    records: cloneRecords(snapshot.records)
  };
}

export function toSnapshot(state, { version = state.version == null ? 0 : state.version, records = [] } = {}) {
  if (!state || !Number.isInteger(state.W) || !Number.isInteger(state.H)) {
    throw new TypeError('cannot snapshot an empty game state');
  }
  return {
    rulesVersion: SNAPSHOT_VERSION,
    version,
    W: state.W,
    H: state.H,
    torus: state.torus !== false,
    seedsPerPlayer: state.seedsPerPlayer,
    turn: state.turn,
    winner: state.winner,
    moveCount: state.moveCount,
    seeds: state.seeds.slice(),
    h: Array.from(state.h),
    v: Array.from(state.v),
    cell: Array.from(state.cell),
    seedMarks: state.seedMarks.map(mark => ({ x: mark.x, y: mark.y, p: mark.p })),
    winLine: state.winLine && state.winLine.map(cell => [cell[0], cell[1]]),
    lastMove: cloneRecord(state.lastMove),
    records: cloneRecords(records)
  };
}

export function fromSnapshot(snapshot, rules) {
  if (!snapshot || snapshot.rulesVersion != null && snapshot.rulesVersion !== SNAPSHOT_VERSION) {
    throw new Error('unsupported rules snapshot version');
  }
  if (!rules || typeof rules.hydrateState !== 'function') throw new TypeError('rules adapter is required');
  return rules.hydrateState(cloneSnapshot(snapshot));
}
