import { config } from '../config.js';
import { nowMs } from '../utils/timing.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ mod: 'heartbeat' });

/**
 * Two-layer liveness watchdog. Per PLAN.md §7:
 *
 *  - Layer 1: WebSocket protocol ping. Server pings every PING_INTERVAL_MS;
 *    if the previous ping wasn't pong'd before the next interval fires,
 *    terminate. (Configured via PING_TIMEOUT_MS via the gap between
 *    ws.ping() calls.)
 *
 *  - Layer 2: failsafe inbound traffic watchdog. If a connection has not
 *    sent any inbound frame for DISCONNECT_TIMEOUT_MS, terminate.
 */
export class Heartbeat {
  /**
   * @param {Map<string, import('./connection.js').Connection>} connections
   */
  constructor(connections) {
    this.connections = connections;
    this._pingTimer = null;
    this._watchdogTimer = null;
  }

  start() {
    if (this._pingTimer) return;
    this._pingTimer = setInterval(() => this._pingSweep(), config.PING_INTERVAL_MS);
    this._watchdogTimer = setInterval(
      () => this._watchdogSweep(),
      Math.max(1000, Math.floor(config.PING_TIMEOUT_MS / 2)),
    );
    if (this._pingTimer.unref) this._pingTimer.unref();
    if (this._watchdogTimer.unref) this._watchdogTimer.unref();
  }

  stop() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
    this._pingTimer = null;
    this._watchdogTimer = null;
  }

  /**
   * Hook into a connection's ws so its `isAlive` flag is reset on protocol
   * pong. Pongs also count as inbound activity for the watchdog — without
   * this, a receive-only client (e.g. the display) never refreshes
   * `lastSeenAt` and gets killed every DISCONNECT_TIMEOUT_MS.
   *
   * @param {import('./connection.js').Connection} conn
   */
  attach(conn) {
    conn.isAlive = true;
    conn.ws.on('pong', () => {
      conn.isAlive = true;
      conn.lastSeenAt = nowMs();
    });
  }

  _pingSweep() {
    for (const conn of this.connections.values()) {
      if (conn.ws.readyState !== conn.ws.OPEN) continue;
      if (!conn.isAlive) {
        log.warn({ connId: conn.id }, 'ping timeout — terminating');
        conn.terminate();
        continue;
      }
      conn.isAlive = false;
      try {
        conn.ws.ping();
      } catch (err) {
        log.warn({ err, connId: conn.id }, 'ping send failed');
      }
    }
  }

  _watchdogSweep() {
    const now = nowMs();
    for (const conn of this.connections.values()) {
      if (conn.ws.readyState !== conn.ws.OPEN) continue;
      if (now - conn.lastSeenAt > config.DISCONNECT_TIMEOUT_MS) {
        log.warn(
          { connId: conn.id, idleMs: now - conn.lastSeenAt },
          'inbound watchdog — terminating',
        );
        conn.terminate();
      }
    }
  }
}
