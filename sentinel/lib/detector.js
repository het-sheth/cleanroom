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
 * @returns {Promise<Array<{type: string, text: string, start: number, end: number, confidence: number}>>}
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
    return found ? { start: idx, end: idx + spanText.length } : { start: -1, end: -1 };
  }

  function normalizeHit(type, hit) {
    const spanText = hit.text ?? hit.span;
    const confidence = hit.confidence ?? hit.score;
    const hasOffsets = hit.start != null && hit.end != null;
    const { start, end } = hasOffsets
      ? { start: hit.start, end: hit.end }
      : locate(spanText);
    return { type, text: spanText, start, end, confidence };
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
