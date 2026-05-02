# Wii Boxing Server — Phase 1 Plan

This is the design for the **WebSocket transport layer** of a two-player Wii
Boxing-style game. Phone clients perform their own motion classification and
send already-decided game actions; this server is a validated relay between
the two phones and the room's display client.

> **Scope of this phase:** networking only. Room management, message
> validation, action relay, rate limiting, heartbeats, disconnect detection.
> **Out of scope (this phase):** combat math, motion classification, combo
> tracking, win conditions, tick-driven game state. A `Match` class is
> scaffolded as a stub so game logic can be dropped in later without
> reshaping any of the transport plumbing.

---

## 1. Architecture overview

### Components

| Component       | Process       | Owner of                                        |
|-----------------|---------------|-------------------------------------------------|
| Phone client    | external      | motion sensors, action classification, UI       |
| Display client  | external      | rendering the match for spectators              |
| **This server** | Node.js 20+   | rooms, connection state, message contract, relay |

### Connection topology

Every match is a **room** with three roles:

```
       ┌─────────────┐                  ┌─────────────┐
       │  Phone P1   │                  │  Phone P2   │
       └──────┬──────┘                  └──────┬──────┘
              │ ws://.../ws                    │
              │                                │
              ▼                                ▼
              ┌──────────────────────────────────┐
              │      Node server (this repo)     │
              │   ┌──────────────────────────┐   │
              │   │ Room "1234"              │   │
              │   │  ├─ P1 connection        │   │
              │   │  ├─ P2 connection        │   │
              │   │  ├─ display connection   │   │
              │   │  └─ Match (stub)         │   │
              │   └──────────────────────────┘   │
              └─────────────────┬────────────────┘
                                │
                                ▼
                        ┌──────────────┐
                        │  Display TV  │
                        └──────────────┘
```

A room holds **at most two players (P1, P2 by join order) and one display**.
All three connect to the same `/ws` endpoint; their role is established by
the first room-binding message they send (`display:create_room` or
`player:join`).

### Data flow (this phase)

1. Display sends `display:create_room` → server allocates a 4-digit code,
   replies `room:created`.
2. Phones send `player:join {roomCode}` → server assigns P1 or P2, replies
   `room:joined`, broadcasts `room:player_status` to the rest of the room.
3. Phones send `player:action` (or `player:block_start`/`block_end`).
   Server validates, rate-limits, and **relays** the action as
   `player:action_relay` to the *other* members of the room (display +
   opponent). The originator does not receive its own relay.
4. The server stamps `serverT` on every relay so downstream consumers have
   a single trusted clock.
5. The server also calls `match.onAction(...)` — a stub today; future game
   logic plugs in here.

### Authority

- **Server owns**: room registry, connection identity, slot assignment,
  message validation, server timestamps, rate limits.
- **Phones own** (this phase): motion classification, action choice.
- **Display owns**: rendering. It can read from `player:action_relay` to
  drive animations even before any game logic exists.

When the game logic phase lands, authority for HP, combat outcomes, combo
state, and match phase moves to the server. The transport layer stays
unchanged.

---

## 2. Connection lifecycle

Each WebSocket connection moves through a small state machine:

```
     ws.open
        │
        ▼
   ┌─────────────┐    display:create_room     ┌─────────────────┐
   │  CONNECTED  │ ─────────────────────────► │  ROOM_DISPLAY   │
   │  (no role)  │                            │  (one per room) │
   │             │       player:join          └────────┬────────┘
   │             │ ─────────────┐                      │
   └──────┬──────┘              │                      │
          │                     ▼                      │
          │            ┌──────────────────┐            │
          │            │   ROOM_PLAYER    │            │
          │            │     (P1 / P2)    │            │
          │            └────────┬─────────┘            │
          │                     │                      │
          │ ws.close /          │ ws.close /           │ ws.close /
          │ heartbeat timeout   │ heartbeat timeout    │ heartbeat timeout
          ▼                     ▼                      ▼
   ┌──────────────────────────────────────────────────────────┐
   │                       DISCONNECTED                       │
   │  (slot marked, room broadcasts room:player_status,       │
   │   slot held for RECONNECT_GRACE_MS, then released)       │
   └──────────────────────────────────────────────────────────┘
```

