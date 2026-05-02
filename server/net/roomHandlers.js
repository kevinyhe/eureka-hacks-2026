import { registerHandler } from './handlers.js';
import { MessageType, ErrorCode } from './messages.js';

/**
 * @typedef {import('./connection.js').Connection} Connection
 * @typedef {import('../rooms/roomManager.js').RoomManager} RoomManager
 * @typedef {import('../rooms/room.js').Room} Room
 */

// -------- display:create_room --------
registerHandler(MessageType.DISPLAY_CREATE_ROOM, ({ conn, rooms }) => {
  if (conn.role !== 'none') {
    conn.sendError(
      ErrorCode.ALREADY_IN_ROOM,
      'this connection already has a role',
    );
    return;
  }

  const room = rooms.createRoom();
  if (!room.attachDisplay(conn)) {
    // Practically unreachable on a freshly-created room.
    conn.sendError(ErrorCode.INVALID_STATE, 'failed to attach display');
    return;
  }

  conn.send(MessageType.ROOM_CREATED, { roomCode: room.code });
});

// -------- player:join --------
registerHandler(MessageType.PLAYER_JOIN, ({ conn, data, rooms }) => {
  if (conn.role !== 'none') {
    conn.sendError(
      ErrorCode.ALREADY_IN_ROOM,
      'this connection already has a role',
    );
    return;
  }

  const room = rooms.getRoom(data.roomCode);
  if (!room) {
    conn.sendError(ErrorCode.ROOM_NOT_FOUND, `no room with code ${data.roomCode}`);
    return;
  }

  const slot = room.attachPlayer(conn, data.displayName);
  if (!slot) {
    conn.sendError(ErrorCode.ROOM_FULL, 'both player slots are taken');
    return;
  }

  conn.send(MessageType.ROOM_JOINED, {
    playerId: slot,
    roomCode: room.code,
  });

  room.broadcast(
    MessageType.ROOM_PLAYER_STATUS,
    {
      playerId: slot,
      status: 'connected',
      displayName: room.players[slot].displayName,
    },
    conn.id, // don't echo to the joiner — they got room:joined
  );
});

/**
 * Called from the ws close path. Marks the slot disconnected and broadcasts
 * status to remaining members.
 *
 * @param {Connection} conn
 * @param {RoomManager} rooms
 */
export function handleConnectionClose(conn, rooms) {
  if (!conn.roomCode) return;
  const room = rooms.getRoom(conn.roomCode);
  if (!room) return;

  const wasRole = conn.role;
  room.markDisconnected(conn);

  if (wasRole === 'P1' || wasRole === 'P2') {
    room.broadcast(MessageType.ROOM_PLAYER_STATUS, {
      playerId: wasRole,
      status: 'disconnected',
    });
  }
  // Display disconnect is silent — no broadcast event defined for it.
}
