// Size, field-mark and habitat hints for a species.
// Source text: the species' English Wikipedia article (CC BY-SA 4.0).
// Claude Haiku 5.5 condenses it into short hints; code then hides the bird's
// name and adds a size comparison with familiar birds.
// The Anthropic key (ANTHROPIC_API_KEY) is used only here, on the server.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ApiError } from "./ebird.js";

export const HINTS_MODEL = "claude-haiku-5-5";
const UA = "BirdFlashcards/0.1 (https://github.com/rvlaurentx/bird-flashcards)";
const MAX_SOURCE_CHARS = 9000;

export function getAnthropicKey() {
  return (process.env.ANTHROPIC_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").trim();
}

// ---------- Wikipedia ----------
const WANTED = /description|identification|appearance|plumage|morphology|habitat|distribution|range|ecology|behaviou?r/i;

// Split a plain-text extract into { intro, sections: [{ title, text }] }.
export function splitSections(extract) {
  const parts = String(extract || "").split(/\n\s*={2,}\s*([^=\n]+?)\s*={2,}\s*\n/);
  const out = { intro: (parts[0] || "").trim(), sections: [] };
  for (let i = 1; i < parts.length; i += 2) out.sections.push({ title: parts[i].trim(), text: (parts[i + 1] || "").trim() });
  return out;
}

export function sourceText({ intro, sections }) {
  const keep = sections.filter((s) => WANTED.test(s.title) && s.text);
  const text = [intro, ...keep.map((s) => `${s.title}:\n${s.text}`)].join("\n\n");
  return text.length > MAX_SOURCE_CHARS ? text.slice(0, MAX_SOURCE_CHARS) : text;
}

async function wikiExtract(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;
  let res;
  try { res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); }
  catch (e) { throw new ApiError(502, `Could not reach Wikipedia (${e.cause?.code || e.message}).`); }
  if (!res.ok) throw new ApiError(502, `Wikipedia returned ${res.status}.`);
  const page = (await res.json())?.query?.pages?.[0];
  if (!page || page.missing || !page.extract) return null;
  return { title: page.title, extract: page.extract };
}