### Lifecycle events

| Event                   | Server behavior                                                                   |
|-------------------------|-----------------------------------------------------------------------------------|
| **connect**             | Register connection, assign internal id, no role yet. Start heartbeat watchdog.   |
| **display:create_room** | Allocate code, attach connection as room display. Reply `room:created`.           |
| **player:join (open slot)** | Assign P1 if free else P2. Reply `room:joined`. Broadcast `room:player_status: connected`. |
| **player:join (room full)** | Reply `error{code: ROOM_FULL}`. Connection stays in CONNECTED.                |
| **player:join (no room)**   | Reply `error{code: ROOM_NOT_FOUND}`.                                          |
| **duplicate join (same conn)** | Reply `error{code: ALREADY_IN_ROOM}`. Original role unchanged.             |
| **reconnect**           | If a slot is currently marked `disconnected` for the same role, the new connection takes it; broadcast `room:player_status: connected`. (See note below.) |
| **disconnect (close / timeout)** | Mark slot disconnected, broadcast `room:player_status: disconnected`, hold slot for `RECONNECT_GRACE_MS` (default 60s). |
| **room empty + idle**   | After `ROOM_IDLE_TIMEOUT_MS` (default 60s) of no connected members, destroy room. |

### Reconnect handling (hackathon-grade)

A returning phone re-runs `player:join {roomCode}`. If a slot is held in
`disconnected` state, the new socket inherits that slot. We do **not**
authenticate which phone is which — for a 1-day hackathon the timing window
makes mistaken takeover unlikely, and adding tokens would slow integration
with the phone client team. Listed in open questions.

### Single-role-per-connection invariant

Once a connection has a role (display, P1, or P2), it keeps it for life.
A second binding message on the same connection returns
`error{code: ALREADY_IN_ROOM}` and does not change state.

---

## 3. Room model

### Codes

- Format: 4 numeric digits (`"0001"`–`"9999"`). Zero-padded, transmitted as
  strings to avoid leading-zero loss in JSON.
- Generated by uniform random in `[1, 9999]`, retried on collision (with a
  hard cap of 100 attempts before erroring — at 9999 capacity this is
  effectively impossible for a hackathon).
- Codes are reusable: when a room is destroyed, its code returns to the
  pool.
- Length is the `ROOM_CODE_LENGTH` config value so we can bump to 5 or 6
  digits if needed.

### Server-side data structures

```
RoomManager
  rooms: Map<string, Room>           // keyed by code
  connections: Map<string, Connection>  // keyed by internal connection id

Room
  code: string
  display: Connection | null
  players: { P1: PlayerSlot, P2: PlayerSlot }
  match: Match                        // STUB — see §9
  createdAt: number                   // serverT ms
  lastActivityAt: number              // serverT ms
  destroyTimer: NodeJS.Timeout | null

PlayerSlot
  connection: Connection | null
  displayName: string | null
  status: "connected" | "disconnected"
  disconnectedAt: number | null

Connection
  id: string                          // internal uuid
  ws: WebSocket
  role: "none" | "display" | "P1" | "P2"
  roomCode: string | null
  lastSeenAt: number                  // serverT ms — updated on every inbound message
  rateLimiter: TokenBucket
```

### Cleanup

Destroy a room when **all** of:

1. `display` is null,
2. both player slots are null *or* both are `disconnected`,
3. `lastActivityAt` is older than `ROOM_IDLE_TIMEOUT_MS`.

Implementation: a single sweeper runs every 5 seconds and destroys rooms
matching the predicate. Cheaper than per-room timers and simpler to reason
about.

If a reconnect arrives while a room is in the disconnected-but-not-yet-swept
state, it takes its slot and the cleanup criteria no longer hold.

