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
// Familiar reference birds (typical length in cm).
const REFS = [
  ["a hummingbird", 9], ["a chickadee", 13], ["a House Sparrow", 16], ["a cardinal", 22],
  ["an American Robin", 25], ["a Mourning Dove", 30], ["an American Crow", 45],
  ["a Mallard", 58], ["a Canada Goose", 95], ["a Great Blue Heron", 115],
];

// `exclude`: the bird's own name, so it is never compared with itself.
export function sizeText(min, max, exclude = "") {
  const lo = Number(min), hi = Number(max ?? min);
  if (!Number.isFinite(lo) || lo <= 0) return null;
  const top = Number.isFinite(hi) && hi > lo ? hi : lo;
  const mid = (lo + top) / 2;
  const cm = top > lo ? `${Math.round(lo)}–${Math.round(top)} cm` : `${Math.round(lo)} cm`;
  const inches = (mid / 2.54).toFixed(mid < 25 ? 1 : 0);
  const ex = String(exclude).toLowerCase();
  const refs = REFS.filter(([n]) => !ex.includes(n.replace(/^an? /i, "").toLowerCase()) && !n.toLowerCase().split(" ").slice(1).some((w) => w.length > 4 && ex.includes(w)));
  const [name, ref] = refs.reduce((best, r) => (Math.abs(Math.log(r[1] / mid)) < Math.abs(Math.log(best[1] / mid)) ? r : best));
  const ratio = mid / ref;
  const comparison = ratio < 0.8 ? `smaller than ${name}` : ratio < 0.93 ? `a little smaller than ${name}` : ratio <= 1.08 ? `about the size of ${name}` : ratio <= 1.25 ? `a little larger than ${name}` : `larger than ${name}`;
  return `${cm} (about ${inches} in), ${comparison}`;
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
  field_marks: z.array(z.string()),
  habitat: z.string().nullable(),
});

const SYSTEM = `You write identification hints for a bird flashcard app. The learner sees a photo and tries to name the bird; each hint should help without giving the answer away.
Use only facts stated in the provided Wikipedia text.
- length_cm_min / length_cm_max: the adult body length in centimetres as stated (convert inches if needed). Use the same number twice for a single value. Use null if no length is given (do not use wingspan or weight).
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
export function toHints(out, comName, sciName) {
  if (!out) return { size: null, fieldMarks: [], habitat: null };
  const clean = (s) => redact(String(s || "").trim().replace(/\.$/, ""), comName, sciName);
  return {
    size: sizeText(out.length_cm_min, out.length_cm_max, comName),
    fieldMarks: (out.field_marks || []).map(clean).filter(Boolean).slice(0, 3),
    habitat: out.habitat ? clean(out.habitat) + "." : null,
  };
}

export async function speciesHints(sciName, comName) {
  if (!getAnthropicKey()) return { available: false, reason: "ANTHROPIC_API_KEY is not set, so size, field-mark and habitat hints are off." };
  const article = await wikiArticle(sciName, comName);
  if (!article) return { available: true, size: null, fieldMarks: [], habitat: null, source: null };
  const out = await summarize(sourceText(splitSections(article.extract)), comName, sciName);
  return {
    available: true,
    ...toHints(out, comName, sciName),
    source: { title: article.title, url: article.url, license: "CC BY-SA 4.0" },
  };
}
