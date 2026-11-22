// The distinct items, first occurrence first. Quadratic: includes() scans the output for every item.
export function dedupe(items) {
  const out = [];
  for (const x of items) if (!out.includes(x)) out.push(x);
  return out;
}