---

## 4. Message contract

### Envelope

Every message — both directions — is a JSON object:

```json
{ "type": "namespace:name", "data": { ... }, "t": 1714579200123 }
```

| Field   | Type    | Required | Description                                                          |
|---------|---------|----------|----------------------------------------------------------------------|
| `type`  | string  | yes      | Identifies the message. Namespaced: `display:`, `player:`, `room:`, `game:`, `error`, `pong`, `ping`. |
| `data`  | object  | yes      | Type-specific payload. May be `{}`.                                  |
| `t`     | number  | optional inbound, **always set outbound** | Sender's clock in ms. On inbound, this is the client's `Date.now()` and is treated as untrusted (used for debug only). On outbound, the server sets it to `serverT` (monotonic ms). |

Anything not matching this envelope shape is rejected with `INVALID_PAYLOAD`.

### Client → server

#### `display:create_room`

```json
{ "type": "display:create_room", "data": {} }
```

Caller becomes the display for a freshly-allocated room. Errors:
- `ALREADY_IN_ROOM` — connection already has a role.

Server reply: `room:created`.

#### `player:join`

```json
{ "type": "player:join",
  "data": { "roomCode": "1234", "displayName": "Mike" } }
```

| Field         | Type    | Required | Notes                                          |
|---------------|---------|----------|------------------------------------------------|
| `roomCode`    | string  | yes      | 4 numeric digits.                              |
| `displayName` | string  | optional | 1–32 chars; trimmed; defaults to `"P1"`/`"P2"`. |

Server reply (to sender): `room:joined`.
Server broadcast (to other room members): `room:player_status`.

Errors: `ROOM_NOT_FOUND`, `ROOM_FULL`, `ALREADY_IN_ROOM`, `INVALID_PAYLOAD`.

#### `player:action`

```json
{ "type": "player:action",
  "data": { "action": "punch_jab", "power": 0.8 } }
```

| Field    | Type   | Required | Notes                                                           |
|----------|--------|----------|-----------------------------------------------------------------|
| `action` | enum   | yes      | One of `punch_jab`, `punch_hook`, `punch_uppercut`, `dodge_left`, `dodge_right`, `dodge_down`. |
| `power`  | number | optional | `0.0`–`1.0`; clamped if out of range. Defaults to `1.0` if absent. |

Server: validates, rate-limits, calls `match.onAction(...)`, then relays as
`player:action_relay` to display + the other player.

Errors: `NOT_IN_ROOM`, `INVALID_PAYLOAD`, `RATE_LIMITED`.

#### `player:block_start` / `player:block_end`

```json
{ "type": "player:block_start", "data": {} }
{ "type": "player:block_end",   "data": {} }
```

Stateful: blocking is held between these two events. The server itself
holds no block state in this phase — it just relays the bracketing events.
A future Match implementation will track block state per player.

Relayed as `player:action_relay` with `action: "block_start"` and
`action: "block_end"` respectively, so display code has a single message
type to listen on.

Errors: `NOT_IN_ROOM`, `RATE_LIMITED`.

#### `ping`

```json
{ "type": "ping", "data": {} }
```

Optional client-initiated RTT probe. Server replies `pong` immediately.
Note: this is **separate** from the WebSocket protocol-level ping/pong used
for liveness detection (§7). `ping`/`pong` here exist purely so clients can
measure round-trip time using the same JSON envelope.

### Server → client

#### `room:created` (to display)

```json
{ "type": "room:created",
  "data": { "roomCode": "1234" }, "t": 12345.67 }
```

#### `room:joined` (to joining player)

```json
{ "type": "room:joined",
  "data": { "playerId": "P1", "roomCode": "1234" }, "t": 12345.67 }
```

#### `room:player_status` (to all room members)

```json
{ "type": "room:player_status",
  "data": {
    "playerId": "P1",
    "status": "connected",
    "displayName": "Mike"
  },
  "t": 12345.67 }
```

