import { registerHandler } from './handlers.js';
import { MessageType, ErrorCode } from './messages.js';

/**
 * @typedef {import('./connection.js').Connection} Connection
 * @typedef {import('../rooms/roomManager.js').RoomManager} RoomManager
 */

/**
 * Resolve the connection to the room it belongs to and its player slot.
 * Returns null + sends an error if the connection isn't a player in a room.
 *
 * @param {Connection} conn
 * @param {RoomManager} rooms
 * @returns {{ room: import('../rooms/room.js').Room, slot: "P1"|"P2" } | null}
 */
function requirePlayerSlot(conn, rooms) {
  if (conn.role !== 'P1' && conn.role !== 'P2') {
    conn.sendError(
      ErrorCode.NOT_IN_ROOM,
      'message requires the connection to be a player in a room',
    );
    return null;
  }
  const room = conn.roomCode ? rooms.getRoom(conn.roomCode) : null;
  if (!room) {
    conn.sendError(ErrorCode.NOT_IN_ROOM, 'room no longer exists');
    return null;
  }
  return { room, slot: conn.role };
}

/**
 * Clamp `power` to [0, 1] if provided, else undefined.
 * @param {number|undefined} power
 * @returns {number|undefined}
 */
function clampPower(power) {
  if (power === undefined) return undefined;
  if (power < 0) return 0;
  if (power > 1) return 1;
  return power;
}

// -------- player:action --------
registerHandler(MessageType.PLAYER_ACTION, ({ conn, data, rooms }) => {
  const ctx = requirePlayerSlot(conn, rooms);
  if (!ctx) return;
  // Rate limiting is applied in the dispatch path (added in step 7).
  ctx.room.relayAction(ctx.slot, data.action, clampPower(data.power));
});

// -------- player:block_start --------
registerHandler(MessageType.PLAYER_BLOCK_START, ({ conn, rooms }) => {
  const ctx = requirePlayerSlot(conn, rooms);
  if (!ctx) return;
  ctx.room.relayAction(ctx.slot, 'block_start', undefined);
});

// -------- player:block_end --------
registerHandler(MessageType.PLAYER_BLOCK_END, ({ conn, rooms }) => {
  const ctx = requirePlayerSlot(conn, rooms);
  if (!ctx) return;
  ctx.room.relayAction(ctx.slot, 'block_end', undefined);
});
