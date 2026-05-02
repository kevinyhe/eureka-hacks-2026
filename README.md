# Wii Boxing Server

WebSocket relay server for a two-player Wii Boxing-style hackathon game.
Phones do their own motion classification; the server validates and relays
already-decided actions between the two players and the room's display
client. Game logic itself is **not implemented yet** — the `Match` class is
a stub. See [`PLAN.md`](./PLAN.md) for the full design.

## Run

```
npm install
npm start              # plain pino JSON logs
npm run dev            # pretty-printed logs (requires pino-pretty)
```

Default port 3000. WebSocket endpoint at `/ws`. Debug snapshot at `/debug`.
Health probe at `/health`.

Configurable via env vars (see [`server/config.js`](./server/config.js)):
`PORT`, `RATE_LIMIT_PER_SEC`, `RATE_LIMIT_BURST`, `PING_INTERVAL_MS`,
`PING_TIMEOUT_MS`, `DISCONNECT_TIMEOUT_MS`, `RECONNECT_GRACE_MS`,
`ROOM_IDLE_TIMEOUT_MS`, `ROOM_CODE_LENGTH`, `LOG_LEVEL`.

## Fake client

The CLI harness in [`server/scripts/fakeClient.js`](./server/scripts/fakeClient.js)
simulates a phone or display with colored I/O.

```
node server/scripts/fakeClient.js --scenario display_only
node server/scripts/fakeClient.js --scenario join_as_p1 --room 1234 --name Mike
node server/scripts/fakeClient.js --scenario join_as_p2 --room 1234 --name Liam
node server/scripts/fakeClient.js --scenario spam_actions --room 1234
node server/scripts/fakeClient.js --scenario bad_payload
node server/scripts/fakeClient.js --scenario disconnect_mid_match
node server/scripts/fakeClient.js --scenario interactive --room 1234 --name Mike
```

`interactive` opens a REPL — keys: `j`/`h`/`u` (jab/hook/uppercut),
`a`/`d`/`s` (dodge L/R/duck), `b` toggle block, `q` or ctrl+c quit.
Requires a real terminal (TTY).

Override the URL with `WS_URL=ws://other-host:3000/ws ...`.

## Browser test page

A buttons-only test client lives at
[`server/public/test.html`](./server/public/test.html) and is served at
**`http://<host>:3000/test.html`**. No build step, no sensors required —
the server already takes pre-classified actions, so a button page is a
complete client.

To test with two phones on the same Wi-Fi:

1. Find your LAN IP (`ipconfig` on Windows, look for the IPv4 of your
   active adapter).
2. Allow inbound port 3000 through Windows Firewall the first time:
   `New-NetFirewallRule -DisplayName "wii-boxing-3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow`
   (admin PowerShell).
3. On phone #1, browse to `http://<lan-ip>:3000/test.html` and tap **I am
   the Display** — note the 4-digit room code.
4. On phone #2, browse to the same URL, tap **I am a Player**, enter the
   code, tap **Join**.
5. Tap action buttons; both the display and the other player see
   `player:action_relay`. Hold **HOLD TO BLOCK** to send `block_start` and
   release for `block_end`.

For testing on the laptop's own browser, just use `http://localhost:3000/test.html`.

## Quick smoke test

```
# terminal 1
npm start

# terminal 2 — start a display, prints the room code
node server/scripts/fakeClient.js --scenario display_only

# terminal 3 + 4 — join with the printed code
node server/scripts/fakeClient.js --scenario join_as_p1 --room <code>
node server/scripts/fakeClient.js --scenario join_as_p2 --room <code>

# terminal 5 — peek at live state
curl http://localhost:3000/debug | python -m json.tool
```

---

## Message contract

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

Server: validates, rate-limits, calls `match.onAction(...)` (stub), then
relays as `player:action_relay` to display + the other player.

Errors: `NOT_IN_ROOM`, `INVALID_PAYLOAD`, `RATE_LIMITED`.

#### `player:block_start` / `player:block_end`

```json
{ "type": "player:block_start", "data": {} }
{ "type": "player:block_end",   "data": {} }
```

Stateful: blocking is held between these two events. The server itself
holds no block state in this phase — it just relays the bracketing events.

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
for liveness detection. `ping`/`pong` here exist purely so clients can
measure round-trip time using the same JSON envelope.

### Server → client

#### `room:created` (to display)