`status` is `"connected"` or `"disconnected"`. `displayName` is included
on `connected`; omitted on `disconnected`.

Sent on: join, reconnect, disconnect.

#### `player:action_relay` (to display + opponent, **not** the originator)

```json
{ "type": "player:action_relay",
  "data": {
    "playerId": "P1",
    "action": "punch_jab",
    "power": 0.8,
    "serverT": 12345.67
  },
  "t": 12345.67 }
```

| Field      | Type   | Required | Notes                                                        |
|------------|--------|----------|--------------------------------------------------------------|
| `playerId` | string | yes      | `"P1"` or `"P2"`.                                            |
| `action`   | string | yes      | The original action enum, OR `"block_start"` / `"block_end"`. |
| `power`    | number | optional | Echoed from the originator. Omitted for `block_start`/`block_end`. |
| `serverT`  | number | yes      | Server's monotonic ms timestamp at relay time. Canonical clock. |

Both the envelope `t` and the inner `serverT` are set to the same server
clock value. Including `serverT` in `data` means downstream consumers
don't need to look at envelope metadata to read the canonical time.

#### `error` (to offending connection only)

```json
{ "type": "error",
  "data": {
    "code": "INVALID_PAYLOAD",
    "message": "data.power must be a number between 0 and 1",
    "details": { "issues": [ ... ] }
  },
  "t": 12345.67 }
```

`details` is optional and used to surface zod's structured errors during
development. Codes enumerated in §5.

#### `pong`

```json
{ "type": "pong",
  "data": { "serverT": 12345.67 }, "t": 12345.67 }
```

### Reserved (not implemented this phase)

The following types are reserved so my teammates know not to claim those
names. They will appear in a later phase:

- `game:state` — periodic snapshot of match state (HP, phase, combo, etc.).
- `game:event` — discrete events: hits, blocks, dodges, KOs, combo
  notifications.
- `game:countdown` — pre-match countdown ticks.

The transport layer will not emit any of these in this phase. Clients
should ignore unknown types they receive (defensive forward-compat).

---

## 5. Validation & error handling

### Validation pipeline

Every inbound frame goes through:

1. **Frame type check** — must be a string (text frame). Binary frames are
   rejected with `INVALID_PAYLOAD`.
2. **JSON parse** — must parse. Failure → `INVALID_PAYLOAD`.
3. **Envelope schema** — `{type: string, data: object, t?: number}`. Failure
   → `INVALID_PAYLOAD`.
4. **Type lookup** — `type` must match a known inbound message. Failure →
   `UNKNOWN_TYPE`.
5. **Per-type zod schema** — the `data` payload validated against a
   per-type zod schema. Failure → `INVALID_PAYLOAD` with `details.issues`
   set to the zod issue list.
6. **State precondition** — the connection's role must be valid for this
   message (e.g., `player:action` requires `role` ∈ {P1, P2}). Failure →
   `NOT_IN_ROOM` or `INVALID_STATE`.
7. **Rate limit** — for `player:action` and `player:block_*`. Failure →
   `RATE_LIMITED`.
8. **Handler runs** under a top-level try/catch. Any unexpected throw is
   logged via pino and returned as `INTERNAL_ERROR` — the connection stays
   open.

### Error codes

| Code               | Cause                                                          |
|--------------------|----------------------------------------------------------------|
| `INVALID_PAYLOAD`  | Frame is not valid JSON / fails envelope or zod schema.        |
| `UNKNOWN_TYPE`     | `type` is not a recognized inbound message.                    |
| `ROOM_NOT_FOUND`   | `roomCode` does not match an active room.                      |
| `ROOM_FULL`        | Both player slots already taken (and not disconnected).        |
| `NOT_IN_ROOM`      | Sent a room-context message before joining a room.             |
| `ALREADY_IN_ROOM`  | Connection already has a role and tried to bind again.         |
| `INVALID_STATE`    | Message is well-formed but doesn't make sense in current state. |
| `RATE_LIMITED`     | Token bucket exhausted.                                        |
| `INTERNAL_ERROR`   | Unexpected exception caught at the top-level handler.          |

