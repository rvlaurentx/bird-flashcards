// Checks candidate observation photos with Claude Haiku 5.5 and keeps only
// those where a bird is clearly visible. iNaturalist observations sometimes
// lead with a habitat shot, a distant speck, a feather or a nest.
// One request per species (all candidates together); fails open: if the key
// is missing or the call fails, every photo is kept.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropicKey, HINTS_MODEL } from "./hints.js";

const CheckSchema = z.object({ bird_clearly_visible: z.array(z.boolean()) });

const PROMPT = `These are numbered photos from wildlife observations, to be used on bird-identification flashcards.
For each photo, in order, answer true only if a live bird is clearly visible and large enough to see its shape and markings.
Answer false for: habitat or landscape with no visible bird, a tiny distant speck, feathers, nests, eggs, tracks, droppings, dead birds, sound spectrograms, screenshots, or photos too blurry to show the bird.
Return exactly one true/false per photo, in the same order.`;

let client = null;

/** Returns the photos that pass. `photos` items need a public `url`. */
export async function keepClearPhotos(photos) {
  if (!photos.length || !getAnthropicKey()) return photos;
  client ??= new Anthropic({ apiKey: getAnthropicKey() });
  const content = [];
  photos.forEach((p, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}:` });
    content.push({ type: "image", source: { type: "url", url: p.url } });
  });
  content.push({ type: "text", text: `That was ${photos.length} photos. Answer for each.` });
  try {
    const res = await client.messages.parse({
      model: HINTS_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(CheckSchema) },
      system: PROMPT,
      messages: [{ role: "user", content }],
    });
    const verdicts = res.parsed_output?.bird_clearly_visible;
    if (res.stop_reason === "refusal" || !Array.isArray(verdicts) || verdicts.length !== photos.length) return photos;
    return photos.filter((_, i) => verdicts[i]);
  } catch (e) {
    console.error("photo check failed; keeping photos", e?.status ?? e?.message);
    return photos;
  }
}
