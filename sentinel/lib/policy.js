// Routing policy: decides what happens to a detected entity based on its
// type and confidence score. Pure functions, no IO.

export const DEFAULT_POLICY = {
  version: 1,
  ceilings: { default: 0.75 },
  floor: 0.35,
  contextual_types: ['username', 'organization', 'location', 'job_title'],
  schema_descriptions: {},
};

/**
 * Route a detected entity to a handling decision.
 *
 * @param {string} entityType
 * @param {number} confidence - in [0, 1]
 * @param {object} policy
 * @returns {"allow-observed" | "consult" | "auto-redact"}
 */
export function route(entityType, confidence, policy) {
  if (typeof entityType !== 'string') {
    throw new TypeError('entityType must be a string');
  }
  if (
    typeof confidence !== 'number' ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new TypeError('confidence must be a number in [0, 1]');
  }

  if (confidence < policy.floor) {
    return 'allow-observed';
  }

  if (policy.contextual_types.includes(entityType)) {
    return 'consult';
  }

  const ceiling = policy.ceilings[entityType] ?? policy.ceilings.default;
  if (confidence >= ceiling) {
    return 'auto-redact';
  }

  return 'consult';
}
