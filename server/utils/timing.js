import { performance } from 'node:perf_hooks';

/**
 * Monotonic millisecond clock since process start. Floored to integer ms so
 * payloads stay clean. This is the canonical server clock for `serverT`,
 * `lastSeenAt`, and `lastActivityAt`.
 *
 * @returns {number}
 */
export function nowMs() {
  return Math.floor(performance.now());
}
