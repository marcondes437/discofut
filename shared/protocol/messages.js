// Protocolo cliente ⇄ servidor (JSON sobre WebSocket).
// O cliente envia apenas intenções (entradas e comandos); o servidor valida,
// simula e publica estado. Ver README para a tabela completa de mensagens.

export const PROTOCOL_VERSION = 3;

export const LIMITS = Object.freeze({
  maxMessageBytes: 70 * 1024,   // comporta upload de arena customizada
  nameLength: 20,
  roomNameLength: 32,
  passwordLength: 32,
  chatLength: 140,
  chatBurst: 5,                 // mensagens
  chatWindowMs: 5000,
  msgPerSecond: 140,            // limite geral (entradas a 60 Hz + folga)
  adminPerSecond: 10,
  maxRooms: 100,
  maxConnectionsPerIp: 32,
  minPlayers: 2,
  maxPlayers: 16,
  inputQueueMax: 6,
  reconnectGraceMs: 25000,
  banMs: 10 * 60 * 1000,
});

export const SNAPSHOT_RATES = [20, 30, 60];

export const ADMIN_ACTIONS = Object.freeze([
  'move', 'kick', 'ban', 'mute', 'unmute', 'admin', 'start', 'stop', 'restart',
  'pause', 'resume', 'balance', 'settings', 'arena', 'addbot', 'rmbot', 'clearbans', 'lock',
  'tournament_draw', 'tournament_next', 'tournament_cancel',
  'draw_teams', 'draw_3v3',
]);

/** Remove controles/marcação e limita tamanho. */
export function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanName(s) {
  const n = cleanText(s, LIMITS.nameLength);
  return n.length ? n : '';
}

export function isInt(v) { return Number.isInteger(v); }