```json
{ "type": "room:created",
  "data": { "roomCode": "1234" }, "t": 12345 }
```

#### `room:joined` (to joining player)

```json
{ "type": "room:joined",
  "data": { "playerId": "P1", "roomCode": "1234" }, "t": 12345 }
```

#### `room:player_status` (to all room members)

```json
{ "type": "room:player_status",
  "data": {
    "playerId": "P1",
    "status": "connected",
    "displayName": "Mike"
  },
  "t": 12345 }
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
    "serverT": 12345
  },
  "t": 12345 }
```

| Field      | Type   | Required | Notes                                                        |
|------------|--------|----------|--------------------------------------------------------------|
| `playerId` | string | yes      | `"P1"` or `"P2"`.                                            |
| `action`   | string | yes      | The original action enum, OR `"block_start"` / `"block_end"`. |
| `power`    | number | optional | Echoed from the originator. Omitted for `block_start`/`block_end`. |
| `serverT`  | number | yes      | Server's monotonic ms timestamp at relay time. Canonical clock. |

Both the envelope `t` and the inner `serverT` are set to the same server
clock value.

#### `error` (to offending connection only)

```json
{ "type": "error",
  "data": {
    "code": "INVALID_PAYLOAD",
    "message": "data.power must be a number between 0 and 1",
    "details": { "issues": [] }
  },
  "t": 12345 }
```

`details` is optional and surfaces zod's structured errors during dev.

| Code               | Cause                                                          |
|--------------------|----------------------------------------------------------------|
| `INVALID_PAYLOAD`  | Frame is not valid JSON / fails envelope or zod schema.        |
| `UNKNOWN_TYPE`     | `type` is not a recognized inbound message.                    |
| `ROOM_NOT_FOUND`   | `roomCode` does not match an active room.                      |
| `ROOM_FULL`        | Both player slots already taken (and not disconnected).        |
| `NOT_IN_ROOM`      | Sent a room-context message before joining a room.             |
| `ALREADY_IN_ROOM`  | Connection already has a role and tried to bind again.         |
| `INVALID_STATE`    | Message is well-formed but doesn't make sense in current state. |
| `RATE_LIMITED`     | Token bucket exhausted (default 15/sec, burst 15).             |
| `INTERNAL_ERROR`   | Unexpected exception caught at the top-level handler.          |

#### `pong`

```json
{ "type": "pong",
  "data": { "serverT": 12345 }, "t": 12345 }
```

### Reserved (not implemented this phase)

These types are reserved for the game-logic phase. The server will not emit
them today; clients should ignore unknown types defensively.

- `game:state` — periodic snapshot of match state (HP, phase, combo, etc.).
- `game:event` — discrete events: hits, blocks, dodges, KOs, combo
  notifications.
- `game:countdown` — pre-match countdown ticks.

---

## Layout

```
server/
├── index.js                 # http server, ws server, /debug, dispatch loop
├── config.js                # all tunables, env overrides
├── rooms/
│   ├── roomManager.js       # registry, code generation, sweeper
│   └── room.js              # one room: display + 2 player slots + Match stub
├── game/
│   └── match.js             # STUB — game logic plugs in here
├── net/
│   ├── messages.js          # MessageType / ErrorCode enums + zod schemas
│   ├── envelope.js          # parse/serialize the {type, data, t} wrapper
│   ├── handlers.js          # dispatch registry (registerHandler/dispatch)
│   ├── roomHandlers.js      # display:create_room, player:join, close hook
│   ├── actionHandlers.js    # player:action, player:block_start/end
│   ├── connection.js        # wraps a ws socket (id, role, lastSeenAt, bucket)
│   ├── rateLimiter.js       # token bucket
│   └── heartbeat.js         # protocol ping + inbound watchdog
├── scripts/
│   └── fakeClient.js
└── utils/
    ├── logger.js            # pino instance
    └── timing.js            # monotonic ms helper
```

## Game logic seam (for the next phase)

Empty methods on [`server/game/match.js`](./server/game/match.js) get called
from `Room`:

- `match.onAction(playerId, { action, power, serverT })` — fires after
  every relayed action. Plug combat math here.
- `match.tick(dtMs)` — not invoked yet; wire a `setInterval` at
  `1000/TICK_HZ` ms when adding the match loop.
- `match.getState()` — surfaced through `/debug`.