### Crash safety

- All inbound message handlers are wrapped in try/catch.
- `process.on('uncaughtException')` and `process.on('unhandledRejection')`
  log and **do not exit**. (For a 24h hackathon I'd rather log and limp
  than restart.)
- Bad input never disconnects the offender. We send `error` and continue.

---

## 6. Rate limiting

A token bucket per connection, applied to action-class messages
(`player:action`, `player:block_start`, `player:block_end`).

| Tunable                  | Default | Meaning                                  |
|--------------------------|---------|------------------------------------------|
| `RATE_LIMIT_PER_SEC`     | 15      | Steady-state refill rate (tokens/sec).   |
| `RATE_LIMIT_BURST`       | 15      | Bucket capacity (max instantaneous burst).|

**Only action-class messages cost tokens.** `ping`, `display:create_room`,
`player:join` are not rate-limited — they're either rare or self-throttling.

When the bucket is empty:
- The message is **dropped** (not relayed, `match.onAction` not called).
- An `error{code: RATE_LIMITED}` is sent to the offender.
- The connection stays open.

The bucket refills continuously (lazy refill calculated on each access:
`tokens = min(burst, tokens + elapsedMs/1000 * rate)`).

15/sec sustained is well above any realistic boxing input rate — a
double-jab fires maybe 4/sec at peak. The cap exists so a buggy or
malicious client can't flood the relay path.

---

## 7. Heartbeats & disconnect detection

Two layers. Clearly separated.

### Layer 1: WebSocket protocol ping/pong (liveness)

Use `ws`'s built-in ping frames. The server sends a ping frame to every
connection every `PING_INTERVAL_MS`; browsers (and the `ws` Node client)
auto-reply with a pong frame. If a pong is not received within
`PING_TIMEOUT_MS`, the server calls `ws.terminate()` and the connection
moves to disconnected.

This is preferred over an application-level keepalive because it's a
single binary frame, requires no client-side code, and `ws` handles all
the bookkeeping.

| Tunable                | Default  | Meaning                                            |
|------------------------|----------|----------------------------------------------------|
| `PING_INTERVAL_MS`     | 15000    | How often the server sends a ping frame.           |
| `PING_TIMEOUT_MS`      | 5000     | How long to wait for the pong before terminating.  |
| `DISCONNECT_TIMEOUT_MS`| 30000    | Failsafe: force-close if no inbound traffic at all in this window. |

`DISCONNECT_TIMEOUT_MS` is a belt-and-suspenders. It catches edge cases
where the OS-level TCP socket is wedged but the ws layer hasn't given up
yet.

### Layer 2: application-level `ping`/`pong` messages (RTT debug)

Used by the client to measure round-trip latency. Server replies
immediately. Not used for liveness — neither side is required to send
these.

### On disconnect

Whether by clean close, ping timeout, or watchdog, the sequence is:

1. Mark the connection's slot in its room as `status: "disconnected"`,
   `disconnectedAt: now`.
2. Broadcast `room:player_status: disconnected` to remaining members.
3. Start the slot's reconnect grace timer (`RECONNECT_GRACE_MS`, 60s).
4. If grace expires with no reconnect, fully release the slot. The room
   sweeper (§3) will collect the room if it's also otherwise empty.

---

## 8. Server timestamps

- **Source**: `performance.now()`, exposed via `utils/timing.js#nowMs()`,
  returning a `number` of monotonic ms since process start. Floor to
  integer ms before sending — JSON numbers stay clean, sub-ms resolution
  is unnecessary for game timing at 30Hz.
- **Where it's used**:
  - `serverT` field on `player:action_relay`.
  - `t` field on every server-originated envelope.
  - `lastSeenAt` on every connection, `lastActivityAt` on every room.
  - All log timestamps via pino.
- **Client `t` (inbound)**: preserved in logs and in the `lastSeenAt`
  bookkeeping for the connection, but **never** propagated into a relay or
  any other outbound message. Treat it as untrusted: phone clocks drift,
  so any combat-relevant timing must use `serverT`.
