#!/usr/bin/env node
/**
 * Fake-client harness — simulates a phone or display client against the
 * server. The dev tool I'll spend most of my time in. Run scenarios from
 * the CLI, watch colored I/O.
 *
 * Examples:
 *   node server/scripts/fakeClient.js --scenario display_only
 *   node server/scripts/fakeClient.js --scenario join_as_p1 --room 1234
 *   node server/scripts/fakeClient.js --scenario spam_actions --room 1234
 *   node server/scripts/fakeClient.js --scenario bad_payload
 *   node server/scripts/fakeClient.js --scenario disconnect_mid_match
 */

import WebSocket from 'ws';
import chalk from 'chalk';

const DEFAULT_URL = process.env.WS_URL || 'ws://localhost:3000/ws';

// ---------------- arg parsing (tiny, no deps) ----------------
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

// ---------------- logging ----------------
function tag(label, color) {
  return color(`[${label.padEnd(7)}]`);
}
function logSent(label, msg) {
  console.log(tag(label, chalk.cyan), chalk.cyan('->'), JSON.stringify(msg));
}
function logRecv(label, msg) {
  if (msg.type === 'error') {
    console.log(tag(label, chalk.red), chalk.red('<-'), JSON.stringify(msg));
  } else {
    console.log(tag(label, chalk.green), chalk.green('<-'), JSON.stringify(msg));
  }
}
function logInfo(label, line) {
  console.log(tag(label, chalk.yellow), chalk.yellow('··'), line);
}
function logFatal(label, line) {
  console.log(tag(label, chalk.red), chalk.red('XX'), line);
}

// ---------------- client helper ----------------
/**
 * Open a ws connection with a labeled logger. Resolves once OPEN.
 *
 * @param {string} label
 * @param {string} url
 * @param {(msg: object, raw: string) => void} [onMessage]
 * @returns {Promise<{ws: WebSocket, send: (type: string, data?: object) => void}>}
 */
function connect(label, url, onMessage) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      logInfo(label, `connected ${url}`);
      resolve({
        ws,
        send: (type, data = {}) => {
          const msg = { type, data, t: Date.now() };
          logSent(label, msg);
          ws.send(JSON.stringify(msg));
        },
        sendRaw: (raw) => {
          logSent(label, raw);
          ws.send(raw);
        },
      });
    });
    ws.on('message', (raw) => {
      const text = raw.toString();
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        logRecv(label, { _unparsable: text });
        return;
      }
      logRecv(label, msg);
      onMessage?.(msg, text);
    });
    ws.on('close', (code, reason) => {
      logInfo(label, `closed code=${code} reason=${reason?.toString?.() || ''}`);
    });
    ws.on('error', (err) => {
      logFatal(label, `ws error: ${err.message}`);
      reject(err);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- scenarios ----------------

/** Open as a display, create a room, print the code, idle until ctrl-c. */
async function display_only(_args) {
  const c = await connect('display', DEFAULT_URL);
  c.send('display:create_room');
  logInfo('display', 'idle until you ctrl-c');
  // Hold open
  await new Promise(() => {});
}

/**
 * Join an existing room as a player. Requires --room. Optional --name.
 * After joining, fires a representative sequence: jab, hook, block_start,
 * block_end, dodge_left, uppercut.
 */
async function join_as_player(args, slotLabel) {
  if (!args.room) throw new Error('--room required (4-digit code)');
  const c = await connect(slotLabel, DEFAULT_URL);
  const name = args.name || slotLabel;
  c.send('player:join', { roomCode: String(args.room), displayName: name });
  await sleep(250);
  c.send('player:action', { action: 'punch_jab', power: 0.7 });
  await sleep(150);
  c.send('player:action', { action: 'punch_hook', power: 1.0 });
  await sleep(150);
  c.send('player:block_start');
  await sleep(400);
  c.send('player:block_end');
  await sleep(150);
  c.send('player:action', { action: 'dodge_left' });
  await sleep(150);
  c.send('player:action', { action: 'punch_uppercut', power: 0.9 });
  logInfo(slotLabel, 'sequence done — staying open');
  await new Promise(() => {});
}

/** Join as P1 (just a label — slot is assigned by server). */
const join_as_p1 = (args) => join_as_player(args, 'p1');
/** Join as P2 (just a label — server actually assigns based on slot vacancy). */
const join_as_p2 = (args) => join_as_player(args, 'p2');

/**
 * Spam action messages to trigger RATE_LIMITED. Requires --room.
 * Reports how many were relayed vs rate-limited.
 */
async function spam_actions(args) {
  if (!args.room) throw new Error('--room required');
  let limited = 0;
  let okSent = 0;
  const c = await connect('spam', DEFAULT_URL, (msg) => {
    if (msg.type === 'error' && msg.data.code === 'RATE_LIMITED') limited++;
  });
  c.send('player:join', { roomCode: String(args.room) });
  await sleep(250);
  const N = 50;
  for (let i = 0; i < N; i++) {
    c.send('player:action', { action: 'punch_jab' });
    okSent++;
  }
  await sleep(800);
  logInfo('spam', `sent ${okSent}, RATE_LIMITED=${limited}`);
  process.exit(0);
}

/**
 * Send a series of malformed payloads and a couple of state-violation
 * payloads. Verifies the server keeps the socket open and answers each
 * with `error` (no crash).
 */
async function bad_payload(_args) {
  const c = await connect('bad', DEFAULT_URL);
  // 1. raw non-JSON
  await sleep(100);
  c.sendRaw('this is not json');
  // 2. empty object (missing type)
  await sleep(100);
  c.sendRaw(JSON.stringify({}));
  // 3. unknown type
  await sleep(100);
  c.send('mystery:event', {});
  // 4. valid type, broken data
  await sleep(100);
  c.send('player:join', { roomCode: 'abcd' });
  // 5. valid type, missing required
  await sleep(100);
  c.send('player:join', {});
  // 6. action while not in a room
  await sleep(100);
  c.send('player:action', { action: 'punch_jab' });
  // 7. unknown action enum
  await sleep(100);
  c.send('player:join', { roomCode: '0000' });
  await sleep(500);
  logInfo('bad', 'all bad payloads sent — server should still be alive');
  process.exit(0);
}

/**
 * Create a display, join as P1 + P2, send a few actions, then yank P1
 * mid-match. Verifies room:player_status: disconnected fires to remaining
 * members.
 */
async function disconnect_mid_match(_args) {
  const display = await connect('display', DEFAULT_URL);
  const codePromise = new Promise((resolve) => {
    display.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'room:created') resolve(msg.data.roomCode);
    });
  });
  display.send('display:create_room');
  const code = await codePromise;
  logInfo('test', `room code: ${code}`);

  const p1 = await connect('p1', DEFAULT_URL);
  p1.send('player:join', { roomCode: code, displayName: 'Mike' });
  await sleep(150);

  const p2 = await connect('p2', DEFAULT_URL);
  p2.send('player:join', { roomCode: code, displayName: 'Liam' });
  await sleep(250);

  p1.send('player:action', { action: 'punch_jab', power: 0.8 });
  await sleep(100);
  p2.send('player:action', { action: 'dodge_left' });
  await sleep(100);
  p1.send('player:block_start');
  await sleep(200);

  logInfo('test', 'yanking p1 now');
  p1.ws.close();

  await sleep(400);
  p2.send('player:action', { action: 'punch_uppercut' });

  await sleep(500);
  logInfo('test', 'done');
  process.exit(0);
}

