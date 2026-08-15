// Redactor: turns routed decisions into a redacted transcript. Pure text
// transform, no IO. Fail-closed per ADR 0003 — a "timeout" disposition on a
// consult route redacts, never leaks.

const REPEAT_SCRUB_MIN_LENGTH = 4;

/**
 * A decision's final action defaults to "redact" per ADR 0003 — any span
 * whose final action is unresolved is redacted, never allowed through.
 * `allow-observed` routes allow. `auto-redact` routes always redact.
 * `consult` routes redact unless the disposition explicitly resolved to
 * `allow` — `redact`, `timeout` (the ADR 0003 fail-closed case), and
 * `pseudonymize` (replaced with the same placeholder token as redact, for
 * now — no separate pseudonym generation yet) all redact, and so does any
 * other disposition value (null, undefined, unrecognized). Any route
 * string other than the three known ones also fails closed to redact.
 */
function shouldRedact(decision) {
  if (decision.route === 'allow-observed') return false;
  if (decision.route === 'auto-redact') return true;
  if (decision.route === 'consult') {
    return decision.disposition !== 'allow';
  }
  // Unrecognized route — fail closed rather than silently allow.
  return true;
}

/**
 * Does this span carry offsets that select a real, non-empty range?
 *
 * Anything else — the detector's `unlocatable` flag, a negative or
 * non-integer offset, an empty or inverted range — must never reach the
 * offset splice: `text.slice(-1, -1)` is `''`, which redacted nothing while
 * inserting the token before the last character, leaking the span (ADR
 * 0003). Such spans are still redacted, by literal text in `scrubRepeats`.
 */
function isPositioned(span) {
  return (
    span.unlocatable !== true &&
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start
  );
}

/**
 * The span's original text: prefer what the detector reported, since a span
 * with unusable offsets has no slice to fall back on. This is what makes the
 * repeat scrub a real backstop rather than a no-op on such spans.
 */
function spanTextOf(span, text) {
  if (typeof span.text === 'string' && span.text !== '') return span.text;
  return isPositioned(span) ? text.slice(span.start, span.end) : '';
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
 * Only positioned spans take part — overlap is meaningless without real
 * offsets, and a `-1` span would compare as overlapping everything.
 *
 * @param {object[]} candidates
 * @returns {object[]} kept, non-overlapping spans
 */
function resolveOverlaps(candidates) {
  const sorted = candidates.filter(isPositioned).sort(
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
 * Positioned spans are numbered in offset order; spans without usable
 * offsets are numbered after them (they have no position to sort by), and
 * share a token with a positioned span of the same (type, text).
 *
 * @param {object[]} keptSpans - kept spans, will be read in start order
 * @param {string} text - original transcript, for text.slice(start, end)
 * @returns {object[]} keptSpans with a `token` field added
 */
function assignTokens(keptSpans, text) {
  const ordered = [
    ...keptSpans.filter(isPositioned).sort((a, b) => a.start - b.start),
    ...keptSpans.filter((span) => !isPositioned(span)),
  ];
  const perTypeCount = new Map();
  const tokenByKey = new Map();

  return ordered.map((span) => {
    const spanText = spanTextOf(span, text);
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
 * Replace kept spans right-to-left so earlier offsets stay valid. Only
 * positioned spans are spliced — see `isPositioned`.
 */
function applyOffsetReplacements(text, keptSpansWithTokens) {
  let result = text;
  const byStartDesc = keptSpansWithTokens
    .filter(isPositioned)
    .sort((a, b) => b.start - a.start);
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
 *
 * This is also the only redaction a span without usable offsets ever gets,
 * so the span text comes from the detector's own report first and the
 * offset slice second — slicing an unpositioned span yields `''`, which the
 * length floor below then skipped, and the span leaked.
 */
function scrubRepeats(redactedText, keptSpansWithTokens, originalText) {
  const seen = new Set();
  const entries = [];
  for (const span of keptSpansWithTokens) {
    const spanText = spanTextOf(span, originalText);
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
 * `unresolved` lists redacted spans that had no usable offsets: they were
 * scrubbed by literal text only, so the caller can surface them instead of
 * letting a silent `route: auto-redact` ledger row imply a clean redaction.
 * `scrubbed: false` means the span's text never occurred literally in the
 * transcript — nothing was removed for it, and a near-match may survive.
 *
 * @param {string} text
 * @param {Array<{type: string, text?: string, start: number|null, end: number|null, confidence: number, route: string, disposition: string|null, unlocatable?: boolean}>} decisions
 * @returns {{redactedText: string, replacements: Array<{token: string, start: number, end: number, type: string}>, unresolved: Array<{type: string, token: string, scrubbed: boolean}>}}
 */
export function applyDispositions(text, decisions) {
  const candidates = decisions.filter(shouldRedact);
  // Spans without usable offsets bypass overlap resolution (there is nothing
  // to compare) but are still kept, tokenized, and scrubbed by literal text.
  const unpositioned = candidates.filter(
    (span) => !isPositioned(span) && spanTextOf(span, text) !== '',
  );
  const kept = [...resolveOverlaps(candidates), ...unpositioned];
  const keptWithTokens = assignTokens(kept, text);

  const offsetReplaced = applyOffsetReplacements(text, keptWithTokens);
  const redactedText = scrubRepeats(offsetReplaced, keptWithTokens, text);

  const replacements = keptWithTokens
    .filter(isPositioned)
    .sort((a, b) => a.start - b.start)
    .map((span) => ({
      token: span.token,
      start: span.start,
      end: span.end,
      type: span.type,
    }));

  const unresolved = keptWithTokens
    .filter((span) => !isPositioned(span))
    .map((span) => {
      const spanText = spanTextOf(span, text);
      return {
        type: span.type,
        token: span.token,
        // True only when a literal occurrence actually existed and is now
        // gone. False means either nothing matched (the reported text never
        // occurred verbatim — a normalized form may survive) or the text is
        // too short for the repeat scrub to touch safely.
        scrubbed: text.includes(spanText) && !redactedText.includes(spanText),
      };
    });

  return { redactedText, replacements, unresolved };
}
