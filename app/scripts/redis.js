#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const Redis = require('ioredis');

const platform = process.env.REDIS_LAUNCHER_PLATFORM || process.platform;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const dryRun = process.argv.includes('--dry-run');

function keepAlive() {
  setInterval(() => {}, 1 << 30);
}

function forwardSignals(child) {
  const forward = () => {
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
}

async function main() {
  if (dryRun) {
    if (platform === 'win32') {
      console.log('[redis] plan: wsl -d Ubuntu -u root -- redis-server (via WSL)');
    } else {
      console.log('[redis] plan: redis-server (native)');
    }
    return;
  }

  // Step 1: check if Redis is already running.
  try {
    const client = new Redis(REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    const pong = await client.ping().catch(() => null);
    if (pong === 'PONG') {
      console.log(`[redis] already running at ${REDIS_URL} — nothing to start`);
      client.quit();
      keepAlive();
      return;
    }
    client.disconnect();
  } catch (err) {
    // ignore, fall through to starting a server
  }

  // Step 2: start Redis.
  if (platform === 'win32') {
    const child = spawn('wsl', [
      '-d', 'Ubuntu',
      '-u', 'root',
      '--',
      'sh', '-c',
      'redis-cli ping >/dev/null 2>&1 && exec sleep infinity || exec redis-server /etc/redis/redis.conf --daemonize no',
    ], { stdio: 'inherit' });

    child.on('exit', (code) => process.exit(code == null ? 1 : code));
    child.on('error', (err) => {
      console.error(`[redis] could not start Redis through WSL (${err.message}). Install WSL + Ubuntu and redis-server, or run \`npm run all:lite\` (no Redis needed).`);
      keepAlive();
    });

    forwardSignals(child);
  } else {
    const child = spawn('redis-server', ['--save', '', '--appendonly', 'no'], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => process.exit(code == null ? 1 : code));
    child.on('error', (err) => {
      console.error(`[redis] redis-server not found. Install it (macOS: brew install redis   Ubuntu/Debian: sudo apt install redis-server) or run \`npm run all:lite\` (no Redis needed).`);
      keepAlive();
    });

    forwardSignals(child);
  }
}

main().catch((err) => {
  console.error(`[redis] unexpected error: ${err && err.message}`);
  process.exit(1);
});