/**
 * Interactive REPL — connect, join a room, send actions on keystrokes.
 * Requires a TTY (raw-mode keyboard input).
 */
async function interactive(args) {
  if (!args.room) throw new Error('--room required');
  if (!process.stdin.isTTY) {
    throw new Error('interactive scenario requires a TTY (run in a real terminal)');
  }

  const c = await connect('me', DEFAULT_URL);
  const name = args.name || 'me';
  c.send('player:join', { roomCode: String(args.room), displayName: name });

  console.log(
    chalk.yellow(`
keys:
  j  jab          a  dodge_left
  h  hook         d  dodge_right
  u  uppercut     s  dodge_down (duck)
  b  toggle block (start <-> end)
  ?  reprint help
  q  quit (or ctrl+c)
`),
  );

  let blockOn = false;

  const handle = (key) => {
    // Ctrl+C
    if (key === '' || key === 'q') {
      logInfo('me', 'quitting');
      try { c.ws.close(); } catch {}
      setTimeout(() => process.exit(0), 50);
      return;
    }
    switch (key) {
      case 'j': c.send('player:action', { action: 'punch_jab', power: 1.0 }); break;
      case 'h': c.send('player:action', { action: 'punch_hook', power: 1.0 }); break;
      case 'u': c.send('player:action', { action: 'punch_uppercut', power: 1.0 }); break;
      case 'a': c.send('player:action', { action: 'dodge_left' }); break;
      case 'd': c.send('player:action', { action: 'dodge_right' }); break;
      case 's': c.send('player:action', { action: 'dodge_down' }); break;
      case 'b':
        blockOn = !blockOn;
        c.send(blockOn ? 'player:block_start' : 'player:block_end');
        break;
      case '?':
      case '/':
        console.log(chalk.yellow('keys: j/h/u  a/d/s  b  q  ?'));
        break;
      default:
        // ignore (including \r, arrow keys, etc.)
        break;
    }
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handle);
}

// ---------------- entry ----------------
const SCENARIOS = {
  display_only,
  join_as_p1,
  join_as_p2,
  spam_actions,
  bad_payload,
  disconnect_mid_match,
  interactive,
};

const args = parseArgs(process.argv);

if (args.help || args.h) {
  console.log(`Usage:
  node server/scripts/fakeClient.js --scenario <name> [--room CODE] [--name STR]

Scenarios:
  ${Object.keys(SCENARIOS).join('\n  ')}

Env:
  WS_URL  (default ws://localhost:3000/ws)
`);
  process.exit(0);
}

const scenario = args.scenario;
if (!scenario || !SCENARIOS[scenario]) {
  console.error(chalk.red(`unknown scenario: ${scenario}`));
  console.error('available:', Object.keys(SCENARIOS).join(', '));
  process.exit(1);
}

SCENARIOS[scenario](args).catch((err) => {
  logFatal('main', err.stack || err.message);
  process.exit(1);
});