- Wall-clock time (`Date.now()`) is used only by pino's timestamp helper
  for human-readable log lines.

---

## 9. Game-logic seams

The future game logic plugs into a single class: `server/game/match.js`.

```js
// server/game/match.js
export class Match {
  /**
   * @param {string} roomCode
   */
  constructor(roomCode) {
    this.roomCode = roomCode;
    // TODO: phase, hp per player, combo trackers, etc.
  }

  /**
   * Receives a validated, rate-limit-passed action from a player.
   * Game logic plugs in here. Today: no-op.
   *
   * @param {"P1"|"P2"} playerId
   * @param {{ action: string, power: number, serverT: number }} payload
   */
  onAction(playerId, payload) {
    // TODO: combat math, combo tracking, HP, KO detection.
  }

  /**
   * Periodic tick. Not invoked this phase — wired in when a tick loop
   * is added (e.g. setInterval at 1000/TICK_HZ ms).
   *
   * @param {number} dtMs
   */
  tick(dtMs) {
    // TODO.
  }

  /**
   * Snapshot used by the /debug HTTP route.
   * @returns {object}
   */
  getState() {
    return { phase: 'idle' }; // TODO real state
  }
}
```

### Call sites the room owns

The `Room` class wires the seam in two places:

1. On every accepted action message:
   ```js
   // 1. relay to other room members
   this.relay(senderId, 'player:action_relay', { ...payload, serverT });
   // 2. notify the match (stub today)
   this.match.onAction(senderId, { ...payload, serverT });
   ```
   Order chosen: **relay first, then `onAction`.** Reason: today
   `onAction` is a no-op so order doesn't matter, but in the future I want
   the display to receive actions even if the match transitions to a
   "frozen" or "post-KO" state — moving the relay decision into game
   logic is a deliberate later choice, not an accidental coupling now.

2. The `tick()` method is **not** called this phase — no `setInterval` is
   started. The seam exists, but stays dormant. `TICK_HZ` is reserved as
   a config constant so the value is decided once.

### What changes when game logic lands

- `match.onAction` starts mutating state, so the relay payload may grow
  fields like `outcome`, `damage`, `defenderHp`, etc. The envelope shape
  stays the same.
- A tick driver is added to the room (`setInterval` at `1000/TICK_HZ`).
- New outbound types (`game:state`, `game:event`, `game:countdown`) get
  emitted from inside `Match` via a callback the room provides
  (`onMatchEvent(type, data)` → broadcast helper).

None of the transport plumbing (envelope, validation, room registry,
rate limiting, heartbeats, error handling) needs to change.

---

## 10. Open questions

1. **Reconnect identity.** A returning phone has no token, so any phone
   that knows the room code can take over a disconnected slot. OK for a
   hackathon LAN demo? If not, smallest fix is a one-time
   `reconnectToken` returned in `room:joined` that the phone passes back
   on rejoin.
2. **Reconnect grace window.** Default proposed: 60s. Some hackathon
   demos prefer "instant forfeit" so onlookers see decisive outcomes —
   want me to set this lower (5–10s) or to 0?
3. **Display receives `player:action_relay`?** I'm planning yes — display
   needs to drive animations off actions. Confirm.
4. **Multiple displays per room.** Currently one. Some setups want a
   primary screen + a streaming overlay; trivial to support if needed.
5. **`power` default.** When omitted, default to `1.0`? Or treat absence
   as "phone didn't measure power" and pass through as `null`?
6. **Should the relay echo `displayName`?** Right now display has to map
   `playerId → name` from `room:player_status`. Echoing on every relay is
   wasteful but more self-contained for the display dev.
7. **Stale `t` rejection.** Should the server reject inbound messages
   whose client `t` is more than e.g. 60s off from server time? I lean
   no (clocks drift, no security need), but flagging it.
