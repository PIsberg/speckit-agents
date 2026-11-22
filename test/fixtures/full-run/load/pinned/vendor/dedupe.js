// An older copy of dedupe(), vendored before the feature: linear, and not the tree's src/dedupe.js.
export function dedupe(items) {
  return [...new Set(items)];
}
