// Learning logic with no DOM: progress, scheduling, hints and look-alikes.
// Kept separate from the UI so it can be unit-tested in Node.

// ---------- progress (per species, shared across trips) ----------
// box 0 = new or missed, 5 = solid. Learning a bird counts everywhere.
export const LEARNED_BOX = 3;

export function grade(progress, code, { knewIt, hintsUsed }) {
  const p = { box: 0, right: 0, wrong: 0, ...(progress[code] || {}) };
  if (!knewIt) { p.box = 0; p.wrong++; }
  else if (hintsUsed === 0) { p.box = Math.min(5, p.box + 1); p.right++; }
  else { p.box = Math.max(1, p.box); p.right++; } // knew it with help: no promotion
  p.last = Date.now();
  return { ...progress, [code]: p };
}

// Study order: random (user's request), but weaker birds still come before
// ones you know. A fresh deck (all box 0) is fully shuffled.
export function sessionOrder(deck, progress, rand = Math.random) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const box = (s) => progress[s.code]?.box ?? 0;
  return shuffled.sort((a, b) => box(a) - box(b)); // stable: keeps random order within a box
}

// Missed cards come back a few cards later in the same session.
export function requeue(queue, card, gap = 3) {
  const q = [...queue];
  q.splice(Math.min(gap, q.length), 0, card);
  return q;
}

// ---------- hints ----------
// Agreed progression (CLAUDE.md): photo → family → size → field mark →
// habitat → song → reveal. Size, field mark, habitat and song need data we
// don't have yet, so today's steps are another photo → family → song/call →
// look-alike choices. No scientific names: the user doesn't use them.
export function hintsFor(sp, photoCount = 0, soundCount = 0) {
  const hints = [];
  if (photoCount > 1) hints.push({ kind: "photo", label: "Another photo", text: "" });
  if (sp.family) hints.push({ kind: "family", label: "Family", text: sp.family });
  if (soundCount > 0) hints.push({ kind: "sound", label: "Song or call", text: "" });
  hints.push({ kind: "choices", label: "Choices", text: "" });
  return hints;
}

// ---------- look-alikes ----------
// Classic confusion pairs (eBird species codes). Only used when both birds
// are on the trip list. Extend freely.
export const CONFUSION_PAIRS = [
  ["dowwoo", "haiwoo"], ["houfin", "purfin"], ["houfin", "casfin"], ["purfin", "casfin"],
  ["coohaw", "shshaw"], ["amecro", "comrav"], ["amecro", "fiscro"], ["bkcchi", "carchi"],
  ["lesyel", "greyel"], ["leasan", "semsan"], ["semsan", "wessan"], ["herthr", "swathr"],
  ["swathr", "veery"], ["swathr", "gycthr"], ["easpho", "eawpew"], ["turvul", "blkvul"],
  ["baleag", "goleag"], ["sonspa", "savspa"], ["sonspa", "linspa"], ["mallar3", "ambduc"],
  ["cangoo", "cacgoo1"], ["easmea", "wesmea"],
];

export function lookalikes(sp, all, n = 3) {
  const others = all.filter((s) => s.code !== sp.code);
  const byCode = new Map(others.map((s) => [s.code, s]));
  const picked = [];
  const add = (s) => { if (s && !picked.includes(s) && picked.length < n) picked.push(s); };
  for (const [a, b] of CONFUSION_PAIRS) { if (a === sp.code) add(byCode.get(b)); if (b === sp.code) add(byCode.get(a)); }
  if (sp.familyCode) others.filter((s) => s.familyCode === sp.familyCode).sort((a, b) => b.freq - a.freq).forEach(add);
  // Then the taxonomically nearest birds, which tend to look alike.
  others.filter((s) => s.taxonOrder != null && sp.taxonOrder != null)
    .sort((a, b) => Math.abs(a.taxonOrder - sp.taxonOrder) - Math.abs(b.taxonOrder - sp.taxonOrder)).forEach(add);
  others.forEach(add);
  return picked;
}
