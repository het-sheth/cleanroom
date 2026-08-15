#!/usr/bin/env node
// cleanroom demo dashboard — zero dependencies, Node >= 22.
//
//   node dashboard/server.js [--dir out] [--port 4600]
//
// Serves the single-page UI and GET /api/state, which re-reads <dir>/redacted.jsonl and
// <dir>/ledger.jsonl on every request so a live scrub run appears within one 2s poll.
//
// Hosted deploys (Render and friends) inject PORT and expect a health check and a clean
// SIGTERM, so PORT / CLEANROOM_DIR / HOST are honoured as defaults; CLI flags still win.

import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildState } from './lib/state.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv, env = {}) {
  const options = {
    dir: env.CLEANROOM_DIR || 'out',
    port: env.PORT ? Number(env.PORT) : 4600,
    host: env.HOST || null, // null → Node's own default (:: with an IPv4 fallback)
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const [flag, inlineValue] = eq === -1 ? [arg, null] : [arg.slice(0, eq), arg.slice(eq + 1)];
    const take = () => {
      const value = inlineValue ?? argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      return value;
    };
    if (flag === '--dir') options.dir = take();
    else if (flag === '--port') options.port = Number(take());
    else if (flag === '--host') options.host = take();
    else throw new Error(`unknown option: ${flag}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error(`--port must be an integer 0-65535, got ${options.port}`);
  }
  return options;
}

// The UI is one self-contained file, so the shared chain module is inlined at serve time
// rather than duplicated: the browser verifies the chain with the exact code `node --test`
// covers. Keeps the "simulate tamper" toggle honest.
function renderPage() {
  const html = readFileSync(join(HERE, 'index.html'), 'utf8');
  const strip = (src) => src.replace(/^\s*import[^\n]*\n/gm, '').replace(/^export /gm, '');
  const bundle = [
    '<script>',
    '(function () {',
    strip(readFileSync(join(HERE, 'lib/sha256.js'), 'utf8')),
    strip(readFileSync(join(HERE, 'lib/chain.js'), 'utf8')),
    'window.cleanroomChain = { sha256Hex, canonicalPayload, computeRowHash, verifyChain, GENESIS_PREV_HASH, PAYLOAD_FIELDS };',
    '})();',
    '</script>',
  ].join('\n');
  return html.replace('<!--INLINE_CHAIN_MODULE-->', () => bundle);
}

function send(res, status, type, body) {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function createServer({ dir }) {
  const absoluteDir = resolve(dir);
  return createHttpServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'text/plain; charset=utf-8', 'method not allowed\n');
      } else if (path === '/api/state') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify(buildState(absoluteDir)));
      } else if (path === '/' || path === '/index.html') {
        send(res, 200, 'text/html; charset=utf-8', renderPage());
      } else if (path === '/healthz') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, dir: absoluteDir }));
      } else {
        send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
      }
    } catch (err) {
      // err.message can carry filesystem paths; anonymous callers get a generic message.
      process.stderr.write(`[cleanroom] ${req.method} ${path} failed: ${err?.stack ?? err}\n`);
      send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: 'internal error' }));
    }
  });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2), process.env);
  } catch (err) {
    process.stderr.write(`${err.message}\nusage: node dashboard/server.js [--dir out] [--port 4600] [--host ::]\n`);
    process.exit(2);
  }

  const server = createServer(options);
  server.listen(options.port, options.host ?? undefined, () => {
    process.stdout.write(`cleanroom dashboard → http://${options.host ?? 'localhost'}:${server.address().port}  (watching ${resolve(options.dir)})\n`);
  });

  // Hosted platforms stop instances with SIGTERM; drain instead of dropping the demo mid-poll.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