8. **`/debug` exposure.** Currently no auth — anyone who can reach the
   port can see room state. Fine on LAN; want a token if we host on the
   open internet?
9. **Room idle timeout.** Default proposed: 60s. Lower for snappier
   recovery from "wrong code typed", higher for forgiveness. Worth tuning?
10. **`ROOM_CODE_LENGTH = 4`.** With 9999 capacity and an in-memory map,
    we're nowhere near collisions, but if your team would prefer a 5- or
    6-digit code for "looks more official" reasons, it's a one-line
    change.

---

## Appendix A — Stack & versions

Pinned in `package.json`:

| Package    | Version | Why                                                       |
|------------|---------|-----------------------------------------------------------|
| `ws`       | ^8.18.0 | Lower-level WS server; clients can use the browser native `WebSocket` API with no protocol overhead. |
| `express`  | ^4.21.1 | Tiny, well-known HTTP layer for the `/debug` route. Shares the same `http.Server` as `ws`. |
| `zod`      | ^3.23.8 | Concise schemas, structured error issues we can ship in `error.details`. |
| `pino`     | ^9.5.0  | Fast JSON logger; pino-pretty optional in dev.            |
| `chalk`    | ^5.3.0  | Colored output in `scripts/fakeClient.js`.                |

Dev-only:
- `pino-pretty` — optional, prettifies dev logs.

Node 20+ required (top-level `await`, native `crypto.randomUUID()`,
WebStreams not used but available, ESM matures).

## Appendix B — Configurable tunables

All in `server/config.js`, overridable by env var.

| Key                     | Env var                  | Default | Used in        |
|-------------------------|--------------------------|---------|----------------|
| `PORT`                  | `PORT`                   | `3000`  | HTTP/WS bind   |
| `TICK_HZ`               | `TICK_HZ`                | `30`    | reserved §9    |
| `RATE_LIMIT_PER_SEC`    | `RATE_LIMIT_PER_SEC`     | `15`    | §6             |
| `RATE_LIMIT_BURST`      | `RATE_LIMIT_BURST`       | `15`    | §6             |
| `PING_INTERVAL_MS`      | `PING_INTERVAL_MS`       | `15000` | §7             |
| `PING_TIMEOUT_MS`       | `PING_TIMEOUT_MS`        | `5000`  | §7             |
| `DISCONNECT_TIMEOUT_MS` | `DISCONNECT_TIMEOUT_MS`  | `30000` | §7             |
| `RECONNECT_GRACE_MS`    | `RECONNECT_GRACE_MS`     | `60000` | §2             |
| `ROOM_IDLE_TIMEOUT_MS`  | `ROOM_IDLE_TIMEOUT_MS`   | `60000` | §3             |
| `ROOM_CODE_LENGTH`      | `ROOM_CODE_LENGTH`       | `4`     | §3             |

## Appendix C — Folder structure

The structure proposed in the prompt is fine; I've kept it as-is.
Specifically, `net/connection.js` (not `rooms/connection.js`) keeps
transport concerns together, and `rateLimiter.js` and `heartbeat.js` live
in `net/` because both are connection-scoped. No revisions.

```
server/
├── index.js                 # bootstrap: http server, ws server, /debug route
├── config.js                # all tunables, env overrides
├── rooms/
│   ├── roomManager.js       # create/join/cleanup, code generation
│   └── room.js              # holds connections + a Match stub
├── game/
│   └── match.js             # STUB: onAction(), tick(), getState()
├── net/
│   ├── messages.js          # zod schemas, MessageType enum
│   ├── envelope.js          # parse/serialize the {type, data, t} wrapper
│   ├── handlers.js          # one async handler per inbound message type
│   ├── connection.js        # wraps a ws socket, owns send/recv + last-seen
│   ├── rateLimiter.js       # token bucket
│   └── heartbeat.js         # ping/pong + timeout watcher
├── scripts/
│   └── fakeClient.js
└── utils/
    ├── logger.js            # pino instance
    └── timing.js            # monotonic ms helper
```
