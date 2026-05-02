import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { Connection } from './net/connection.js';
import { parseInbound } from './net/envelope.js';
import { dispatch } from './net/handlers.js';
import { ErrorCode, ACTION_CLASS_TYPES } from './net/messages.js';
import { RoomManager } from './rooms/roomManager.js';
import { Heartbeat } from './net/heartbeat.js';

// Eagerly import handler modules so they self-register their handlers.
// (handlers.js itself registers `ping` at import time.)
import './net/handlers.js';
import { handleConnectionClose } from './net/roomHandlers.js';
import './net/actionHandlers.js';

// ---------- crash safety ----------
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaughtException — staying alive');
});
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'unhandledRejection — staying alive');
});

// ---------- HTTP (debug + health + test page) ----------
const app = express();

// Serve the browser test client at /test.html (and any other static assets).
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/debug', (_req, res) => {
  res.json({
    serverT: Date.now(),
    connections: [...connections.values()].map((c) => ({
      id: c.id,
      role: c.role,
      roomCode: c.roomCode,
      lastSeenAt: c.lastSeenAt,
    })),
    rooms: roomManager.snapshot(),
  });
});

const server = http.createServer(app);

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, Connection>} */
const connections = new Map();

wss.on('connection', (ws, req) => {
  const conn = new Connection(ws);
  connections.set(conn.id, conn);
  heartbeat.attach(conn);
  conn.log.info({ remote: req.socket.remoteAddress }, 'ws connect');

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      conn.sendError(ErrorCode.INVALID_PAYLOAD, 'binary frames not supported');
      return;
    }

    let text;
    try {
      text = raw.toString('utf8');
    } catch {
      conn.sendError(ErrorCode.INVALID_PAYLOAD, 'frame is not utf-8');
      return;
    }

    conn.touch();

    const parsed = parseInbound(text);
    if (!parsed.ok) {
      conn.log.warn({ code: parsed.code, message: parsed.message }, 'parse fail');
      conn.sendError(parsed.code, parsed.message, parsed.details);
      return;
    }

    // Rate-limit action-class messages before dispatch. Bucket is per-conn.
    if (ACTION_CLASS_TYPES.has(parsed.type) && !conn.rateLimiter.take()) {
      conn.sendError(ErrorCode.RATE_LIMITED, 'action rate exceeded');
      return;
    }

    // Dispatch under a try/catch so a buggy handler can never crash the server.
    Promise.resolve()
      .then(() =>
        dispatch(parsed.type, {
          conn,
          data: parsed.data,
          t: parsed.t,
          rooms: roomManager,
        }),
      )
      .catch((err) => {
        conn.log.error({ err, type: parsed.type }, 'handler threw');
        conn.sendError(ErrorCode.INTERNAL_ERROR, 'internal error');
      });
  });

  ws.on('close', (code, reason) => {
    conn.log.info({ code, reason: reason?.toString?.() }, 'ws close');
    try {
      handleConnectionClose(conn, roomManager);
    } catch (err) {
      conn.log.error({ err }, 'close handler threw');
    }
    connections.delete(conn.id);
  });

  ws.on('error', (err) => {
    conn.log.warn({ err }, 'ws error');
  });
});

// ---------- room manager ----------
const roomManager = new RoomManager();
roomManager.start();

// ---------- heartbeat ----------
const heartbeat = new Heartbeat(connections);
heartbeat.start();

// ---------- start ----------
server.listen(config.PORT, () => {
  logger.info({ port: config.PORT, path: '/ws' }, 'server listening');
});
