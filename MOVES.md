# Boxing Game — Moves Reference

Movement-only reference for the moves available in the game. Describes the physical motion and orientation of the iPhone for each move using a player-relative coordinate system. No damage values, no cooldowns, no timing windows.

---

## Coordinate System

All directions below are given in a **player-relative world frame** (not the device's intrinsic frame). The origin sits at the player's torso, and the player faces the opponent along +X.

- **X axis — forwards / backwards.** +X points forward, away from the player, toward the opponent. −X points backward, toward the player.
- **Y axis — up / down.** +Y points up. −Y points down.
- **Z axis — left / right.** +Z points to the player's right. −Z points to the player's left.

When a move's "screen facing" is described, it refers to the direction the **screen's outward normal** is pointing in this world frame.

---

## Starting Position (Guard)

Every move begins from, and returns to, the boxer's guard position:

- **Position:** Phone held in front of the chest at roughly sternum height, ~25–35 cm in front of the torso (a small +X offset from the origin).
- **Orientation:** Phone held vertically in portrait orientation. The phone's long axis is aligned with the Y axis — the top edge points in +Y, the charging port points in −Y.
- **Screen facing:** Toward the player. The screen normal points in **−X**; the back of the phone faces the opponent (+X).

---

## Detection Thresholds

Small fluctuations in position or orientation should be treated as noise, **not** as moves. The player's hand naturally drifts, trembles, and breathes even at rest in guard, and the iPhone's accelerometer and gyro will register that motion constantly. Move classification must filter it out.

- **Translation:** Small changes in X, Y, or Z — on the order of a few centimeters, or linear accelerations sustained only briefly below a few m/s² — should be ignored. A real jab, hook, or uppercut produces a sharp acceleration spike well above this floor; a guard-hand fidget, a breath, or a small forward sway does not. In particular, a slow drift of the phone in +X while at guard is **not** a jab.
- **Rotation:** Small angular drift — a few degrees of tilt, or angular velocities under a low gyro threshold — should likewise be ignored. A real hook, uppercut, or side dodge produces a clear angular-velocity spike on the relevant axis; ambient hand wobble does not.
- **Hold moves (Block, Heal):** These require a *sustained* near-zero motion plateau after their short initial translation. A brief pause mid-swing, or the moment of stillness at the apex of a punch before retraction, should not be misclassified as Block or Heal.

Exact thresholds should be tuned empirically against real gameplay data, but the principle is constant: only commit to a move classification when the motion clearly exceeds the noise floor of a held guard.

---

## Attacks

### Jab
A quick straight punch thrown forward with the lead hand.

- **Motion:** The phone translates rapidly in **+X** (forward, away from the player) until the arm is near full extension, then retracts in −X back to guard.
- **Phone facing:** Begins with the screen pointing in −X (toward the player). As the arm extends, the phone pitches forward — the top edge tips in +X — so by full extension the screen normal points roughly in **−Y** with a small −X component (screen tilted to face downward and slightly back).

### Hook (right hook only)
A horizontal swing from the right side. Left hooks are not part of the game.

- **Motion:** From guard, the phone arcs through the horizontal plane: it sweeps along an arc that travels in the **−Z direction** (right to left across the body) with a forward +X component, ending in front of the chest. The motion is dominated by yaw rotation about the Y axis.
- **Phone facing:** Begins with the screen pointing in −X. As the phone sweeps across, it pitches forward and rotates so the screen normal ends pointing roughly in **−Y** (screen facing more downward) with a residual −X component.

### Uppercut
An upward strike from below.

- **Motion:** The phone dips slightly in −Y to load, then translates rapidly in **+Y** (straight up) with a small +X (forward) component.
- **Phone facing:** The phone's long axis remains close to vertical (aligned with the Y axis) throughout. The screen rotates from facing −X (toward the player) to facing **+Y** (upward) — the screen normal ends pointing skyward.

---

## Defensive Moves

### Block
A held defensive posture used specifically to stop jabs. Not a swing — the phone is pushed forward and held steady.

- **Motion:** A short translation in **+X** (forward push from guard), then held still. No rotation, no swing.
- **Phone facing:** Phone stays vertical, long axis along +Y. The screen continues to face the player (screen normal in **−X**), so the back of the phone presents toward the incoming attack.

### Heal
A held recovery posture. Cannot be used at the same time as a block.

- **Motion:** A short translation in **−X** (pulled inward, toward the player's torso), then held still in a calm, steady position.
- **Phone facing:** Phone stays vertical, long axis along +Y. Screen continues to face the player (screen normal in **−X**). No rotation.

---

## Dodges

### Dodge Side (left or right)
A quick lateral lean used to dodge uppercuts.

- **Motion:** The phone rolls sharply about the **X axis** as the player leans their torso. For a **right dodge**, the top edge of the phone tips in +Z (to the player's right); for a **left dodge**, the top tips in −Z. A small lateral translation along Z accompanies the lean.
- **Phone facing:** The screen normal rotates away from −X. For a right dodge it ends pointing roughly in a **−X / −Z** mix (toward the player and slightly to their left); for a left dodge it ends pointing roughly in a **−X / +Z** mix (toward the player and slightly to their right). Roll angle is typically 30–60° from vertical.

### Dodge Back
A backward lean or step. Used to dodge jabs and right hooks.

- **Motion:** The phone translates in **−X** (backward, toward the player) and dips slightly in −Y as the torso leans back. The motion is dominated by pitch rotation about the Z axis.
- **Phone facing:** The phone pitches backward — the top edge tips in −X — so the screen normal rotates from −X toward a **−X / −Y** mix (screen tilting to face partly upward, toward the player's chin).

---

## Counter Chart

| Attack      | Countered by                  |
|-------------|-------------------------------|
| Jab         | Block, or dodge back          |
| Right hook  | Dodge back                    |
| Uppercut    | Dodge side (left or right)    |

Heal has no offensive counterpart — it is for recovery between exchanges, not a response to an incoming attack.
