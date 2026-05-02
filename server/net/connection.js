import { randomUUID } from 'node:crypto';
import { serializeOutbound } from './envelope.js';
import { MessageType, ErrorCode } from './messages.js';
import { TokenBucket } from './rateLimiter.js';
import { nowMs } from '../utils/timing.js';
import { logger } from '../utils/logger.js';

/**
 * Wraps a single ws socket. Owns role/room binding, last-seen bookkeeping,
 * and a small send/error API. The rate limiter and heartbeat watchers are
 * attached separately by their respective modules.
 */
export class Connection {
  /**
   * @param {import('ws').WebSocket} ws
   */
  constructor(ws) {
    this.id = randomUUID();
    this.ws = ws;
    /** @type {"none"|"display"|"P1"|"P2"} */
    this.role = 'none';
    /** @type {string|null} */
    this.roomCode = null;
    this.lastSeenAt = nowMs();
    this.rateLimiter = new TokenBucket();
    /** Set by the heartbeat module when the protocol pong arrives. */
    this.isAlive = true;
    this.log = logger.child({ connId: this.id });
  }

  /**
   * Update lastSeenAt — call on every inbound frame.
   */
  touch() {
    this.lastSeenAt = nowMs();
  }

  /**
   * Send a server -> client message. Stamps `t` with serverT.
   *
   * @param {string} type
   * @param {object} data
   */
  send(type, data) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    try {
      this.ws.send(serializeOutbound(type, data, nowMs()));
    } catch (err) {
      this.log.warn({ err, type }, 'send failed');
    }
  }

  /**
   * Send an error message to this connection. Never throws.
   *
   * @param {string} code        - one of ErrorCode.*
   * @param {string} message
   * @param {object} [details]
   */
  sendError(code, message, details) {
    const payload = { code, message };
    if (details !== undefined) payload.details = details;
    this.send(MessageType.ERROR, payload);
  }

  /**
   * Close the underlying socket.
   * @param {number} [code]
   * @param {string} [reason]
   */
  close(code = 1000, reason = '') {
    try {
      this.ws.close(code, reason);
    } catch {
      // socket may already be closed; ignore
    }
  }

  /** Forcefully terminate the underlying socket (skips close handshake). */
  terminate() {
    try {
      this.ws.terminate();
    } catch {
      // ignore
    }
  }
}

// Re-export ErrorCode for downstream convenience.
export { ErrorCode };
