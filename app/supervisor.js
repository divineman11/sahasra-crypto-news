'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');
const PID_FILE = path.join(LOG_DIR, 'supervisor.pid');
const STOP_FILE = path.join(LOG_DIR, 'STOP');
const SUPER_LOG = path.join(LOG_DIR, 'supervisor.log');
const STATUS_FILE = path.join(LOG_DIR, 'status.json');

const MAX_LOG_SIZE = Number(process.env.SUPERVISOR_MAX_LOG_BYTES) || 5 * 1024 * 1024;
const BASE_BACKOFF = 2000;
const MAX_BACKOFF = 60000;
const UPTIME_RESET = 5 * 60 * 1000;
const CRASH_LIMIT = 10;
const CRASH_WINDOW = 10 * 60 * 1000;
const CRASH_COOLDOWN = 10 * 60 * 1000;

const withUI = process.argv.includes('--with-ui');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function pad(n) { return String(n).padStart(2, '0'); }
function isoTimestamp() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) +
    '.' + String(d.getUTCMilliseconds()).padStart(3, '0') + 'Z';
}

function pidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function pidIsNode(pid) {
  try {
    if (process.platform === 'win32') {
      const out = require('child_process').execFileSync('tasklist',
        ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      return out.includes('"node.exe"');
    }
    const output = require('child_process').execFileSync('ps',
      ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    return /node/i.test(output);
  } catch (e) {
    return true; // fail closed: if the check cannot verify, assume the pid is a live supervisor
  }
}

function createPidLock() {
  let fd;
  try {
    fd = fs.openSync(PID_FILE, 'wx');
    fs.writeSync(fd, String(process.pid) + '\n');
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') {
      console.log('supervisor: cannot create lock file: ' + e.message);
      process.exit(0);
    }
    // Lock exists: check whether the holder is a live node process.
    let oldPid = NaN;
    try { oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10); } catch (err) { /* unreadable */ }
    if (Number.isInteger(oldPid) && pidAlive(oldPid) && pidIsNode(oldPid)) {
      console.log('supervisor already running (pid ' + oldPid + ')');
      process.exit(0);
    }
    // Stale lock: remove and retry the exclusive create once.
    let again = NaN;
    try { again = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10); } catch (err) { /* gone */ }
    if (again === oldPid || (Number.isNaN(again) && Number.isNaN(oldPid))) {
      try { fs.unlinkSync(PID_FILE); } catch (err) { /* ignore */ }
    }
    try {
      fd = fs.openSync(PID_FILE, 'wx');
      fs.writeSync(fd, String(process.pid) + '\n');
      fs.closeSync(fd);
      return true;
    } catch (err) {
      console.log('supervisor: cannot acquire lock file after removing stale lock');
      process.exit(0);
    }
  }
}

function verifyLockHeld() {
  try { return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10) === process.pid; } catch (e) { return false; }
}

function shiftRotations(logPath) {
  const f1 = logPath.replace(/\.log$/, '.1.log');
  const f2 = logPath.replace(/\.log$/, '.2.log');
  const f3 = logPath.replace(/\.log$/, '.3.log');
  try {
    if (fs.existsSync(f3)) fs.unlinkSync(f3);
    if (fs.existsSync(f2)) fs.renameSync(f2, f3);
    if (fs.existsSync(f1)) fs.renameSync(f1, f2);
    if (fs.existsSync(logPath)) fs.renameSync(logPath, f1);
  } catch (e) {
    // best-effort
  }
}

function createLogStream(logPath) {
  let stream;
  let bytes;
  try {
    stream = fs.createWriteStream(logPath, { flags: 'a' });
    bytes = fs.statSync(logPath).size;
  } catch (e) {
    stream = fs.createWriteStream(logPath, { flags: 'a' });
    bytes = 0;
  }
  const buf = { data: '' };

  function writeLine(line) {
    const out = isoTimestamp() + ' ' + line + '\n';
    if (bytes + Buffer.byteLength(out, 'utf8') > MAX_LOG_SIZE && bytes > 0) {
      try { stream.end(); } catch (e) { /* ignore */ }
      shiftRotations(logPath);
      stream = fs.createWriteStream(logPath, { flags: 'a' });
      bytes = 0;
    }
    bytes += Buffer.byteLength(out, 'utf8');
    stream.write(out);
  }

  return {
    write(chunk) {
      buf.data += chunk.toString('utf8');
      let idx;
      while ((idx = buf.data.indexOf('\n')) !== -1) {
        const line = buf.data.slice(0, idx);
        buf.data = buf.data.slice(idx + 1);
        writeLine(line);
      }
      if (buf.data.length > 65536) {
        writeLine(buf.data);
        buf.data = '';
      }
    },
    end() {
      if (buf.data.length) writeLine(buf.data);
      buf.data = '';
      stream.end();
    }
  };
}

