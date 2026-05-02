import { z } from 'zod';

/** Message type constants — single source of truth for type strings. */
export const MessageType = Object.freeze({
  // client -> server
  DISPLAY_CREATE_ROOM: 'display:create_room',
  DISPLAY_NOTIFY:      'display:notify',     // display addresses an event to a specific player slot
  PLAYER_JOIN: 'player:join',
  PLAYER_ACTION: 'player:action',
  PLAYER_BLOCK_START: 'player:block_start',
  PLAYER_BLOCK_END: 'player:block_end',
  PING: 'ping',

  // server -> client
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ROOM_PLAYER_STATUS: 'room:player_status',
  PLAYER_ACTION_RELAY: 'player:action_relay',
  PLAYER_EVENT:        'player:event',       // server pushes a game-logic event to a specific phone
  ERROR: 'error',
  PONG: 'pong',
});

/** Error codes — single source of truth. */
export const ErrorCode = Object.freeze({
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  INVALID_STATE: 'INVALID_STATE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

/** Action enum used by `player:action`. */
export const ActionType = Object.freeze({
  PUNCH_JAB: 'punch_jab',
  PUNCH_HOOK: 'punch_hook',
  PUNCH_UPPERCUT: 'punch_uppercut',
  DODGE_LEFT: 'dodge_left',
  DODGE_RIGHT: 'dodge_right',
  DODGE_DOWN: 'dodge_down',
});

const ActionEnum = z.enum([
  ActionType.PUNCH_JAB,
  ActionType.PUNCH_HOOK,
  ActionType.PUNCH_UPPERCUT,
  ActionType.DODGE_LEFT,
  ActionType.DODGE_RIGHT,
  ActionType.DODGE_DOWN,
]);

/** Top-level envelope — every inbound frame must satisfy this shape. */
export const EnvelopeSchema = z.object({
  type: z.string().min(1),
  data: z.object({}).passthrough(),
  t: z.number().finite().optional(),
});

const EmptyData = z.object({}).passthrough();

const PlayerJoinData = z.object({
  roomCode: z.string().regex(/^\d+$/, 'roomCode must be numeric digits'),
  displayName: z.string().trim().min(1).max(32).optional(),
});

const PlayerActionData = z.object({
  action: ActionEnum,
  power: z.number().finite().optional(),
});

// display:notify — open-ended `data` payload so we can extend events
// (hit_landed, hit_taken, block_broken, no_block_phase, …) without
// touching the schema.
const DisplayNotifyData = z.object({
  targetSlot: z.enum(['P1', 'P2']),
  event: z.string().min(1).max(64),
  data: z.object({}).passthrough().optional(),
});

/** Per-type `data` schemas, keyed by message type. */
export const InboundDataSchemas = Object.freeze({
  [MessageType.DISPLAY_CREATE_ROOM]: EmptyData,
  [MessageType.DISPLAY_NOTIFY]: DisplayNotifyData,
  [MessageType.PLAYER_JOIN]: PlayerJoinData,
  [MessageType.PLAYER_ACTION]: PlayerActionData,
  [MessageType.PLAYER_BLOCK_START]: EmptyData,
  [MessageType.PLAYER_BLOCK_END]: EmptyData,
  [MessageType.PING]: EmptyData,
});

/**
 * True if the given type is a known inbound message type.
 * @param {string} type
 * @returns {boolean}
 */
export function isKnownInboundType(type) {
  return Object.prototype.hasOwnProperty.call(InboundDataSchemas, type);
}

/** Action-class messages cost rate-limit tokens. */
export const ACTION_CLASS_TYPES = new Set([
  MessageType.PLAYER_ACTION,
  MessageType.PLAYER_BLOCK_START,
  MessageType.PLAYER_BLOCK_END,
]);
