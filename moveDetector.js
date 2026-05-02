// moveDetector.js
//
// Stub. The live move detector lives here.
//
// TODO: fill in once we have a recorded dataset (collected via recorder.html)
// and have chosen thresholds derived from that data — not before. Until then
// this returns null and the game shows no detected move.
//
// Contract:
//   detectMove(window) -> string | null
//
//   `window` is a chronologically-ordered array of recent sensor frames in
//   the player-relative WORLD frame defined in MOVES.md, most recent last.
//   Each frame:
//     {
//       t:  number,   // ms, monotonic; same units as recorder.html
//       ax: number,   // accel along world +X (forward, toward opponent), m/s²
//       ay: number,   // accel along world +Y (up),                       m/s²
//       az: number,   // accel along world +Z (player's right),           m/s²
//       gx: number,   // angular velocity about world +X,                 °/s
//       gy: number,   // angular velocity about world +Y,                 °/s
//       gz: number,   // angular velocity about world +Z,                 °/s
//     }
//
//   The caller decides the window size — typically ~250–500 ms of frames at
//   whatever the device sample rate is. The detector should not assume a
//   fixed length.
//
//   Return value is one of:
//     null             — nothing detected this tick
//     'JAB'
//     'HOOK'           — right hook only (no left hook in this game)
//     'UPPERCUT'
//     'BLOCK'          — held; emit on transitions if you implement state
//     'HEAL'           — held
//     'DODGE_LEFT'
//     'DODGE_RIGHT'
//     'DODGE_BACK'
//
//   Returning the same move string on consecutive calls is allowed; the
//   caller is responsible for de-duplication / cooldown handling at the game
//   layer.

export function detectMove(window) {
  // intentionally empty — no heuristics here until real data is in
  return null;
}
