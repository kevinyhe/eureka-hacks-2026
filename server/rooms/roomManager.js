import { Room } from './room.js';
import { config } from '../config.js';
import { nowMs } from '../utils/timing.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ mod: 'roomManager' });

/**
 * Owns the registry of active rooms and runs the periodic cleanup sweep.
 */
export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this._sweeperTimer = null;
  }

  /** Start the periodic sweeper. Idempotent. */
  start() {
    if (this._sweeperTimer) return;
    this._sweeperTimer = setInterval(
      () => this._sweep(),
      config.ROOM_SWEEPER_INTERVAL_MS,
    );
    // Don't keep the event loop alive on this timer alone.
    if (this._sweeperTimer.unref) this._sweeperTimer.unref();
  }

  /** Stop the sweeper (used by tests). */
  stop() {
    if (this._sweeperTimer) {
      clearInterval(this._sweeperTimer);
      this._sweeperTimer = null;
    }
  }

  /**
   * Allocate a fresh room with a unique code.
   *
   * @returns {Room}
   * @throws {Error} if no free code can be found (effectively impossible)
   */
  createRoom() {
    const code = this._allocateCode();
    const room = new Room(code);
    this.rooms.set(code, room);
    log.info({ room: code }, 'room created');
    return room;
  }

  /**
   * Look up a room by code.
   * @param {string} code
   * @returns {Room|undefined}
   */
  getRoom(code) {
    return this.rooms.get(code);
  }

  /**
   * Snapshot for /debug — array of room JSONs.
   * @returns {object[]}
   */
  snapshot() {
    return [...this.rooms.values()].map((r) => r.toJSON());
  }

  /**
   * Destroy a room immediately. Closes any lingering sockets.
   * @param {string} code
   */
  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    this.rooms.delete(code);
    log.info({ room: code }, 'room destroyed');
    // Best-effort socket close — usually they're already gone.
    room.display?.close(1000, 'room destroyed');
    room.players.P1.connection?.close(1000, 'room destroyed');
    room.players.P2.connection?.close(1000, 'room destroyed');
  }

  // -------- internals --------

  _allocateCode() {
    const max = Math.pow(10, config.ROOM_CODE_LENGTH) - 1; // e.g. 9999
    for (let attempt = 0; attempt < 100; attempt++) {
      const n = 1 + Math.floor(Math.random() * max);
      const code = String(n).padStart(config.ROOM_CODE_LENGTH, '0');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('no free room codes available');
  }

  _sweep() {
    const now = nowMs();
    for (const room of [...this.rooms.values()]) {
      // 1. release any slot whose grace period has lapsed
      for (const slotId of /** @type {const} */ (['P1', 'P2'])) {
        const slot = room.players[slotId];
        if (
          slot.connection === null &&
          slot.status === 'disconnected' &&
          slot.disconnectedAt !== null &&
          now - slot.disconnectedAt > config.RECONNECT_GRACE_MS
        ) {
          log.info({ room: room.code, slot: slotId }, 'slot grace expired');
          room.releaseSlot(slotId);
        }
      }

      // 2. destroy abandoned rooms after the idle window
      if (
        room.isAbandoned() &&
        now - room.lastActivityAt > config.ROOM_IDLE_TIMEOUT_MS
      ) {
        this.destroyRoom(room.code);
      }
    }
  }
}
