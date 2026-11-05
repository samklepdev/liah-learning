const NON_ALPHANUMERIC = /[^a-z0-9]/g;

function stripToAlphanumeric(value: string): string {
  return value.toLowerCase().replace(NON_ALPHANUMERIC, '');
}

/** First-initial + last name, lowercased and stripped to alphanumeric. Falls
 *  back to "user" if nothing alphanumeric survives (e.g. punctuation-only
 *  names). Collision handling (numeric suffixes) lives in user.model.ts. */
export function buildBaseUsername(firstName: string, lastName: string): string {
  const base = stripToAlphanumeric(firstName.slice(0, 1)) + stripToAlphanumeric(lastName);
  return base === '' ? 'user' : base;
}
