import { MessageType, ErrorCode } from './messages.js';
import { nowMs } from '../utils/timing.js';

/**
 * @typedef {import('./connection.js').Connection} Connection
 *
 * @typedef {(ctx: HandlerContext) => Promise<void>|void} Handler
 *
 * @typedef {Object} HandlerContext
 * @property {Connection} conn
 * @property {object} data        - validated `data` payload for the message
 * @property {number|undefined} t - client-provided clock; untrusted, debug-only
 * @property {import('../rooms/roomManager.js').RoomManager} rooms
 */

/** @type {Map<string, Handler>} */
const handlers = new Map();

/**
 * Register a handler for a given inbound message type.
 *
 * @param {string} type
 * @param {Handler} handler
 */
export function registerHandler(type, handler) {
  handlers.set(type, handler);
}

/**
 * Dispatch a parsed inbound message to its handler.
 * Sends an error to the connection if no handler is registered.
 *
 * @param {string} type
 * @param {HandlerContext} ctx
 */
export async function dispatch(type, ctx) {
  const handler = handlers.get(type);
  if (!handler) {
    ctx.conn.sendError(
      ErrorCode.INVALID_STATE,
      `no handler registered for type ${type}`,
    );
    return;
  }
  await handler(ctx);
}

// Built-in ping handler — registered eagerly. Other handlers are registered
// from their module files so each domain owns its own handler code.
registerHandler(MessageType.PING, ({ conn }) => {
  conn.send(MessageType.PONG, { serverT: nowMs() });
});
