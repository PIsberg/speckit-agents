#!/usr/bin/env node
// Headless AI-factory batch orchestrator (#488): triages GitHub issues into /speckit-patch or
// /speckit-team (--team build, --team lite, or full team), runs each with bounded turns and cost,
// and executes up to maxCiHeal CI self-healing rounds when a PR check fails.
//
//   node tools/factory.mjs --out <dir> [--issues 460,461] [--label P2] [--project <name>] [--model sonnet] [--max-cost 6] [--max-ci-heal 2] [--login]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROTECTED_RE = /(?:^|[\s`'"])(\.specify\/|specs\/|\.claude\/|\.github\/|hooks\/speckit-(?:team|drift)\.mjs|agents\/[\w-]+\.md|skills\/[\w-]+\/SKILL\.md|install\.mjs)\b/i;
const MULTI_SLICE_RE = /\[P0\]|\[P1\]|\b(multi-module|architecture|public contract|schema migration|\d+ modules)\b/i;
const CAPABILITY_RE = /\b(add(?:s|ing)? (?:a )?(?:new )?(?:--\w+|flag|command|capability|option|output)|new CLI flag)\b/i;

export function triageIssue(issue, { project = null } = {}) {
  const text = `${issue?.title ?? ''}\n${issue?.body ?? ''}`;
  const proj = project ? `--project ${project} ` : '';
  if (MULTI_SLICE_RE.test(text)) {
    return { track: 'full', command: `/speckit-team ${proj}--yes `, reason: 'multi-slice capability or public contract' };
  }
  if (CAPABILITY_RE.test(text)) {
    return { track: 'lite', command: `/speckit-team ${proj}--team lite --yes `, reason: 'new flag, command or capability in one slice' };
  }
  if (PROTECTED_RE.test(text)) {
    return { track: 'build', command: `/speckit-team ${proj}--team build --yes `, reason: 'touches a protected path' };
  }
  return { track: 'patch', command: `/speckit-patch ${proj}`, reason: 'small change outside protected paths' };
}

export function ciHealPrompt(checks = [], failedLogs = '', { round = 1, maxRounds = 2 } = {}) {
  const failed = checks.filter((c) => /^(failure|error|timed_out|cancelled)$/i.test(String(c?.state ?? c?.conclusion ?? '')));
  if (!failed.length) return { status: 'green', prompt: null, failed: [] };
  const names = failed.map((c) => c.name || 'CI').join(', ');
  if (round > maxRounds) return { status: 'exhausted', prompt: null, failed: names };
  const trimmed = String(failedLogs ?? '').trim().slice(-4000);
  return {
    status: 'heal',
    failed: names,
    prompt: `CI check(s) failed (${names}, heal round ${round} of ${maxRounds}). Route the failure below to implementer or test-writer (and re-verify with spec-gatekeeper when in the team), commit, and push the fix:\n\n${trimmed}`,
  };
}

export function parseFactoryArgs(argv) {
  const o = { issues: [], label: null, project: null, model: 'sonnet', maxCost: 6, maxCiHeal: 2, login: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--login') o.login = true;
    else if (k === '--out') o.out = path.resolve(argv[++i]);
    else if (k === '--issues') o.issues = String(argv[++i] ?? '').split(',').map((n) => Number(n.trim())).filter(Number.isInteger);
    else if (k === '--label') o.label = argv[++i];
    else if (k === '--project') o.project = argv[++i];
    else if (k === '--model') o.model = argv[++i];
    else if (k === '--max-cost') o.maxCost = Number(argv[++i]);
    else if (k === '--max-ci-heal') o.maxCiHeal = Number(argv[++i]);
    else throw new Error(`unknown argument ${k}`);
  }
  if (!o.out) throw new Error('usage: node tools/factory.mjs --out <dir> [--issues n,n] [--label l] [--project p] [--model m] [--max-cost usd] [--max-ci-heal n] [--login]');
  return o;
}

export function runBatch({ out, issues = [], invoke, checkCi = null, project = null, maxCiHeal = 2 }) {
  fs.mkdirSync(out, { recursive: true });
  const results = [];
  for (const issue of issues) {
    const tri = triageIssue(issue, { project });
    const initialPrompt = `${tri.command}Fix issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}`.trim();
    const r0 = invoke(initialPrompt, null);
    let res = null;
    try { res = JSON.parse(r0.stdout); } catch { /* malformed output */ }
    let session = res?.session_id ?? null;
    let cost = Number(res?.total_cost_usd) || 0;
    let ciStatus = 'skipped';
    let ciHealRounds = 0;
    if (checkCi && r0.status === 0) {
      for (let round = 1; ; round++) {
        const ci = checkCi(issue, round);
        const heal = ciHealPrompt(ci?.checks ?? [], ci?.logs ?? '', { round, maxRounds: maxCiHeal });
        if (heal.status === 'green') { ciStatus = 'green'; break; }
        if (heal.status === 'exhausted') { ciStatus = 'red'; break; }
        ciHealRounds++;
        const rh = invoke(heal.prompt, session);
        try {
          const hres = JSON.parse(rh.stdout);
          if (hres?.session_id) session = hres.session_id;
          if (Number(hres?.total_cost_usd) > cost) cost = Number(hres.total_cost_usd);
        } catch { /* keep previous session/cost */ }
      }
    }
    results.push({ number: issue.number, title: issue.title, track: tri.track, command: tri.command.trim(), reason: tri.reason, session, cost, ciStatus, ciHealRounds, status: r0.status });
  }
  const summary = { when: new Date().toISOString(), count: results.length, results };
  fs.writeFileSync(path.join(out, 'factory.json'), JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseFactoryArgs(process.argv.slice(2));
    const listArgs = o.issues.length ? ['issue', 'list', '--json', 'number,title,body'] : ['issue', 'list', ...(o.label ? ['--label', o.label] : []), '--json', 'number,title,body'];
    const gh = spawnSync('gh', listArgs, { encoding: 'utf8' });
    if (gh.status !== 0) throw new Error(`gh issue list failed: ${gh.stderr}`);
    const all = JSON.parse(gh.stdout);
    const issues = o.issues.length ? all.filter((x) => o.issues.includes(x.number)) : all;
    runBatch({
      out: o.out,
      issues,
      project: o.project,
      maxCiHeal: o.maxCiHeal,
      invoke: (prompt, resume) => spawnSync('claude', ['-p', prompt, '--model', o.model, '--permission-mode', 'bypassPermissions', '--output-format', 'json', ...(resume ? ['--resume', resume] : [])], { encoding: 'utf8', maxBuffer: 64 << 20 }),
    });
  } catch (e) {
    console.error(`factory: ${e.message}`);
    process.exit(2);
  }
}
