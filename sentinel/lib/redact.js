// Redactor: turns routed decisions into a redacted transcript. Pure text
// transform, no IO. Fail-closed per ADR 0003 — a "timeout" disposition on a
// consult route redacts, never leaks.

const REPEAT_SCRUB_MIN_LENGTH = 4;

/**
 * A decision's final action is "redact" iff the route is auto-redact, or
 * the route is consult and the disposition resolved to redact, timeout
 * (ADR 0003 fail-closed), or pseudonymize (replaced with the same
 * placeholder token as redact, for now — no separate pseudonym generation
 * yet).
 */
function shouldRedact(decision) {
  if (decision.route === 'auto-redact') return true;
  if (decision.route === 'consult') {
    return ['redact', 'timeout', 'pseudonymize'].includes(
      decision.disposition,
    );
  }
  return false;
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function contains(outer, inner) {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * Resolve overlaps among candidate (to-be-redacted) spans: a span fully
 * contained in another kept span is skipped outright; a partial overlap
 * keeps whichever span has the higher confidence.
 *
 * @param {object[]} candidates
 * @returns {object[]} kept, non-overlapping spans
 */
function resolveOverlaps(candidates) {
  const sorted = [...candidates].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );

  const kept = [];
  for (const span of sorted) {
    let skip = false;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      if (!overlaps(span, k)) continue;
      if (contains(k, span)) {
        skip = true;
        break;
      }
      if (contains(span, k)) {
        kept.splice(i, 1);
        i--;
        continue;
      }
      // Partial overlap: keep the higher-confidence span.
      if (span.confidence > k.confidence) {
        kept.splice(i, 1);
        i--;
        continue;
      }
      skip = true;
      break;
    }
    if (!skip) kept.push(span);
  }
  return kept;
}

/** TYPE uppercased, non-alphanumerics -> `_`. */
function typeToken(type) {
  return type.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Assign `[<TYPE>_<n>]` tokens to kept spans: n counts distinct spans of a
 * type in order of first appearance; spans with identical (type, text)
 * share the same token.
 *
 * @param {object[]} keptSpans - kept spans, will be read in start order
 * @param {string} text - original transcript, for text.slice(start, end)
 * @returns {object[]} keptSpans with a `token` field added
 */
function assignTokens(keptSpans, text) {
  const byStart = [...keptSpans].sort((a, b) => a.start - b.start);
  const perTypeCount = new Map();
  const tokenByKey = new Map();

  return byStart.map((span) => {
    const spanText = text.slice(span.start, span.end);
    const key = `${span.type}::${spanText}`;
    if (!tokenByKey.has(key)) {
      const n = (perTypeCount.get(span.type) ?? 0) + 1;
      perTypeCount.set(span.type, n);
      tokenByKey.set(key, `[${typeToken(span.type)}_${n}]`);
    }
    // Copy rather than mutate — decisions are caller-owned (e.g. the
    // ledger may log them next) and must not gain a `token` field.
    return { ...span, token: tokenByKey.get(key) };
  });
}

/**
 * Replace kept spans right-to-left so earlier offsets stay valid.
 */
function applyOffsetReplacements(text, keptSpansWithTokens) {
  let result = text;
  const byStartDesc = [...keptSpansWithTokens].sort((a, b) => b.start - a.start);
  for (const span of byStartDesc) {
    result = result.slice(0, span.start) + span.token + result.slice(span.end);
  }
  return result;
}

/**
 * Fail-closed repeat scrub: replace any remaining literal occurrence
 * (>= REPEAT_SCRUB_MIN_LENGTH chars) of a redacted span's original text
 * elsewhere in the text with that span's token — the detector may only
 * return offsets for the first occurrence. Longest span text first, so a
 * shorter span's text can't corrupt a longer one's replacement.
 */
function scrubRepeats(redactedText, keptSpansWithTokens, originalText) {
  const seen = new Set();
  const entries = [];
  for (const span of keptSpansWithTokens) {
    const spanText = originalText.slice(span.start, span.end);
    const key = `${span.type}::${spanText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ spanText, token: span.token });
  }
  entries.sort((a, b) => b.spanText.length - a.spanText.length);

  let result = redactedText;
  for (const { spanText, token } of entries) {
    if (spanText.length < REPEAT_SCRUB_MIN_LENGTH) continue;
    result = result.split(spanText).join(token);
  }
  return result;
}

/**
 * Apply routing decisions to a transcript, producing the redacted text.
 *
 * @param {string} text
 * @param {Array<{type: string, start: number, end: number, confidence: number, route: string, disposition: string|null}>} decisions
 * @returns {{redactedText: string, replacements: Array<{token: string, start: number, end: number, type: string}>}}
 */
export function applyDispositions(text, decisions) {
  const candidates = decisions.filter(shouldRedact);
  const kept = resolveOverlaps(candidates);
  const keptWithTokens = assignTokens(kept, text);

  const offsetReplaced = applyOffsetReplacements(text, keptWithTokens);
  const redactedText = scrubRepeats(offsetReplaced, keptWithTokens, text);

  const replacements = [...keptWithTokens]
    .sort((a, b) => a.start - b.start)
    .map((span) => ({
      token: span.token,
      start: span.start,
      end: span.end,
      type: span.type,
    }));

  return { redactedText, replacements };
}
