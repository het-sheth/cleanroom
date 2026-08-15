import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTrainingData,
  launchFineTune,
  jobStatus,
  shouldFineTune,
  countConfirmedLabels,
  buildGenerateBody,
  buildTrainingJobBody,
  DEFAULT_BASE_MODEL,
} from '../lib/finetune.js';

function fakeFetch(status, bodyObj, { bodyText } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => bodyObj,
      text: async () => bodyText ?? JSON.stringify(bodyObj),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// ---- generateTrainingData -------------------------------------------------

test('generateTrainingData POSTs the flat /generate payload with required headers', async () => {
  const fetchImpl = fakeFetch(200, { dataset_id: 'ds-123', examples: [] });

  await generateTrainingData({
    apiKey: 'test-key',
    labels: ['person', 'email'],
    domainDescription: 'agent transcripts',
    fetchImpl,
  });

  assert.equal(fetchImpl.calls.length, 1);
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.pioneer.ai/generate');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers['X-API-Key'], 'test-key');
  assert.equal(opts.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(opts.body), {
    task_type: 'ner',
    labels: ['person', 'email'],
    num_examples: 100,
    domain_description: 'agent transcripts',
  });
});

test('generateTrainingData respects a custom numExamples', async () => {
  const fetchImpl = fakeFetch(200, { dataset_id: 'ds-123' });
  await generateTrainingData({
    apiKey: 'k',
    labels: ['person'],
    domainDescription: 'd',
    numExamples: 25,
    fetchImpl,
  });
  const body = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(body.num_examples, 25);
});

test('generateTrainingData returns the body unmodified plus datasetRef from dataset_id', async () => {
  const fetchImpl = fakeFetch(200, { dataset_id: 'ds-abc', examples: [1, 2, 3] });
  const result = await generateTrainingData({
    apiKey: 'k',
    labels: ['person'],
    domainDescription: 'd',
    fetchImpl,
  });
  assert.equal(result.dataset_id, 'ds-abc');
  assert.deepEqual(result.examples, [1, 2, 3]);
  assert.equal(result.datasetRef, 'ds-abc');
});

test('generateTrainingData falls back to id then dataset for datasetRef', async () => {
  const byId = await generateTrainingData({
    apiKey: 'k',
    labels: ['person'],
    domainDescription: 'd',
    fetchImpl: fakeFetch(200, { id: 'job-id-1' }),
  });
  assert.equal(byId.datasetRef, 'job-id-1');

  const byDataset = await generateTrainingData({
    apiKey: 'k',
    labels: ['person'],
    domainDescription: 'd',
    fetchImpl: fakeFetch(200, { dataset: 'dataset-name' }),
  });
  assert.equal(byDataset.datasetRef, 'dataset-name');
});

test('generateTrainingData: non-2xx throws with status and body text', async () => {
  const fetchImpl = fakeFetch(400, { error: 'bad request' }, { bodyText: '{"error":"bad request"}' });
  await assert.rejects(
    () => generateTrainingData({ apiKey: 'k', labels: [], domainDescription: 'd', fetchImpl }),
    (err) => {
      assert.match(err.message, /400/);
      assert.match(err.message, /bad request/);
      return true;
    },
  );
});

test('generateTrainingData: unrecognized (non-object) response shape throws with body JSON', async () => {
  const fetchImpl = fakeFetch(200, ['not', 'an', 'object']);
  await assert.rejects(
    () => generateTrainingData({ apiKey: 'k', labels: [], domainDescription: 'd', fetchImpl }),
    (err) => {
      assert.match(err.message, /unrecognized Pioneer generate response shape/);
      assert.match(err.message, /not/);
      return true;
    },
  );
});

// ---- launchFineTune --------------------------------------------------------

test('launchFineTune POSTs to /felix/training-jobs with the expected body', async () => {
  const fetchImpl = fakeFetch(200, { id: 'job-1', status: 'requested' });

  await launchFineTune({ apiKey: 'test-key', datasetRef: 'ds-123', fetchImpl });

  assert.equal(fetchImpl.calls.length, 1);
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.pioneer.ai/felix/training-jobs');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers['X-API-Key'], 'test-key');
  assert.deepEqual(JSON.parse(opts.body), {
    base_model: DEFAULT_BASE_MODEL,
    dataset_id: 'ds-123',
    lora_r: 16,
    lora_alpha: 32,
  });
});

test('launchFineTune respects baseModel, loraR, loraAlpha overrides', async () => {
  const fetchImpl = fakeFetch(200, { id: 'job-1' });
  await launchFineTune({
    apiKey: 'k',
    baseModel: 'custom/base',
    datasetRef: 'ds-1',
    loraR: 8,
    loraAlpha: 16,
    fetchImpl,
  });
  const body = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(body.base_model, 'custom/base');
  assert.equal(body.lora_r, 8);
  assert.equal(body.lora_alpha, 16);
});

test('launchFineTune returns jobId from id | job_id | uuid, status, and raw', async () => {
  const byId = await launchFineTune({
    apiKey: 'k',
    datasetRef: 'ds',
    fetchImpl: fakeFetch(200, { id: 'j1', status: 'requested' }),
  });
  assert.deepEqual(byId, { jobId: 'j1', status: 'requested', raw: { id: 'j1', status: 'requested' } });

  const byJobId = await launchFineTune({
    apiKey: 'k',
    datasetRef: 'ds',
    fetchImpl: fakeFetch(200, { job_id: 'j2' }),
  });
  assert.equal(byJobId.jobId, 'j2');

  const byUuid = await launchFineTune({
    apiKey: 'k',
    datasetRef: 'ds',
    fetchImpl: fakeFetch(200, { uuid: 'j3' }),
  });
  assert.equal(byUuid.jobId, 'j3');
});

test('launchFineTune: non-2xx throws with status and body text', async () => {
  const fetchImpl = fakeFetch(500, { error: 'boom' }, { bodyText: '{"error":"boom"}' });
  await assert.rejects(
    () => launchFineTune({ apiKey: 'k', datasetRef: 'ds', fetchImpl }),
    (err) => {
      assert.match(err.message, /500/);
      assert.match(err.message, /boom/);
      return true;
    },
  );
});

test('launchFineTune: unrecognized response shape (no id/job_id/uuid) throws with body JSON', async () => {
  const fetchImpl = fakeFetch(200, { unexpected: 'shape' });
  await assert.rejects(
    () => launchFineTune({ apiKey: 'k', datasetRef: 'ds', fetchImpl }),
    (err) => {
      assert.match(err.message, /unrecognized Pioneer training-job response shape/);
      assert.match(err.message, /unexpected/);
      return true;
    },
  );
});

// ---- jobStatus --------------------------------------------------------------

test('jobStatus GETs /felix/training-jobs/<jobId>', async () => {
  const fetchImpl = fakeFetch(200, { status: 'running' });
  const result = await jobStatus({ apiKey: 'test-key', jobId: 'job-42', fetchImpl });

  assert.equal(fetchImpl.calls.length, 1);
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.pioneer.ai/felix/training-jobs/job-42');
  assert.equal(opts.method, 'GET');
  assert.equal(opts.headers['X-API-Key'], 'test-key');
  assert.deepEqual(result, { status: 'running', raw: { status: 'running' } });
});

test('jobStatus: non-2xx throws with status and body text', async () => {
  const fetchImpl = fakeFetch(404, { error: 'not found' }, { bodyText: '{"error":"not found"}' });
  await assert.rejects(
    () => jobStatus({ apiKey: 'k', jobId: 'nope', fetchImpl }),
    (err) => {
      assert.match(err.message, /404/);
      assert.match(err.message, /not found/);
      return true;
    },
  );
});

test('jobStatus: unrecognized response shape (no status) throws with body JSON', async () => {
  const fetchImpl = fakeFetch(200, { unexpected: 'shape' });
  await assert.rejects(
    () => jobStatus({ apiKey: 'k', jobId: 'job-1', fetchImpl }),
    (err) => {
      assert.match(err.message, /unrecognized Pioneer job-status response shape/);
      assert.match(err.message, /unexpected/);
      return true;
    },
  );
});

// ---- countConfirmedLabels / shouldFineTune (pure, ADR 0005 gate) ----------

function labelsWithReportCounts(counts) {
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
  return labelsJson;
}

test('countConfirmedLabels sums leak_reports entries across all transcripts', () => {
  const labelsJson = labelsWithReportCounts([2, 0, 5, 1]);
  assert.equal(countConfirmedLabels(labelsJson), 8);
});

test('countConfirmedLabels treats missing/empty labelsJson as zero', () => {
  assert.equal(countConfirmedLabels({}), 0);
  assert.equal(countConfirmedLabels(undefined), 0);
});

test('shouldFineTune is false at 19 confirmed labels', () => {
  const labelsJson = labelsWithReportCounts(Array(19).fill(1));
  assert.equal(countConfirmedLabels(labelsJson), 19);
  assert.equal(shouldFineTune(labelsJson, false), false);
});

test('shouldFineTune is true at 20 confirmed labels with no existing job', () => {
  const labelsJson = labelsWithReportCounts(Array(20).fill(1));
  assert.equal(countConfirmedLabels(labelsJson), 20);
  assert.equal(shouldFineTune(labelsJson, false), true);
});

test('shouldFineTune is false at 20 confirmed labels when a job record already exists (1-job cap)', () => {
  const labelsJson = labelsWithReportCounts(Array(20).fill(1));
  assert.equal(shouldFineTune(labelsJson, true), false);
});

// ---- pure body builders (used directly by the CLI's --dry-run) -----------

test('buildGenerateBody matches the documented /generate payload shape', () => {
  assert.deepEqual(
    buildGenerateBody({ labels: ['a', 'b'], domainDescription: 'desc', numExamples: 10 }),
    { task_type: 'ner', labels: ['a', 'b'], num_examples: 10, domain_description: 'desc' },
  );
});

test('buildTrainingJobBody matches the documented /felix/training-jobs payload shape', () => {
  assert.deepEqual(
    buildTrainingJobBody({ datasetRef: 'ds-1' }),
    { base_model: DEFAULT_BASE_MODEL, dataset_id: 'ds-1', lora_r: 16, lora_alpha: 32 },
  );
});
