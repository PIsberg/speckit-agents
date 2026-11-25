#!/usr/bin/env node
// Checks every feature's finished test tasks against the tests as they are now, with no model:
//
//   node tools/drift.mjs [repo]
//
// One line per problem, then a count. Exit 0 without drift, 1 with it, 2 when the repo has no specs/.
// The check itself is hooks/speckit-drift.mjs, which the installed hook also runs on the active feature
// when spec-gatekeeper reports APPROVED (#228); what counts as drift is described there.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drift } from '../hooks/speckit-drift.mjs';

export { drift };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let spec = false; let feature = null; let repoArg = '.';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec') spec = true;
    else if (argv[i] === '--feature') feature = argv[++i] ?? null;
    else repoArg = argv[i];
  }
  let r;
  try { r = drift(path.resolve(repoArg), { feature, spec }); } catch (e) { console.error(`drift: ${e.message}`); process.exit(2); }
  for (const p of r.problems) console.log(p);
  for (const u of r.unchecked ?? []) console.log(u);
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const total = r.problems.length + (r.unchecked?.length ?? 0);
  console.log(`${n(r.tasks, 'test task')} in ${n(r.features, 'feature')} checked, ${total ? n(total, 'problem') : 'no drift'}`);
  process.exit(total ? 1 : 0);
}
