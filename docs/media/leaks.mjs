// The check record.mjs runs after each tape. A session can show who recorded it through an absolute
// path: a typeahead entry, an agent's prompt, a Bash call the model chose (#60). What a model prints
// is not up to the tape, so every recording is checked against vhs's text dump of its frames. vhs
// writes the recording to the demo folder, and it is copied into docs/media only when no frame
// shows a name; a failed run, a missing dump or a file the tape writes elsewhere never gets there.
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

// Copies every file vhs wrote for a tape (`out`) into docs/media (`media`), but only if no frame
// shows a name. Returns what showed one: empty when the files were copied.
export function publish({ dump, names, out, media }) {
  const shown = shows(dump, names);
  if (!shown.length) for (const f of fs.readdirSync(out)) fs.copyFileSync(path.join(out, f), path.join(media, f));
  return shown;
}
