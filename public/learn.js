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
export function sessionOrder(deck, progress, rand = Math.random, key = (sp) => sp.code) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const box = (s) => progress[key(s)]?.box ?? 0;
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
// came later (Wikipedia via Claude, /api/hints). Today: another photo →
// song/call → family → size → field marks → habitat → look-alike choices
// (user moved song before family). No scientific names.
// `extra` = size / field-mark / habitat hints from /api/hints, when available.
// Order (user's choice): photo → song → size → habitat → family → field marks → choices.
export function hintsFor(sp, photoCount = 0, soundCount = 0, extra = null) {
  const hints = [];
  if (photoCount > 1) hints.push({ kind: "photo", label: "Another photo", text: "" });
  if (soundCount > 0) hints.push({ kind: "sound", label: "Song or call", text: "" });
  if (extra?.size) hints.push({ kind: "size", label: "Size", text: extra.size });
  if (extra?.habitat) hints.push({ kind: "habitat", label: "Habitat", text: extra.habitat });
  if (sp.family) hints.push({ kind: "family", label: "Family", text: sp.family });
  if (extra?.fieldMarks?.length) hints.push({ kind: "marks", label: "Field marks", text: extra.fieldMarks });
  hints.push({ kind: "choices", label: "Choices", text: "" });
  return hints;
}

// ---------- sound quiz (user's request: identify by ear) ----------
// Progress by ear is tracked separately from progress by sight.
export const progressKey = (code, mode = "photo") => (mode === "sound" ? `${code}@ear` : code);

// Order: another recording → habitat → size → family → see a photo → choices.
export function soundHintsFor(sp, recordingCount = 0, photoCount = 0, extra = null) {
  const hints = [];
  if (recordingCount > 1) hints.push({ kind: "recording", label: "Another recording", text: "" });
  if (extra?.habitat) hints.push({ kind: "habitat", label: "Habitat", text: extra.habitat });
  if (extra?.size) hints.push({ kind: "size", label: "Size", text: extra.size });
  if (sp.family) hints.push({ kind: "family", label: "Family", text: sp.family });
  if (photoCount > 0) hints.push({ kind: "seephoto", label: "See a photo", text: "" });
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

// ---------- points (user's request: reward using fewer hints) ----------
// Up to 10 points per bird; each hint costs what it gives away.
export const MAX_POINTS = 10;
export const HINT_COST = { photo: 1, sound: 2, family: 2, size: 1, marks: 2, habitat: 1, choices: 3, recording: 1, seephoto: 3 };
export const STREAK_AT = 3;     // clean answers in a row before the bonus starts
export const STREAK_BONUS = 2;  // extra points per clean answer while on a streak

export const hintCost = (kind) => HINT_COST[kind] ?? 1;

// Highest possible session score: every bird named with no hints, so the
// streak bonus applies from the STREAK_AT-th bird on.
export const maxScore = (birds) => birds * MAX_POINTS + Math.max(0, birds - STREAK_AT + 1) * STREAK_BONUS;

/**
 * Score one answer. Only a bird's first attempt in a session scores; a
 * missed bird that comes back is practice (0 points, streak unchanged).
 * Returns { points, base, bonus, streak, clean, practice }.
 */
export function scoreAnswer({ knewIt, hintKinds = [], firstAttempt = true, streak = 0 }) {
  if (!firstAttempt) return { points: 0, base: 0, bonus: 0, streak, clean: false, practice: true };
  if (!knewIt) return { points: 0, base: 0, bonus: 0, streak: 0, clean: false, practice: false };
  const spent = hintKinds.reduce((sum, k) => sum + hintCost(k), 0);
  const base = Math.max(1, MAX_POINTS - spent);
  const clean = hintKinds.length === 0;
  const newStreak = clean ? streak + 1 : 0;
  const bonus = clean && newStreak >= STREAK_AT ? STREAK_BONUS : 0;
  return { points: base + bonus, base, bonus, streak: newStreak, clean, practice: false };
}