function logSuper(msg) {
  const line = isoTimestamp() + ' ' + msg + '\n';
  // Rotate supervisor.log itself before appending if it exceeds the cap.
  try {
    const st = fs.statSync(SUPER_LOG);
    if (st.size > MAX_LOG_SIZE) {
      shiftRotations(SUPER_LOG);
    }
  } catch (e) { /* file may not exist yet */ }
  try {
    fs.appendFileSync(SUPER_LOG, line);
  } catch (e) { /* ignore */ }
  process.stdout.write(line);
}

// ---- Single instance lock ----
createPidLock();

// ---- Service definitions ----
// Redis runs in WSL on Windows, natively (scripts/redis.js) on macOS/Linux.
// Redis is only started in --with-ui mode; without it, ingest runs with
// NEWS_REDIS=off so no WSL VM (~1 GB RAM) is required on Windows.
let redisStarted = false;

const SERVICES = [];

if (withUI) {
  if (process.platform === 'win32') {
    SERVICES.push({
      name: 'redis',
      command: 'wsl.exe',
      args: ['-d', 'Ubuntu', '-u', 'root', '--', 'sh', '-c',
        'redis-cli ping >/dev/null 2>&1 && exec sleep infinity || exec redis-server /etc/redis/redis.conf --daemonize no'],
      delay: 0,
      isWsl: true,
      onStart() { redisStarted = true; }
    });
  } else {
    SERVICES.push({
      name: 'redis',
      command: process.execPath,
      args: [path.join('scripts', 'redis.js')],
      delay: 0,
      onStart() { redisStarted = true; }
    });
  }
  SERVICES.push({ name: 'ingest', command: process.execPath, args: ['ingest.js'], delay: 8000 });
} else {
  SERVICES.push({
    name: 'ingest',
    command: process.execPath,
    args: ['ingest.js'],
    delay: 0,
    env: Object.assign({}, process.env, { NEWS_REDIS: 'off' })
  });
}

if (withUI) {
  SERVICES.push({ name: 'ws', command: process.execPath, args: ['ws-server.js'], delay: 0 });
  SERVICES.push({
    name: 'web',
    command: process.execPath,
    args: [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '127.0.0.1', '-p', '4180'],
    delay: 0,
    precheck: function () {
      if (!fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
        logSuper('web: .next/BUILD_ID missing - run `npm run build` first; not starting web');
        return false;
      }
      return true;
    }
  });
}

const state = new Map();
let shuttingDown = false;
const shutdownTimers = [];

function getService(name) { return SERVICES.find(s => s.name === name); }

function recordExit(name, code) {
  const st = state.get(name);
  st.lastExitCode = code;
  st.lastExitAt = new Date().toISOString();
}

function scheduleRestart(svc, code) {
  if (shuttingDown) return;
  const st = state.get(svc.name);
  recordExit(svc.name, code);
  logSuper(svc.name + ': exited with code ' + code);

  const now = Date.now();

  // Reset backoff if it stayed up long enough before this exit
  if (st.startedAt && (now - st.startedAt) >= UPTIME_RESET) {
    st.backoff = BASE_BACKOFF;
    st.consecutiveCrashes = 0;
  } else {
    st.consecutiveCrashes = (st.consecutiveCrashes || 0) + 1;
  }

  st.crashTimes.push(now);
  st.crashTimes = st.crashTimes.filter(t => now - t <= CRASH_WINDOW);

  if (st.crashTimes.length >= CRASH_LIMIT) {
    logSuper(svc.name + ': crashed ' + st.crashTimes.length + ' times in 10 minutes; waiting 10 minutes before retrying');
    st.crashTimes = [];
    st.backoff = BASE_BACKOFF;
    st.consecutiveCrashes = 0;
    const t = setTimeout(() => { startService(svc); }, CRASH_COOLDOWN);
    shutdownTimers.push(t);
    return;
  }

  const delay = st.backoff;
  st.backoff = Math.min(st.backoff * 2, MAX_BACKOFF);

  logSuper(svc.name + ': restarting in ' + delay + ' ms');
  const t = setTimeout(() => { startService(svc); }, delay);
  shutdownTimers.push(t);
}

