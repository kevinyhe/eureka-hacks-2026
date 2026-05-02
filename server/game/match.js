/**
 * Match — STUB.
 *
 * This phase is networking only. The full game logic plugs in here in a
 * later phase. Today the methods are intentionally empty so the room can
 * call them and prove the wiring without any combat behavior.
 *
 * @see PLAN.md §9 for how this is intended to grow.
 */
export class Match {
  /**
   * @param {string} roomCode
   */
  constructor(roomCode) {
    this.roomCode = roomCode;
    // TODO: phase, hp per player, combo trackers, recovery timers, etc.
  }

  /**
   * Receives a validated, rate-limit-passed action from a player.
   *
   * @param {"P1"|"P2"} playerId
   * @param {{ action: string, power: number, serverT: number }} payload
   */
  // eslint-disable-next-line no-unused-vars
  onAction(playerId, payload) {
    // TODO: combat math, combo tracking, HP, KO detection.
  }

  /**
   * Periodic tick. Not invoked this phase — wired in when a tick loop is
   * added (e.g. setInterval at 1000/TICK_HZ ms).
   *
   * @param {number} dtMs
   */
  // eslint-disable-next-line no-unused-vars
  tick(dtMs) {
    // TODO: advance match state.
  }

  /**
   * Snapshot for the /debug HTTP route.
   * @returns {{phase: string}}
   */
  getState() {
    return { phase: 'idle' }; // TODO real state
  }
}
