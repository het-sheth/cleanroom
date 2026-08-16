import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASE_MODEL } from '../lib/finetune.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../cli.js', import.meta.url));

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(args, opts = {}) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, PIONEER_API_KEY: '', CLEANROOM_SALT: 'test-salt-fixture', ...opts.env },
    ...opts,
  });
}

function writeLabels(dir, counts) {
  const labelsJson = {};
  counts.forEach((n, i) => {
    labelsJson[`t${i}`] = {
      leak_reports: Array.from({ length: n }, (_, j) => ({
        quoted_text: `snippet-${i}-${j}`,
        n_raters: 3,
      })),
      usefulness_avg: 4.0,
      n_raters: 5,
    };
  });
  const labelsPath = path.join(dir, 'labels.json');
  fs.writeFileSync(labelsPath, JSON.stringify(labelsJson));
  return labelsPath;
}

// ---- finetune: gate closed (below threshold) -------------------------------

test('finetune: gate closed below 20 confirmed labels, prints why, exits 0, writes nothing', async () => {
  const dir = tempDir('sentinel-finetune-');
  const labelsPath = writeLabels(dir, Array(19).fill(1));
  const outDir = path.join(dir, 'out');

  const { stdout } = await runCli(['finetune', '--labels', labelsPath, '--out', outDir]);
  assert.match(stdout, /gate closed/);
  assert.match(stdout, /19/);
  assert.equal(fs.existsSync(path.join(outDir, 'finetune-job.json')), false);
});

// ---- finetune: --dry-run works with no API key -----------------------------

test('finetune --dry-run prints both request bodies and writes nothing, with no PIONEER_API_KEY', async () => {
  const dir = tempDir('sentinel-finetune-');
  const labelsPath = writeLabels(dir, Array(20).fill(1));
  const outDir = path.join(dir, 'out');

  const { stdout } = await runCli(
    ['finetune', '--labels', labelsPath, '--out', outDir, '--dry-run'],
    { env: { PIONEER_API_KEY: undefined } },
  );

  assert.match(stdout, /gate open/);
  assert.match(stdout, /POST https:\/\/api\.pioneer\.ai\/generate/);
  assert.match(stdout, /"task_type": "ner"/);
  assert.match(stdout, /POST https:\/\/api\.pioneer\.ai\/felix\/training-jobs/);
  assert.match(stdout, new RegExp(`"base_model": "${DEFAULT_BASE_MODEL.replace(/\//g, '\\/')}"`));
  assert.equal(fs.existsSync(path.join(outDir, 'finetune-job.json')), false);
});

test('finetune --dry-run honors a custom --domain', async () => {
  const dir = tempDir('sentinel-finetune-');
  const labelsPath = writeLabels(dir, Array(20).fill(1));
  const outDir = path.join(dir, 'out');

  const { stdout } = await runCli(
    ['finetune', '--labels', labelsPath, '--out', outDir, '--dry-run', '--domain', 'custom domain text'],
    { env: { PIONEER_API_KEY: undefined } },
  );
  assert.match(stdout, /custom domain text/);
});

// ---- finetune: job-record write blocks a second launch --------------------

test('finetune: an existing finetune-job.json blocks a second launch (1-job cap)', async () => {
  const dir = tempDir('sentinel-finetune-');
  const labelsPath = writeLabels(dir, Array(25).fill(1));
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'finetune-job.json'),
    JSON.stringify({ jobId: 'already-launched', launchedAt: '2026-01-01T00:00:00Z', baseModel: DEFAULT_BASE_MODEL }),
  );

  const { stdout } = await runCli(['finetune', '--labels', labelsPath, '--out', outDir]);
  assert.match(stdout, /gate closed/);
  assert.match(stdout, /1-job cap/);

  // File untouched by the blocked run.
  const record = JSON.parse(fs.readFileSync(path.join(outDir, 'finetune-job.json'), 'utf8'));
  assert.equal(record.jobId, 'already-launched');
});

test('finetune: live path requires PIONEER_API_KEY when the gate is open and --dry-run is not set', async () => {
  const dir = tempDir('sentinel-finetune-');
  const labelsPath = writeLabels(dir, Array(20).fill(1));
  const outDir = path.join(dir, 'out');

  await assert.rejects(
    () => runCli(['finetune', '--labels', labelsPath, '--out', outDir], { env: { PIONEER_API_KEY: undefined } }),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /PIONEER_API_KEY not set/);
      return true;
    },
  );
});

test('finetune: missing --labels argument exits non-zero with usage', async () => {
  await assert.rejects(
    () => runCli(['finetune']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /--labels/);
      assert.match(err.stderr, /usage/);
      return true;
    },
  );
});

test('finetune: unreadable --labels path exits non-zero and names the path', async () => {
  const dir = tempDir('sentinel-finetune-');
  const missingPath = path.join(dir, 'nope.json');
  await assert.rejects(
    () => runCli(['finetune', '--labels', missingPath]),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /cannot read/);
      return true;
    },
  );
});

// ---- finetune-status --------------------------------------------------------

test('finetune-status: missing jobId exits non-zero with usage', async () => {
  await assert.rejects(
    () => runCli(['finetune-status']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /usage/);
      return true;
    },
  );
});

test('finetune-status: no PIONEER_API_KEY exits non-zero', async () => {
  await assert.rejects(
    () => runCli(['finetune-status', 'job-1'], { env: { PIONEER_API_KEY: undefined } }),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /PIONEER_API_KEY not set/);
      return true;
    },
  );
});

// ---- unrecognized top-level command / usage still work --------------------

test('unrecognized subcommand still exits non-zero with usage listing all commands', async () => {
  await assert.rejects(
    () => runCli(['bogus']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /usage/);
      assert.match(err.stderr, /finetune-status/);
      return true;
    },
  );
});
