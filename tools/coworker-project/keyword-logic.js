// Pure keyword-list operations for the Stage 1 panel (ticket #16). No DOM/Lit,
// so these are unit-testable on their own. A keyword is { text, role } where
// role is "primary" | "secondary"; the list holds at most one Primary.

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The single Primary keyword, or undefined. */
export function primaryOf(keywords) {
  return keywords.find((k) => k.role === 'primary');
}

/**
 * Add a keyword. The first keyword is Primary; later ones are Secondary. A
 * case-insensitive duplicate is ignored (returns the same array reference).
 */
export function addKeyword(keywords, text) {
  const t = (text || '').trim();
  if (!t || keywords.some((k) => same(k.text, t))) return keywords;
  const role = keywords.length === 0 ? 'primary' : 'secondary';
  return [...keywords, { text: t, role }];
}

/** Promote one keyword to Primary; every other becomes Secondary. */
export function setPrimary(keywords, text) {
  return keywords.map((k) => ({ ...k, role: same(k.text, text) ? 'primary' : 'secondary' }));
}

/**
 * Remove a keyword. If the Primary was removed and keywords remain with no
 * Primary, promote the first so there is always exactly one Primary.
 */
export function removeKeyword(keywords, text) {
  const next = keywords.filter((k) => !same(k.text, text));
  if (next.length && !next.some((k) => k.role === 'primary')) {
    next[0] = { ...next[0], role: 'primary' };
  }
  return next;
}
