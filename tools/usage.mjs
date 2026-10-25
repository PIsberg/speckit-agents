#!/usr/bin/env node
// Input tokens of one Claude Code session and the subagents it launched, read from its transcript.
// The numbers behind README.md, "Context budget".
//
//   node tools/usage.mjs <session>.jsonl
//
// Transcripts live under ~/.claude/projects/<project>/; a session's subagents are in
// <session>/subagents/agent-<id>.jsonl, with their agent type in the matching .meta.json.
//
// Claude Code writes one API response as several transcript lines (thinking, text, each tool call),
// every one carrying the same usage. Summing per line counts a response two or three times, so
// responses are counted once per message id. Counted that way, the per-model totals match the
// `modelUsage` input fields of `claude -p --output-format json` exactly. Output tokens are left out:
// the transcript keeps a partial count while the response streams, under the real one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The default prompt cache lifetime; a relaunch later than this starts cold anyway.
const CACHE_TTL_MS = 5 * 60 * 1000;
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('\n') : '');
const BACKGROUND = /Async agent launched/;

function readRows(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

// One entry per API response. A session's own transcript skips sidechain lines; a subagent's
// transcript is all sidechain. `after` is 'launched' when the input just before the response was a
// background agent's launch receipt.
export function responses(rows, { sidechain = false } = {}) {
  const byId = new Map(); let after = null; let n = 0;
  for (const r of rows) {
    if (Boolean(r.isSidechain) !== sidechain) continue;
    const m = r.message;
    if (m?.role === 'user') {
      const results = Array.isArray(m.content) ? m.content.filter((p) => p?.type === 'tool_result') : [];
      after = results.some((p) => BACKGROUND.test(textOf(p.content))) ? 'launched' : 'other';
    }
    if (m?.role !== 'assistant' || !m.usage) continue;
    const key = m.id ?? `line${n++}`;
    const u = m.usage;
    const e = byId.get(key) ?? { model: m.model ?? '?', after, tools: 0, at: r.timestamp };
    e.uncached = u.input_tokens ?? 0;
    e.cacheRead = u.cache_read_input_tokens ?? 0;
    e.cacheWrite = u.cache_creation_input_tokens ?? 0;
    e.input = e.uncached + e.cacheRead + e.cacheWrite;
    e.tools += (Array.isArray(m.content) ? m.content : []).filter((p) => p?.type === 'tool_use').length;
    byId.set(key, e);
  }
  return [...byId.values()];
}

// Agent launches and how each came back: a background launch returns a receipt, a foreground one
// returns the agent's report. `together` counts the Agent calls of the response that made it, so
// slices built side by side show as more than one (#114).
export function launches(rows) {
  const calls = new Map(); const perResponse = new Map(); const out = [];
  for (const r of rows) {
    if (r.isSidechain) continue;
    for (const p of Array.isArray(r.message?.content) ? r.message.content : []) {
      if (p?.type === 'tool_use' && (p.name === 'Agent' || p.name === 'Task')) {
        const key = r.message.id ?? p.id;
        perResponse.set(key, (perResponse.get(key) ?? 0) + 1);
        calls.set(p.id, { type: p.input?.subagent_type ?? 'general-purpose', worktree: p.input?.isolation === 'worktree', key });
      }
      if (p?.type === 'tool_result' && calls.has(p.tool_use_id)) {
        const { type, worktree, key } = calls.get(p.tool_use_id);
        out.push({ type, background: BACKGROUND.test(textOf(p.content)), worktree, together: perResponse.get(key) });
      }
    }
  }
  return out;
}

const sum = (list, k) => list.reduce((s, x) => s + x[k], 0);

export function summarise(file) {
  const rows = readRows(file);
  const resp = responses(rows);
  // A response that followed a background launch receipt and called no tool only waited.
  const waits = resp.filter((x) => x.after === 'launched' && !x.tools);
  const main = {
    responses: resp.length, input: sum(resp, 'input'), cacheRead: sum(resp, 'cacheRead'), cacheWrite: sum(resp, 'cacheWrite'),
    first: resp[0]?.input ?? 0, peak: Math.max(0, ...resp.map((x) => x.input)),
    models: [...new Set(resp.map((x) => x.model))],
    launches: launches(rows), waits: waits.length, waitInput: sum(waits, 'input'),
  };
  const dir = path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents');
  const all = [...resp];
  const agentDetails = [];
  const agents = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => f.endsWith('.jsonl')).sort().map((f) => {
    let type = '?';
    try { type = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType ?? '?'; } catch { /* no meta */ }
    const r = responses(readRows(path.join(dir, f)), { sidechain: true });
    all.push(...r);
    agentDetails.push({ type, responses: r });
    return { type, responses: r.length, input: sum(r, 'input'), peak: Math.max(0, ...r.map((x) => x.input)), models: [...new Set(r.map((x) => x.model))] };
  });

  // An agent's system prompt and tools are its own, so the first launch of a type always writes the
  // cache. A relaunch of the same type on the same model within the cache lifetime of the previous
  // one's last request should read at least the shared prefix back; one that reads nothing lost it.
  // In launch order: agent file names are random ids.
  const warnings = [];
  const lastOf = new Map();
  const started = agentDetails.filter((a) => a.responses.length)
    .sort((a, b) => String(a.responses[0].at ?? '').localeCompare(String(b.responses[0].at ?? '')));
  for (const { type, responses: r } of started) {
    const first = r[0];
    const key = `${type}\n${first.model}`;
    const gap = Date.parse(first.at) - Date.parse(lastOf.get(key)?.at);
    if (gap >= 0 && gap <= CACHE_TTL_MS && first.cacheRead === 0 && first.cacheWrite > 0) {
      warnings.push(`agent '${type}' on '${first.model}' read nothing from the cache although the previous '${type}' made a request ${Math.round(gap / 1000)}s before it: its prompt prefix changed between launches`);
    }
    lastOf.set(key, r.at(-1));
  }

  // Named as in the `modelUsage` of `claude -p --output-format json`, to compare against it.
  const models = {};
  for (const x of all) {
    const t = (models[x.model] ??= { inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
    t.inputTokens += x.uncached; t.cacheReadInputTokens += x.cacheRead; t.cacheCreationInputTokens += x.cacheWrite;
  }
  return { main, agents, models, warnings };
}

const k = (n) => `${Math.round(n / 1e3)}k`;
const M = (n) => `${(n / 1e6).toFixed(2)}M`;
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '0%');

export function format({ main, agents, models, warnings = [] }) {
  const bg = main.launches.filter((l) => l.background).length;
  const out = [
    `main session: ${main.responses} responses, input ${M(main.input)} (cache read ${M(main.cacheRead)}, cache write ${M(main.cacheWrite)}), first ${k(main.first)}, peak ${k(main.peak)}, ${main.models.join(', ')}`,
    `agent launches: ${main.launches.length} (${main.launches.length - bg} foreground, ${bg} background); responses that only waited for a background agent: ${main.waits}, input ${M(main.waitInput)} (${pct(main.waitInput, main.input)} of the main session)`,
  ];
  const together = main.launches.filter((l) => l.together > 1);
  if (together.length) {
    const responses = together.reduce((n, l) => n + 1 / l.together, 0);
    out.push(`side by side: ${Math.round(responses)} responses launched more than one agent (${together.length} agents), ${main.launches.filter((l) => l.worktree).length} agents in a worktree`);
  }
  if (agents.length) {
    out.push(`agents: ${agents.length}, input ${M(sum(agents, 'input'))}`);
    for (const a of agents) {
      out.push(`  ${a.type.padEnd(16)} ${String(a.responses).padStart(4)} responses  input ${M(a.input).padStart(6)}  peak ${k(a.peak).padStart(5)}  ${a.models.join(', ')}`);
    }
  }
  out.push('input per model, main session and agents:');
  for (const [model, t] of Object.entries(models)) {
    const total = t.inputTokens + t.cacheReadInputTokens + t.cacheCreationInputTokens;
    out.push(`  ${model}: uncached ${t.inputTokens}, cache read ${t.cacheReadInputTokens}, cache write ${t.cacheCreationInputTokens} (cache hit rate ${pct(t.cacheReadInputTokens, total)})`);
  }
  if (warnings.length) {
    out.push('agents that lost their cached prefix on a relaunch:');
    for (const w of warnings) out.push(`  ${w}`);
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('usage: node tools/usage.mjs <session>.jsonl');
    process.exit(2);
  }
  console.log(format(summarise(file)));
}
