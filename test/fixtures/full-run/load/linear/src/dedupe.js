// The distinct items, first occurrence first. Linear: a Set remembers what was seen.
export function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const x of items) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}
