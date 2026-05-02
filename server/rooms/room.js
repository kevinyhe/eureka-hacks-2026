import { Match } from '../game/match.js';
import { MessageType } from '../net/messages.js';
import { nowMs } from '../utils/timing.js';
import { logger } from '../utils/logger.js';

/**
 * @typedef {import('../net/connection.js').Connection} Connection
 *
 * @typedef {Object} PlayerSlot
 * @property {Connection|null} connection
 * @property {string|null} displayName
 * @property {"connected"|"disconnected"} status
 * @property {number|null} disconnectedAt
 */

/** @returns {PlayerSlot} */
function emptySlot() {
  return {
    connection: null,
    displayName: null,
    status: 'disconnected',
    disconnectedAt: null,
  };
}

/**
 * One room = one match. Holds up to 1 display + 2 player connections.
 */
export class Room {
  /**
   * @param {string} code
   */
  constructor(code) {
    this.code = code;
    /** @type {Connection|null} */
    this.display = null;
    /** @type {{ P1: PlayerSlot, P2: PlayerSlot }} */
    this.players = { P1: emptySlot(), P2: emptySlot() };
    this.match = new Match(code);
    this.createdAt = nowMs();
    this.lastActivityAt = this.createdAt;
    this.log = logger.child({ room: code });
  }

  /** Bump the activity timestamp — called on every meaningful event. */
  touch() {
    this.lastActivityAt = nowMs();
  }

  /**
   * Attach a display connection. Errors if a display is already attached
   * AND still has an open socket.
   *
   * @param {Connection} conn
   * @returns {boolean} true on success
   */
  attachDisplay(conn) {
    if (this.display && this.display.ws.readyState === this.display.ws.OPEN) {
      return false;
    }
    this.display = conn;
    conn.role = 'display';
    conn.roomCode = this.code;
    this.touch();
    return true;
  }

  /**
   * Try to attach `conn` as P1 then P2. Returns the assigned slot id, or
   * null if the room is full.
   *
   * Reconnect path: if a slot is currently `disconnected`, the new
   * connection takes it over.
   *
   * @param {Connection} conn
   * @param {string|undefined} displayName
   * @returns {"P1"|"P2"|null}
   */
  attachPlayer(conn, displayName) {
    const slotId = this._chooseSlot();
    if (!slotId) return null;
    const slot = this.players[slotId];
    slot.connection = conn;
    slot.displayName = displayName ?? slotId;
    slot.status = 'connected';
    slot.disconnectedAt = null;
    conn.role = slotId;
    conn.roomCode = this.code;
    this.touch();
    return slotId;
  }

  /**
   * Mark the slot/connection's role as disconnected. Does not release the
   * slot — that happens on grace-period expiry via the manager.
   *
   * @param {Connection} conn
   */
  markDisconnected(conn) {
    if (conn.role === 'display' && this.display === conn) {
      this.display = null;
      this.touch();
      return;
    }
    if (conn.role === 'P1' || conn.role === 'P2') {
      const slot = this.players[conn.role];
      if (slot.connection === conn) {
        slot.connection = null;
        slot.status = 'disconnected';
        slot.disconnectedAt = nowMs();
        this.touch();
      }
    }
  }

  /**
   * Free a slot whose grace period has lapsed.
   * @param {"P1"|"P2"} slotId
   */
  releaseSlot(slotId) {
    this.players[slotId] = emptySlot();
    this.touch();
  }

  /**
   * Send a message to every connected member of the room except `exceptId`.
   *
   * @param {string} type
   * @param {object} data
   * @param {string|null} [exceptId]
   */
  broadcast(type, data, exceptId = null) {
    const sendIf = (conn) => {
      if (!conn) return;
      if (exceptId && conn.id === exceptId) return;
      conn.send(type, data);
    };
    sendIf(this.display);
    sendIf(this.players.P1.connection);
    sendIf(this.players.P2.connection);
  }

  /**
   * Relay a player action to display + opponent. Order: relay first, then
   * `match.onAction(...)` — see PLAN.md §9 for rationale.
   *
   * @param {"P1"|"P2"} fromSlot
   * @param {string} action       - includes "block_start" / "block_end"
   * @param {number|undefined} power
   */
  relayAction(fromSlot, action, power) {
    const serverT = nowMs();
    const data = { playerId: fromSlot, action, serverT };
    if (power !== undefined) data.power = power;

    const sender = this.players[fromSlot].connection;
    this.broadcast(MessageType.PLAYER_ACTION_RELAY, data, sender?.id ?? null);

    // Game-logic seam (stub today).
    this.match.onAction(fromSlot, { action, power: power ?? 1.0, serverT });

    this.touch();
  }

  /**
   * @returns {boolean} true if the room has nobody live and nothing pending
   */
  isAbandoned() {
    const displayGone =
      !this.display || this.display.ws.readyState !== this.display.ws.OPEN;
    const slotEmpty = (s) => s.connection === null;
    return displayGone && slotEmpty(this.players.P1) && slotEmpty(this.players.P2);
  }

  /**
   * Snapshot for /debug.
   */
  toJSON() {
    const slot = (s) => ({
      displayName: s.displayName,
      status: s.status,
      disconnectedAt: s.disconnectedAt,
      connId: s.connection?.id ?? null,
      lastSeenAt: s.connection?.lastSeenAt ?? null,
    });
    return {
      code: this.code,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      display: this.display
        ? { connId: this.display.id, lastSeenAt: this.display.lastSeenAt }
        : null,
      players: { P1: slot(this.players.P1), P2: slot(this.players.P2) },
      match: this.match.getState(),
    };
  }

  /** @returns {"P1"|"P2"|null} */
  _chooseSlot() {
    if (this.players.P1.connection === null) return 'P1';
    if (this.players.P2.connection === null) return 'P2';
    return null;
  }
}
