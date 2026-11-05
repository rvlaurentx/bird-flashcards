// Checks candidate observation photos with Claude Haiku 5.5 and keeps only
// those where a bird is clearly the subject. iNaturalist observations
// sometimes lead with a habitat shot, a bird hidden in branches, a distant
// speck, a feather or a nest.
// One request per species (all candidates together). The server downloads
// the photos itself and sends them inline, so the check doesn't depend on
// Anthropic reaching iNaturalist. Fails open: if the key is missing or the
// call fails, every photo is kept, and the reason is reported.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicKey, HINTS_MODEL } from "./hints.js";

const CheckSchema = z.object({ bird_is_clear_subject: z.array(z.boolean()) });
const TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

const PROMPT = `These are numbered photos from wildlife observations, to be used as bird-identification flashcards: a learner must be able to identify the bird from the photo alone.
For each photo, in order, answer true only if a live bird is the clear subject: in focus, unobstructed enough to see its shape, colours and markings, and large enough to notice immediately.
Answer false if you have to search the image to find the bird, or if it is mostly hidden by branches or leaves, a tiny or distant speck, a silhouette, badly blurred, or if the photo shows habitat, plants, feathers, a nest, eggs, tracks, droppings, a dead bird, a sound spectrogram or a screenshot.
When unsure, answer false. Return exactly one true/false per photo, in the same order.`;

let client = null;

async function inlineImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo ${res.status}`);
  const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  if (!TYPES.has(type) || buf.length > MAX_IMAGE_BYTES) throw new Error("unsupported photo");
  return { type: "base64", media_type: type, data: buf.toString("base64") };
}

/**
 * Returns { photos, check } where photos are those that pass and check is a
 * short report: { ran, of, kept, error? }.
 */
export async function keepClearPhotos(photos) {
  if (!photos.length) return { photos, check: { ran: false, reason: "no candidates" } };
  if (!getAnthropicKey()) return { photos, check: { ran: false, reason: "no ANTHROPIC_API_KEY" } };
  client ??= new Anthropic({ apiKey: getAnthropicKey() });

  // Download candidates; a photo we can't download is dropped (it would
  // likely fail on the phone too).
  const loaded = (await Promise.all(photos.map(async (p) => {
    try { return { p, source: await inlineImage(p.url) }; } catch { return null; }
  }))).filter(Boolean);
  if (!loaded.length) return { photos, check: { ran: false, reason: "could not download photos" } };

  const content = [];
  loaded.forEach(({ source }, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}:` });
    content.push({ type: "image", source });
  });
  content.push({ type: "text", text: `That was ${loaded.length} photos. Answer for each.` });
  try {
    const res = await client.messages.parse({
      model: HINTS_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(CheckSchema) },
      system: PROMPT,
      messages: [{ role: "user", content }],
    });
    const verdicts = res.parsed_output?.bird_is_clear_subject;
    if (res.stop_reason === "refusal" || !Array.isArray(verdicts) || verdicts.length !== loaded.length) {
      return { photos, check: { ran: false, reason: "unusable answer" } };
    }
    const kept = loaded.filter((_, i) => verdicts[i]).map(({ p }) => p);
    return { photos: kept, check: { ran: true, of: loaded.length, kept: kept.length } };
  } catch (e) {
    console.error("photo check failed; keeping photos", e?.status ?? e?.message);
    return { photos, check: { ran: false, reason: `check failed (${e?.status ?? e?.message ?? "error"})` } };
  }
}
