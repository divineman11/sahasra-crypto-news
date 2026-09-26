'use strict';

const { spawn } = require('child_process');

const args = process.argv.slice(2);
const sepIndex = args.indexOf('--');
const usage = 'usage: node scripts/with-env.js KEY=VALUE ... -- command [args]';

if (sepIndex === -1 || sepIndex === args.length - 1) {
  process.stderr.write(usage + '\n');
  process.exit(2);
}

const envArgs = args.slice(0, sepIndex);
const cmdArgs = args.slice(sepIndex + 1);

const env = {};
for (const arg of envArgs) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
    process.stderr.write(usage + '\n');
    process.exit(2);
  }
  const eq = arg.indexOf('=');
  env[arg.slice(0, eq)] = arg.slice(eq + 1);
}

const cmd = cmdArgs[0] === 'node' ? process.execPath : cmdArgs[0];
const child = spawn(cmd, cmdArgs.slice(1), {
  stdio: 'inherit',
  env: { ...process.env, ...env },
  shell: false
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (typeof child.kill === 'function') {
      child.kill(sig);
    }
  });
}

child.on('error', (err) => {
  process.stderr.write(String(err && err.message ? err.message : err) + '\n');
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});