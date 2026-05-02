import {
  EnvelopeSchema,
  InboundDataSchemas,
  isKnownInboundType,
  ErrorCode,
} from './messages.js';

/**
 * @typedef {Object} ParseSuccess
 * @property {true} ok
 * @property {string} type
 * @property {object} data
 * @property {number|undefined} t
 *
 * @typedef {Object} ParseFailure
 * @property {false} ok
 * @property {string} code        - one of ErrorCode.*
 * @property {string} message
 * @property {object} [details]
 *
 * @typedef {ParseSuccess | ParseFailure} ParseResult
 */

/**
 * Parse and validate a raw inbound text frame.
 *
 * Pipeline:
 *   1. JSON.parse (fail -> INVALID_PAYLOAD)
 *   2. Envelope shape (fail -> INVALID_PAYLOAD with zod issues)
 *   3. Type lookup (fail -> UNKNOWN_TYPE)
 *   4. Per-type data schema (fail -> INVALID_PAYLOAD with zod issues)
 *
 * Never throws. Returns a discriminated union.
 *
 * @param {string} raw
 * @returns {ParseResult}
 */
export function parseInbound(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      code: ErrorCode.INVALID_PAYLOAD,
      message: 'frame is not valid JSON',
    };
  }

  const env = EnvelopeSchema.safeParse(parsed);
  if (!env.success) {
    return {
      ok: false,
      code: ErrorCode.INVALID_PAYLOAD,
      message: 'envelope shape invalid',
      details: { issues: env.error.issues },
    };
  }

  const { type, data, t } = env.data;

  if (!isKnownInboundType(type)) {
    return {
      ok: false,
      code: ErrorCode.UNKNOWN_TYPE,
      message: `unknown message type: ${type}`,
    };
  }

  const dataSchema = InboundDataSchemas[type];
  const dataParsed = dataSchema.safeParse(data);
  if (!dataParsed.success) {
    return {
      ok: false,
      code: ErrorCode.INVALID_PAYLOAD,
      message: `data invalid for type ${type}`,
      details: { issues: dataParsed.error.issues },
    };
  }

  return { ok: true, type, data: dataParsed.data, t };
}

/**
 * Build an outbound envelope. Caller supplies serverT — we don't reach for
 * the clock here so callers in the same broadcast loop can share one
 * timestamp.
 *
 * @param {string} type
 * @param {object} data
 * @param {number} serverT
 * @returns {string}
 */
export function serializeOutbound(type, data, serverT) {
  return JSON.stringify({ type, data, t: serverT });
}