export async function wikiArticle(sciName, comName) {
  for (const t of [sciName, comName].filter(Boolean)) {
    const hit = await wikiExtract(t);
    // A bird species article mentions its scientific name; skip disambiguation pages.
    if (hit && (!sciName || hit.extract.toLowerCase().includes(sciName.toLowerCase())) && !/may refer to:/i.test(hit.extract.slice(0, 300))) {
      return { ...hit, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}` };
    }
  }
  return null;
}

// ---------- size comparison ----------
// Birds are compared with familiar birds of a similar shape (user's request,
// confirmed by a professional bird guide: a Red-tailed Hawk and a Mallard
// weigh the same but don't look the same size). Reference figures are typical
// field-guide values: [name, length cm, wingspan cm, weight g].
export const REF_GROUPS = {
  raptors: [
    ["an American Kestrel", 25, 56, 115], ["a Sharp-shinned Hawk", 28, 55, 140],
    ["an Eastern Screech-Owl", 21, 51, 170], ["a Cooper's Hawk", 42, 78, 450],
    ["a Red-shouldered Hawk", 48, 100, 550], ["a Barred Owl", 50, 105, 700],
    ["a Red-tailed Hawk", 52, 122, 1100], ["an Osprey", 57, 160, 1600],
    ["a Turkey Vulture", 70, 170, 1800], ["a Bald Eagle", 86, 200, 4700],
  ],
  waterfowl: [
    ["a Green-winged Teal", 35, 58, 350], ["a Bufflehead", 35, 55, 400], ["a Wood Duck", 50, 70, 650],
    ["a Mallard", 58, 90, 1100], ["a Canada Goose", 95, 150, 4000], ["a Mute Swan", 150, 220, 10000],
  ],
  waders: [
    ["a Green Heron", 44, 66, 210], ["a Great Egret", 98, 135, 870],
    ["a Great Blue Heron", 115, 180, 2400], ["a Sandhill Crane", 110, 190, 4500],
  ],
  shorebirds: [
    ["a Least Sandpiper", 15, 30, 23], ["a Spotted Sandpiper", 19, 38, 40], ["a Killdeer", 25, 48, 90],
    ["a Greater Yellowlegs", 33, 62, 170], ["a Willet", 38, 66, 215], ["a Long-billed Curlew", 58, 88, 600],
  ],
  gulls: [
    ["a Forster's Tern", 33, 78, 160], ["a Laughing Gull", 40, 102, 300], ["a Ring-billed Gull", 47, 120, 520],
    ["a Herring Gull", 60, 140, 1100], ["a Great Black-backed Gull", 76, 160, 1650],
  ],
  landbirds: [
    ["a Ruby-throated Hummingbird", 8.5, 10, 3], ["a kinglet", 10, 16, 6], ["a chickadee", 12, 18, 10],
    ["a Dark-eyed Junco", 15, 23, 20], ["a House Sparrow", 16, 24, 28], ["an Eastern Bluebird", 18, 29, 30],
    ["a Northern Cardinal", 22, 28, 45], ["an American Robin", 25, 36, 77], ["a Blue Jay", 27, 38, 85],
    ["a Mourning Dove", 29, 45, 120], ["an American Crow", 45, 90, 450], ["a Wild Turkey", 110, 140, 7000],
  ],
};

// eBird family name → reference group.
export function refGroup(family = "") {
  const f = String(family);
  if (/hawks|eagles|kites|falcons|caracaras|vultures|osprey|owls/i.test(f)) return "raptors";
  if (/ducks|geese|swans|waterfowl/i.test(f)) return "waterfowl";
  if (/herons|egrets|bitterns|cranes|ibises|spoonbills|storks/i.test(f)) return "waders";
  if (/sandpipers|plovers|lapwings|oystercatchers|stilts|avocets|jacanas/i.test(f)) return "shorebirds";
  if (/gulls|terns|skimmers/i.test(f)) return "gulls";
  return "landbirds";
}

// Combined size: length, wingspan and the cube root of weight (a length-like
// measure of bulk), each scaled to "length units" and averaged in log space,
// so neither a long bill/neck nor a long wing alone makes a bird "bigger".
const ALL_REFS = Object.values(REF_GROUPS).flat();
const geoMean = (xs) => Math.exp(xs.reduce((t, x) => t + Math.log(x), 0) / xs.length);
const WING_TO_LEN = geoMean(ALL_REFS.map(([, l, w]) => l / w));
const MASS_TO_LEN = geoMean(ALL_REFS.map(([, l, , g]) => l / Math.cbrt(g)));

/** Combined size from whichever of length / wingspan / weight are known. */
export function sizeScore({ length, wingspan, mass }, use = { length: true, wingspan: true, mass: true }) {
  const parts = [];
  if (use.length && length > 0) parts.push(Math.log(length));
  if (use.wingspan && wingspan > 0) parts.push(Math.log(wingspan * WING_TO_LEN));
  if (use.mass && mass > 0) parts.push(Math.log(Math.cbrt(mass) * MASS_TO_LEN));
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
}

// A reference shares a distinctive word with the bird's own name
// (e.g. "chickadee" for Carolina Chickadee): never compare a bird with its kind.
function sameKind(refName, exclude) {
  const ex = String(exclude).toLowerCase();
  return refName.toLowerCase().replace(/^an? /, "").split(/[\s-]+/)
    .some((w) => w.length > 4 && !GENERIC.has(w) && ex.includes(w)); // "great", "northern"… don't count
}

// One decimal for small values (11.5 cm), whole numbers above 20.
const fmt = (n) => (n < 20 ? n.toFixed(1).replace(/\.0$/, "") : String(Math.round(n)));
const range = (lo, hi, unit) => (fmt(hi) !== fmt(lo) ? `${fmt(lo)}–${fmt(hi)} ${unit}` : `${fmt(lo)} ${unit}`);
const pair = (lo, hi) => {
  const a = Number(lo), b = Number(hi ?? lo);
  if (!Number.isFinite(a) || a <= 0) return null;
  return [a, Number.isFinite(b) && b > a ? b : a];
};
const mid = (p) => (p ? (p[0] + p[1]) / 2 : null);

/**
 * "45–65 cm (about 21 in), wingspan 110–145 cm, 690–1460 g: bigger than a
 * Cooper's Hawk, smaller than an Osprey". `dims` = { length, wingspan, mass },
 * each [min, max] or null. Compared within the bird's shape group, on the
 * measurements this bird actually has. `exclude` = the bird's own name.
 */
export function sizeText(dims, exclude = "", family = "") {
  const L = pair(...(dims.length || [])), W = pair(...(dims.wingspan || [])), M = pair(...(dims.mass || []));
  if (!L && !W && !M) return null;
  const me = { length: mid(L), wingspan: mid(W), mass: mid(M) };
  const use = { length: !!L, wingspan: !!W, mass: !!M };
  const score = sizeScore(me, use);

  const refs = REF_GROUPS[refGroup(family)].filter(([n]) => !sameKind(n, exclude))
    .map(([n, l, w, g]) => ({ n, s: sizeScore({ length: l, wingspan: w, mass: g }, use) }))
    .sort((a, b) => a.s - b.s);
  const close = refs.find((r) => Math.abs(score - r.s) <= Math.log(1.06));
  const below = refs.filter((r) => r.s < score).at(-1);
  const above = refs.find((r) => r.s > score);
  const comparison = close ? `about the size of ${close.n}`
    : below && above ? `bigger than ${below.n}, smaller than ${above.n}`
    : below ? `bigger than ${below.n}` : above ? `smaller than ${above.n}` : "";

  const parts = [];
  if (L) parts.push(`${range(L[0], L[1], "cm")} (about ${(mid(L) / 2.54).toFixed(mid(L) < 25 ? 1 : 0)} in)`);
  if (W) parts.push(`wingspan ${range(W[0], W[1], "cm")}`);
  if (M) parts.push(range(M[0], M[1], "g"));
  return `${parts.join(", ")}${comparison ? `: ${comparison}` : ""}`;
}

// ---------- hiding the name ----------
const GENERIC = new Set(["common", "northern", "southern", "eastern", "western", "american", "european", "great", "greater", "lesser", "little", "black", "white", "gray", "grey", "brown", "red", "blue", "green", "yellow", "bird"]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redact(text, comName, sciName) {
  if (!text) return text;
  let t = text;
  for (const n of [comName, sciName].filter(Boolean)) t = t.replace(new RegExp(`\\b(?:(?:a|an|the)\\s+)?${escapeRe(n)}`, "gi"), "this bird");
  const words = [...(comName || "").split(/[\s-]+/), ...(sciName || "").split(/\s+/)]
    .map((w) => w.replace(/[^\p{L}']/gu, "")).filter((w) => w.length >= 4 && !GENERIC.has(w.toLowerCase()));
  for (const w of words) t = t.replace(new RegExp(`\\b${escapeRe(w)}s?\\b`, "gi"), "…");
  return t.replace(/\s+/g, " ").trim();
}

// ---------- Claude ----------
const HintsSchema = z.object({
  length_cm_min: z.number().nullable(),
  length_cm_max: z.number().nullable(),
  wingspan_cm_min: z.number().nullable(),
  wingspan_cm_max: z.number().nullable(),
  mass_g_min: z.number().nullable(),
  mass_g_max: z.number().nullable(),
  field_marks: z.array(z.string()),
  habitat: z.string().nullable(),
});

const SYSTEM = `You write identification hints for a bird flashcard app. The learner sees a photo and tries to name the bird; each hint should help without giving the answer away.
Use only facts stated in the provided Wikipedia text.
- length_cm_min / length_cm_max: the adult body length in centimetres as stated (convert inches if needed). Use the same number twice for a single value. Use null if no length is given (do not use wingspan or weight).
- wingspan_cm_min / wingspan_cm_max: the wingspan in centimetres as stated (convert inches). Same number twice for a single value; null if not given.
- mass_g_min / mass_g_max: the adult weight in grams as stated (convert ounces or kilograms). Same number twice for a single value; null if not given.
- field_marks: 2 or 3 short phrases (each under 15 words) naming the most useful visual features for identifying the adult in the field: colours, patterns, bill, shape, and how males and females differ if notable.
- habitat: one short sentence (under 20 words) on where it is usually found, or null.
Never write the bird's common name, scientific name, genus or any part of them. Write plain phrases, not full sentences, for field marks.`;

let client = null;

export async function summarize(text, comName, sciName) {
  client ??= new Anthropic({ apiKey: getAnthropicKey() });
  let res;
  try {
    res = await client.messages.parse({
      model: HINTS_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(HintsSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Bird: ${comName} (${sciName})\n\nWikipedia text:\n${text}` }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ApiError(502, "Anthropic rejected ANTHROPIC_API_KEY. Check the key in Vercel.");
    if (e instanceof Anthropic.RateLimitError) throw new ApiError(503, "Hint service is busy. Try again shortly.");
    if (e instanceof Anthropic.APIError) throw new ApiError(502, `Hint service error (${e.status ?? "network"}).`);
    throw e;
  }
  if (res.stop_reason === "refusal" || !res.parsed_output) return null;
  return res.parsed_output;
}

// Turn Claude's output into the app's hint shape, hiding the name.
export function toHints(out, comName, sciName, family = "") {
  if (!out) return { size: null, fieldMarks: [], habitat: null };
  const clean = (s) => redact(String(s || "").trim().replace(/\.$/, ""), comName, sciName);
  return {
    size: sizeText({
      length: [out.length_cm_min, out.length_cm_max],
      wingspan: [out.wingspan_cm_min, out.wingspan_cm_max],
      mass: [out.mass_g_min, out.mass_g_max],
    }, comName, family),
    fieldMarks: (out.field_marks || []).map(clean).filter(Boolean).slice(0, 3),
    habitat: out.habitat ? clean(out.habitat) + "." : null,
  };
}

export async function speciesHints(sciName, comName, family = "") {
  if (!getAnthropicKey()) return { available: false, reason: "are off because ANTHROPIC_API_KEY is not set" };
  const article = await wikiArticle(sciName, comName);
  if (!article) return { available: true, size: null, fieldMarks: [], habitat: null, source: null };
  const out = await summarize(sourceText(splitSections(article.extract)), comName, sciName);
  return {
    available: true,
    ...toHints(out, comName, sciName, family),
    source: { title: article.title, url: article.url, license: "CC BY-SA 4.0" },
  };
}