function startService(svc) {
  if (shuttingDown) return;
  if (svc.precheck && !svc.precheck()) return;

  const st = state.get(svc.name);
  const logPath = path.join(LOG_DIR, svc.name + '.log');
  const logStream = createLogStream(logPath);

  const spawnOpts = {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  };
  if (svc.env) spawnOpts.env = svc.env;

  const child = spawn(svc.command, svc.args, spawnOpts);

  st.child = child;
  st.pid = child.pid;
  st.startedAt = Date.now();
  st.restarts = st.restarts || 0;
  if (st.hasStartedOnce) st.restarts++;
  st.hasStartedOnce = true;
  if (typeof svc.onStart === 'function') svc.onStart();

  logSuper(svc.name + ': started (pid ' + child.pid + ')');

  child.stdout.on('data', chunk => logStream.write(chunk));
  child.stderr.on('data', chunk => logStream.write(chunk));
  child.on('error', err => {
    logStream.write('spawn error: ' + (err && err.message ? err.message : String(err)) + '\n');
  });
  child.on('exit', (code) => {
    logStream.end();
    st.child = null;
    st.pid = null;
    scheduleRestart(svc, code === null ? 'signal' : code);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logSuper('supervisor shutting down');
  shutdownTimers.forEach(t => clearTimeout(t));

  for (const svc of SERVICES) {
    const st = state.get(svc.name);
    if (st.child) {
      try { st.child.kill(); } catch (e) { /* ignore */ }
    }
  }

  // Best-effort Redis shutdown inside WSL (only if we started redis via WSL on Windows)
  if (process.platform === 'win32' && redisStarted) {
    try {
      execFile('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--', 'redis-cli', 'shutdown', 'nosave'],
        { windowsHide: true }, () => { /* best-effort */ });
    } catch (e) { /* best-effort */ }
  }

  setTimeout(() => {
    try {
      const p = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (p === process.pid) fs.unlinkSync(PID_FILE);
    } catch (e) { /* ignore */ }
    logSuper('supervisor stopped');
    process.exit(0);
  }, 500);
}

function writeStatus() {
  const status = {
    supervisorPid: process.pid,
    time: new Date().toISOString(),
    services: {}
  };
  for (const svc of SERVICES) {
    const st = state.get(svc.name);
    status.services[svc.name] = {
      pid: st.pid,
      startedAt: st.startedAt ? new Date(st.startedAt).toISOString() : null,
      restarts: st.restarts || 0,
      lastExitCode: st.lastExitCode === undefined ? null : st.lastExitCode,
      lastExitAt: st.lastExitAt || null
    };
  }
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2) + '\n');
  } catch (e) {
    logSuper('failed to write status.json: ' + e.message);
  }
}

function checkStopFile() {
  if (!shuttingDown && !verifyLockHeld()) {
    // Missing file (manual cleanup) → re-create our lock; a file holding another pid → we lost the lock.
    let holder = null;
    try { holder = fs.readFileSync(PID_FILE, 'utf8').trim(); } catch (e) { holder = null; }
    if (holder === null) {
      try {
        const fd = fs.openSync(PID_FILE, 'wx');
        fs.writeSync(fd, String(process.pid) + '\n');
        fs.closeSync(fd);
        logSuper('lock file was missing - re-created');
      } catch (e) {
        logSuper('lock file missing and could not be re-created - shutting down');
        shutdown();
        return;
      }
    } else {
      logSuper('lock lost to another supervisor (pid ' + holder + ') - shutting down');
      shutdown();
      return;
    }
  }
  if (fs.existsSync(STOP_FILE)) {
    try { fs.unlinkSync(STOP_FILE); } catch (e) { /* ignore */ }
    logSuper('STOP file detected');
    shutdown();
  }
}

// ---- Initialize state ----
for (const svc of SERVICES) {
  state.set(svc.name, {
    child: null,
    pid: null,
    startedAt: null,
    restarts: 0,
    lastExitCode: undefined,
    lastExitAt: null,
    backoff: BASE_BACKOFF,
    consecutiveCrashes: 0,
    crashTimes: []
  });
}

// ---- Start ----
const serviceNames = SERVICES.map(s => s.name).join(', ');
console.log('supervisor started (services: ' + serviceNames + ')');
logSuper('supervisor started (pid ' + process.pid + ', services: ' + serviceNames + ')');

writeStatus();

setTimeout(() => { if (!verifyLockHeld()) { logSuper('lost the lock race to another starter, exiting'); process.exit(0); } for (const svc of SERVICES) {
  if (svc.delay > 0) {
    const t = setTimeout(() => startService(svc), svc.delay);
    shutdownTimers.push(t);
  } else {
    startService(svc);
  }
} }, 200);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

setInterval(checkStopFile, 5000).unref();
setInterval(writeStatus, 60000).unref();

process.on('exit', () => {
  try { if (fs.existsSync(PID_FILE)) {
    const p = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (p === process.pid) fs.unlinkSync(PID_FILE);
  } } catch (e) { /* ignore */ }
});