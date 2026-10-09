// The check record.mjs runs after each tape. A session can put the OS user name on screen through
// an absolute path: a typeahead entry, an agent's prompt, a Bash call the model chose (#60). What a
// model prints is not up to the tape, so every recording is checked against vhs's text dump of its
// frames, and one that shows the name is moved out of docs/media, where it could be committed.
import fs from 'node:fs';
import path from 'node:path';

// The files a tape writes into docs/media: its GIF ({{OUTPUT}}) and its screenshots ({{SHOTS}}).
const media = (name, tape) => [
  ...(tape.includes('Output "{{OUTPUT}}"') ? [`${name}.gif`] : []),
  ...[...tape.matchAll(/^Screenshot "\{\{SHOTS\}\}\/([^"]+)"/gm)].map((m) => m[1]),
];

// Returns the distinct dump lines that show the user name, ignoring case; empty when none do.
// Then the tape's files are moved from `media` (docs/media) to `work` (the demo folder).
export function quarantine({ name, tape, dump, user, media: from, work: to }) {
  const needle = user.toLowerCase();
  const lines = [...new Set(dump.split('\n').filter((l) => l.toLowerCase().includes(needle)).map((l) => l.trim()))];
  if (!lines.length) return lines;
  for (const f of media(name, tape)) {
    const src = path.join(from, f);
    if (!fs.existsSync(src)) continue;
    // Copied, not renamed: the demo folder can be on another drive.
    fs.copyFileSync(src, path.join(to, f));
    fs.rmSync(src);
  }
  return lines;
}
