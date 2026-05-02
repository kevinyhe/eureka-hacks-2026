import { config } from '../config.js';
import { nowMs } from '../utils/timing.js';

/**
 * Lazy-refilling token bucket. One per connection, applied to action-class
 * messages (`player:action`, `player:block_start`, `player:block_end`).
 *
 * Refill is calculated on each `take()` call so we don't burn a timer per
 * connection.
 */
export class TokenBucket {
  /**
   * @param {number} [ratePerSec] - steady-state refill rate; default config
   * @param {number} [burst]      - bucket capacity; default config
   */
  constructor(ratePerSec = config.RATE_LIMIT_PER_SEC, burst = config.RATE_LIMIT_BURST) {
    this.ratePerSec = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.lastRefillAt = nowMs();
  }

  /**
   * Attempt to consume one token. Returns true if consumed, false if empty.
   * @returns {boolean}
   */
  take() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  _refill() {
    const now = nowMs();
    const elapsedMs = now - this.lastRefillAt;
    if (elapsedMs <= 0) return;
    const earned = (elapsedMs / 1000) * this.ratePerSec;
    this.tokens = Math.min(this.burst, this.tokens + earned);
    this.lastRefillAt = now;
  }
}
