require('dotenv').config();
const { WebSocketServer, WebSocket } = require('ws');
const Redis = require('ioredis');

const PORT = Number(process.env.WS_PORT || 4181);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on('error', (e) => {
  console.error('[ws] server error:', e.message);
  if (e.code === 'EADDRINUSE') {
    console.error('[ws] port ' + PORT + ' already in use');
    process.exit(1);
  }
});

const subOptions = {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
};

const clientOptions = {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
};

const sub = new Redis(REDIS_URL, subOptions);
const client = new Redis(REDIS_URL, clientOptions);

let lastErrorLog = 0;
function logRedisError(prefix, err) {
  const now = Date.now();
  if (now - lastErrorLog > 30000) {
    lastErrorLog = now;
    console.error(`[ws] ${prefix} redis error:`, err.message);
  }
}
sub.on('error', (e) => logRedisError('sub', e));
client.on('error', (e) => logRedisError('client', e));

sub.on('ready', () => console.log('[ws] redis subscriber ready'));

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

wss.on('connection', async (ws) => {
  ws.on('error', (e) => console.error('[ws] client error:', e.message));
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  console.log(`[ws] client connected (${wss.clients.size} total)`);

  try {
    const raw = await client.lrange('news:hot', 0, 49);
    const posts = raw
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    safeSend(ws, { type: 'snapshot', posts });
  } catch (err) {
    console.error('[ws] snapshot error:', err.message);
    safeSend(ws, { type: 'snapshot', posts: [] });
  }
});

sub.subscribe('news:new', 'news:update', (err) => {
  if (err) console.error('[ws] subscribe error:', err.message);
});

sub.on('message', (channel, message) => {
  let dto = null;
  try {
    dto = JSON.parse(message);
  } catch {
    return;
  }
  if (!dto || typeof dto !== 'object') return;
  if (channel === 'news:new') {
    broadcast({ type: 'post', post: dto });
  } else if (channel === 'news:update') {
    broadcast({ type: 'update', post: dto });
  }
});

wss.on('listening', () => {
  console.log('[ws] listening on ws://localhost:' + PORT);
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // ignore
    }
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

function shutdown(signal) {
  console.log(`[ws] received ${signal}, shutting down`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    ws.terminate();
  }
  wss.close();
  Promise.allSettled([sub.quit(), client.quit()]).then(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));