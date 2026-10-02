#!/usr/bin/env node
'use strict';
// Prints the same safety check the collector shows at startup.   npm run setup:status   (add --json for machines)
// Exit code: 0 = everything important is on, 1 = something needs attention.
require('dotenv').config();
const path = require('path');
const { computeStatus, formatBanner } = require('../ingest/setupStatus');

const status = computeStatus({ env: process.env, cacheDir: path.join(__dirname, '..', 'ingest', 'cache'), phase: 'live' });
if (process.argv.includes('--json')) console.log(JSON.stringify(status, null, 2));
else console.log(formatBanner(status));
process.exit(status.needsAttention ? 1 : 0);
