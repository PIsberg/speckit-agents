// The check record.mjs runs after each tape. A session can show who recorded it through an absolute
// path: a typeahead entry, an agent's prompt, a Bash call the model chose (#60). What a model prints
// is not up to the tape, so every recording is checked against vhs's text dump. vhs writes the
// recording to the demo folder, and it is copied into docs/media only when the dump shows no name; a
// failed run, a missing dump or a file the tape writes elsewhere never gets there. The dump holds the
// screen after each tape command only, not the frames drawn during a Sleep or a Wait, so a name an
// agent prints mid-run can pass (#62): someone still has to look at every frame.
import fs from 'node:fs';
import path from 'node:path';

const base = (p) => (p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

// The names that identify the user on screen: the OS user name, the home folder's name, and on
// Windows that folder's 8.3 short form, which TEMP often holds (C:\Users\PATRIC~1\...).
export function identities({ user, home, shortHome }) {
  return [...new Set([user, base(home), base(shortHome)].map((n) => (n ?? '').toLowerCase()).filter(Boolean))];
}

// The dump rows that show a name, ignoring case. A name that a row break split in two is found in
// the dump with all whitespace removed. With no name to look for, that is reported too.
function shows(dump, names) {
  if (!names.length) return ['no user name to look for'];
  const rows = [...new Set(dump.split('\n').map((l) => l.trim()).filter((l) => names.some((n) => l.toLowerCase().includes(n))))];
  if (rows.length) return rows;
  const squash = (s) => s.toLowerCase().replace(/\s+/g, '');
  const joined = squash(dump);
  return names.filter((n) => joined.includes(squash(n))).map((n) => `${n}, split across rows`);
}

// The environment vhs and the session it records run with. Claude Code gives each agent a scratchpad
// under the temp folder, which on Windows sits in the home folder; with the drive letter's own
// folder (`tmp`) a scratchpad path an agent prints reads R:\tmp\... instead. Without one, `env`.
export function sessionEnv(env, tmp) {
  return tmp ? { ...env, TEMP: tmp, TMP: tmp, TMPDIR: tmp } : env;
}

// #143: the text of every frame the recording shows, which the dump misses: ffmpeg's mpdecimate keeps
// each GIF's distinct frames, and tesseract reads them and each screenshot. `work` is an empty folder
// for the frames; `run` is spawnSync's shape. Returns { text } or { failure }: a tool that is missing
// or fails, no frame, or no text at all (tesseract without its language data reads nothing, and a
// check that read nothing would pass anything) fails the tape rather than pass it.
export function frameText({ out, work, run }) {
  const said = (cmd, r) => (r.error ? `${cmd} did not run (${r.error.code === 'ENOENT' ? 'not on PATH' : r.error.message})`
    : `${cmd} exited ${r.status}: ${(r.stderr ?? '').trim().split('\n').pop()}`);
  const images = [];
  for (const f of fs.readdirSync(out).sort()) {
    if (f.endsWith('.png')) images.push(path.join(out, f));
    if (!f.endsWith('.gif')) continue;
    const stem = path.join(work, f.slice(0, -4));
    const r = run('ffmpeg', ['-v', 'error', '-i', path.join(out, f), '-vf', 'mpdecimate', '-fps_mode', 'vfr', `${stem}-%04d.png`]);
    if (r.error || r.status !== 0) return { failure: said('ffmpeg', r) };
    const frames = fs.readdirSync(work).filter((n) => n.startsWith(`${path.basename(stem)}-`) && n.endsWith('.png')).sort();
    if (!frames.length) return { failure: `ffmpeg wrote no frame of ${f}` };
    images.push(...frames.map((n) => path.join(work, n)));
  }
  const texts = [];
  for (const image of images) {
    const r = run('tesseract', [image, 'stdout'], { encoding: 'utf8' });
    if (r.error || r.status !== 0) return { failure: said('tesseract', r) };
    texts.push(r.stdout ?? '');
  }
  const text = texts.join('\n');
  return text.trim() ? { text } : { failure: `the OCR read no text in ${images.length} images: is tesseract's language data installed?` };
}

// Copies every file vhs wrote for a tape (`out`) into docs/media (`media`), but only if neither the
// dump nor the frames' text shows a name. Without the frames' text nothing is copied. Returns what
// showed one: empty when the files were copied.
export function publish({ dump, frames, names, out, media }) {
  const shown = typeof frames === 'string' ? shows(`${dump}\n${frames}`, names) : ['no frame text to check'];
  if (!shown.length) for (const f of fs.readdirSync(out)) fs.copyFileSync(path.join(out, f), path.join(media, f));
  return shown;
}
