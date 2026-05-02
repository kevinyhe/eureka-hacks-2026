/**
 * Tunables. All values readable from env vars so we can iterate during the
 * hackathon without code edits. Numeric env vars are parsed as integers;
 * fall back to the default if parsing yields NaN.
 */

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = Object.freeze({
  PORT: envInt('PORT', 3000),
  TICK_HZ: envInt('TICK_HZ', 30),
  RATE_LIMIT_PER_SEC: envInt('RATE_LIMIT_PER_SEC', 15),
  RATE_LIMIT_BURST: envInt('RATE_LIMIT_BURST', 15),
  PING_INTERVAL_MS: envInt('PING_INTERVAL_MS', 15000),
  PING_TIMEOUT_MS: envInt('PING_TIMEOUT_MS', 5000),
  DISCONNECT_TIMEOUT_MS: envInt('DISCONNECT_TIMEOUT_MS', 30000),
  RECONNECT_GRACE_MS: envInt('RECONNECT_GRACE_MS', 60000),
  ROOM_IDLE_TIMEOUT_MS: envInt('ROOM_IDLE_TIMEOUT_MS', 60000),
  ROOM_CODE_LENGTH: envInt('ROOM_CODE_LENGTH', 4),
  ROOM_SWEEPER_INTERVAL_MS: envInt('ROOM_SWEEPER_INTERVAL_MS', 5000),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
});
