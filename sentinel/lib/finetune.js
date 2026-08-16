// Pioneer fine-tune escalation client: POST /generate (synthesizes labeled
// NER training data from a domain description) and POST/GET
// /felix/training-jobs (launches and polls a LoRA/full fine-tune job).
// Implements the L3 rung of the escalation ladder (ADR 0005).
//
// Per context/research/pioneer.md these endpoint shapes are only partially
// documented (unlike /inference, they are not verified live) — keep the
// client thin, normalize defensively, and on an unrecognized response shape
// throw with the body JSON in the message, same convention as
// lib/detector.js's Pioneer inference client.

const GENERATE_URL = 'https://api.pioneer.ai/generate';
const TRAINING_JOBS_URL = 'https://api.pioneer.ai/felix/training-jobs';

export const DEFAULT_BASE_MODEL = 'fastino/gliner2-base-v1';

function authHeaders(apiKey) {
  return { 'X-API-Key': apiKey, 'content-type': 'application/json' };
}

/** Throws on non-2xx, same message convention as detector.js. */
async function assertOk(res) {
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Pioneer request failed: ${res.status} ${bodyText}`);
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Request body for POST /generate. Exported (pure, no IO) so the CLI's
 * `finetune --dry-run` can print it without making a network call.
 */
export function buildGenerateBody({ labels, domainDescription, numExamples = 100 }) {
  return {
    task_type: 'ner',
    labels,
    num_examples: numExamples,
    domain_description: domainDescription,
  };
}

/**
 * Synthesize labeled NER training data from a domain description.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string[]} opts.labels
 * @param {string} opts.domainDescription
 * @param {number} [opts.numExamples=100]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<object>} the parsed response body, unmodified, plus a
 *   best-effort `datasetRef` (from `dataset_id` | `id` | `dataset`, in that
 *   order). Throws if the body is not a plain object, or if it is one but
 *   carries none of those keys (same unrecognized-shape convention as
 *   `launchFineTune` / `jobStatus`).
 */
export async function generateTrainingData({
  apiKey,
  labels,
  domainDescription,
  numExamples = 100,
  fetchImpl = fetch,
}) {
  const res = await fetchImpl(GENERATE_URL, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(buildGenerateBody({ labels, domainDescription, numExamples })),
  });
  await assertOk(res);

  const body = await res.json();
  if (!isPlainObject(body)) {
    throw new Error(
      `unrecognized Pioneer generate response shape: ${JSON.stringify(body)}`,
    );
  }
  const datasetRef = body.dataset_id ?? body.id ?? body.dataset;
  if (datasetRef === undefined) {
    throw new Error(
      `unrecognized Pioneer generate response shape: ${JSON.stringify(body)}`,
    );
  }
  return { ...body, datasetRef };
}

/**
 * Request body for POST /felix/training-jobs. Exported (pure, no IO) so the
 * CLI's `finetune --dry-run` can print it without making a network call.
 */
export function buildTrainingJobBody({
  baseModel = DEFAULT_BASE_MODEL,
  datasetRef,
  loraR = 16,
  loraAlpha = 32,
}) {
  return {
    base_model: baseModel,
    dataset_id: datasetRef,
    lora_r: loraR,
    lora_alpha: loraAlpha,
  };
}

/**
 * Launch a fine-tune job against a generated dataset.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseModel]
 * @param {string} opts.datasetRef
 * @param {number} [opts.loraR=16]
 * @param {number} [opts.loraAlpha=32]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{jobId: string, status: (string|undefined), raw: object}>}
 */
export async function launchFineTune({
  apiKey,
  baseModel = DEFAULT_BASE_MODEL,
  datasetRef,
  loraR = 16,
  loraAlpha = 32,
  fetchImpl = fetch,
}) {
  const res = await fetchImpl(TRAINING_JOBS_URL, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(buildTrainingJobBody({ baseModel, datasetRef, loraR, loraAlpha })),
  });
  await assertOk(res);

  const body = await res.json();
  const jobId = isPlainObject(body) ? (body.id ?? body.job_id ?? body.uuid) : undefined;
  if (jobId == null) {
    throw new Error(
      `unrecognized Pioneer training-job response shape: ${JSON.stringify(body)}`,
    );
  }
  return { jobId, status: body.status, raw: body };
}

/**
 * Poll a fine-tune job's status. Expected states (per
 * context/research/pioneer.md): requested | running | complete | deployed.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.jobId
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{status: string, raw: object}>}
 */
export async function jobStatus({ apiKey, jobId, fetchImpl = fetch }) {
  const res = await fetchImpl(`${TRAINING_JOBS_URL}/${jobId}`, {
    method: 'GET',
    headers: authHeaders(apiKey),
  });
  await assertOk(res);

  const body = await res.json();
  const status = isPlainObject(body) ? body.status : undefined;
  if (status == null) {
    throw new Error(
      `unrecognized Pioneer job-status response shape: ${JSON.stringify(body)}`,
    );
  }
  return { status, raw: body };
}

/**
 * Count of confirmed hard-case labels in a Track B labels.json object:
 * total `leak_reports[]` entries across all transcripts, per the frozen
 * contract context/contracts/labels-json.md.
 *
 * @param {object} labelsJson - `{ [transcriptId]: { leak_reports: [...] } }`
 * @returns {number}
 */
export function countConfirmedLabels(labelsJson) {
  let count = 0;
  for (const transcript of Object.values(labelsJson ?? {})) {
    const reports = transcript?.leak_reports;
    if (Array.isArray(reports)) count += reports.length;
  }
  return count;
}

/**
 * Pure ADR 0005 escalation gate. Fine-tune iff there are >= 20 confirmed
 * hard-case labels AND no fine-tune job has been launched yet. The 1-job
 * cap lives here: `jobRecordExists` is the caller's check of whether
 * `<out>/finetune-job.json` already exists.
 *
 * @param {object} labelsJson
 * @param {boolean} jobRecordExists
 * @returns {boolean}
 */
export function shouldFineTune(labelsJson, jobRecordExists) {
  return countConfirmedLabels(labelsJson) >= 20 && !jobRecordExists;
}
