// Pioneer detector client: calls fastino/gliner2's PII inference endpoint and
// normalizes the response into a flat span list. Per context/research/pioneer.md
// (verified live 2026-08-15): the request payload is FLAT and `schema` is
// REQUIRED by the API when provided by the caller; the response groups
// entities by type as a dict at `result.data.entities`. That dict shape is
// the primary normalization path — the brief's other candidate shapes
// (flat entity arrays under `entities` / `result.entities` / top-level) are
// kept only as defensive fallbacks. No retries here — cold-start backoff is
// the caller's job.

const PIONEER_URL = 'https://api.pioneer.ai/inference';

/**
 * Call Pioneer's /inference endpoint and normalize the response into a flat
 * span list.
 *
 * @param {string} text
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.modelId]
 * @param {number} [opts.threshold]
 * @param {object} [opts.schema] - e.g. {entities: ["person", "email"]}
 * @param {typeof fetch} [opts.fetchImpl]
 * A span whose text cannot be located in the transcript comes back with
 * `{start: null, end: null, unlocatable: true}` — never a `-1` sentinel that
 * downstream code could mistake for a real range. Malformed hits (no entity
 * type, no span text, no usable confidence) throw here rather than failing
 * later inside the policy router.
 *
 * @returns {Promise<Array<{type: string, text: string, start: number|null, end: number|null, confidence: number, unlocatable?: true}>>}
 */
export async function detect(
  text,
  {
    apiKey,
    modelId = 'fastino/gliner2-privacy-filter-PII-multi',
    threshold = 0.5,
    schema,
    fetchImpl = fetch,
  } = {},
) {
  const body = {
    model_id: modelId,
    text,
    threshold,
    ...(schema && { schema }),
  };

  const res = await fetchImpl(PIONEER_URL, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Pioneer request failed: ${res.status} ${bodyText}`);
  }

  const responseBody = await res.json();
  return normalize(responseBody, text);
}

/**
 * Reject a hit the rest of the pipeline cannot route. Without this, a hit
 * carrying neither `type`/`label` nor `confidence`/`score` reaches
 * `policy.route` as `undefined` and dies there with a bare `TypeError`
 * mid-file. Failing at the boundary keeps the diagnosis local. Messages
 * deliberately carry no span text — errors reach stderr, PII must not.
 */
function validateHit(type, spanText, confidence) {
  if (typeof type !== 'string' || type === '') {
    throw new Error(
      'malformed Pioneer hit: missing entity type (no `type` or `label`)',
    );
  }
  if (typeof spanText !== 'string' || spanText === '') {
    throw new Error(
      `malformed Pioneer hit (type=${type}): missing span text (no \`text\` or \`span\`)`,
    );
  }
  if (
    typeof confidence !== 'number' ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error(
      `malformed Pioneer hit (type=${type}): confidence must be a number in [0, 1] (no valid \`confidence\` or \`score\`)`,
    );
  }
}

/**
 * Flatten a Pioneer response body into a flat span list, searching the
 * transcript text for offsets when the response omits them.
 */
function normalize(body, text) {
  const occurrenceIndex = new Map(); // spanText -> next search offset

  function locate(spanText) {
    const searchFrom = occurrenceIndex.get(spanText) ?? 0;
    const idx = text.indexOf(spanText, searchFrom);
    const found = idx !== -1;
    occurrenceIndex.set(spanText, found ? idx + spanText.length : searchFrom);
    // An unlocatable span carries null offsets plus `unlocatable: true`,
    // never the old `{start: -1, end: -1}`: -1 reads downstream as an
    // ordinary (empty) range, so `text.slice(-1, -1)` redacted nothing and
    // spliced the token before the last character — the detected PII
    // reached the output intact, violating ADR 0003. redact.js keys off
    // this flag and redacts such a span by literal text instead.
    return found
      ? { start: idx, end: idx + spanText.length }
      : { start: null, end: null, unlocatable: true };
  }

  function normalizeHit(type, hit) {
    const spanText = hit.text ?? hit.span;
    const confidence = hit.confidence ?? hit.score;
    validateHit(type, spanText, confidence);
    // Pioneer's offsets are only trusted when they actually select the span
    // text Pioneer itself reported. Drifted offsets (byte vs UTF-16, or
    // offsets into a normalized copy of the transcript) would otherwise make
    // the redactor replace the wrong range and leave a PII fragment behind.
    const hasOffsets =
      Number.isInteger(hit.start) &&
      Number.isInteger(hit.end) &&
      hit.start >= 0 &&
      hit.end > hit.start;
    const located =
      hasOffsets && text.slice(hit.start, hit.end) === spanText
        ? { start: hit.start, end: hit.end }
        : locate(spanText);
    return { type, text: spanText, confidence, ...located };
  }

  // Primary shape (verified live): entities grouped by type as a dict.
  const dictEntities = body?.result?.data?.entities;
  if (
    dictEntities &&
    typeof dictEntities === 'object' &&
    !Array.isArray(dictEntities)
  ) {
    const spans = [];
    for (const [type, hits] of Object.entries(dictEntities)) {
      if (!Array.isArray(hits)) continue;
      for (const hit of hits) {
        spans.push(normalizeHit(type, hit));
      }
    }
    return spans;
  }

  // Fallback shapes: flat entity array under a few candidate keys.
  const arrayEntities = Array.isArray(body)
    ? body
    : Array.isArray(body?.entities)
      ? body.entities
      : Array.isArray(body?.result?.entities)
        ? body.result.entities
        : null;

  if (arrayEntities) {
    return arrayEntities.map((hit) =>
      normalizeHit(hit.type ?? hit.label, hit),
    );
  }

  throw new Error(
    `unrecognized Pioneer response shape: ${JSON.stringify(body)}`,
  );
}
