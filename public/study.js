// Flashcard study screen: photo → hints → answer → "did you know it?".

import { $, el, api, load, save, shuffle, mediaUrl, soundsUrl, periodText } from "./lib.js";
import { grade, sessionOrder, requeue, hintsFor, lookalikes } from "./learn.js";

const PROGRESS_KEY = "bf-progress";
const media = new Map(); // code -> Promise<media>
const sounds = new Map(); // code -> Promise<sounds>

export const getProgress = () => load(PROGRESS_KEY, {});

function mediaFor(sp) {
  if (!media.has(sp.code)) {
    const p = api(mediaUrl(sp))
      .catch(() => ({ photos: [], summary: null }));
    media.set(sp.code, p);
  }
  return media.get(sp.code);
}

function soundsFor(sp) {
  if (!sounds.has(sp.code)) {
    const p = api(soundsUrl(sp))
      .catch(() => ({ recordings: [] }));
    sounds.set(sp.code, p);
  }
  return sounds.get(sp.code);
}

// Warm the next card's data and image so it appears instantly.
function prefetch(sp) {
  if (!sp) return;
  soundsFor(sp);
  mediaFor(sp).then((m) => { [0, 1].forEach((o) => { const ph = pickPhoto(sp, m, o); if (ph) new Image().src = ph.url; }); });
}

// Rotate photos across reviews; offset 1 gives the "another photo" hint.
function pickPhoto(sp, m, offset = 0) {
  if (!m?.photos?.length) return null;
  const seen = (getProgress()[sp.code]?.right || 0) + (getProgress()[sp.code]?.wrong || 0);
  return m.photos[(seen + offset) % m.photos.length];
}

const cardHints = (c) => hintsFor(c.sp, c.media?.photos?.length || 0, c.sounds?.recordings?.length || 0);

const stopAudio = () => document.querySelectorAll("#view-study audio").forEach((a) => a.pause());

// One recording: label, native player, and the credit xeno-canto requires.
function player(rec, { autoplay = false } = {}) {
  const audio = el("audio", { controls: true, preload: autoplay ? "auto" : "none", src: rec.url });
  audio.addEventListener("play", () => document.querySelectorAll("#view-study audio").forEach((a) => a !== audio && a.pause()));
  audio.addEventListener("error", () => audio.replaceWith(el("p", { class: "photo-note" }, navigator.onLine ? "This recording couldn't be played." : "Recordings aren't saved for offline use yet.")));
  if (autoplay) audio.play().catch(() => { /* user can press play */ });
  const kind = rec.kind === "song" ? "Song" : rec.kind === "call" ? "Call" : "Sound";
  return el("div", { class: "sound" },
    el("span", { class: "hint-label" }, kind),
    audio,
    el("p", { class: "credit" },
      el("a", { href: rec.page, target: "_blank", rel: "noopener" }, rec.id), ` · ${rec.recordist} · `,
      rec.licenseUrl ? el("a", { href: rec.licenseUrl, target: "_blank", rel: "noopener" }, rec.license) : rec.license,
      " · xeno-canto"),
  );
}

let s = null; // session state

export function startSession({ deck, all, placeName, month = 0, onExit }) {
  s = { deck, all, placeName, month, onExit, queue: sessionOrder(deck, getProgress()), done: 0, firstTry: new Map(), card: null };
  $("#study-exit").onclick = () => { stopAudio(); onExit(); };
  showCard();
}

async function showCard() {
  if (!s.queue.length) return finish();
  const [card, ...rest] = s.queue;
  s.queue = rest;
  stopAudio();
  setRevealed(false);
  s.card = { sp: card, hintsUsed: 0, answered: false };
  prefetch(rest[0]);

  const total = s.deck.length;
  const firstDone = s.firstTry.size;
  $("#study-count").textContent = `${firstDone} of ${total} done`;
  $("#study-meter").style.width = `${(firstDone / total) * 100}%`;

  $("#hints").replaceChildren();
  $("#choices").hidden = true;
  $("#choices").replaceChildren();
  $("#answer").hidden = true;
  $("#answer").replaceChildren();
  renderPhoto(null, true);
  renderActions();

  const [m, snd] = await Promise.all([mediaFor(card), soundsFor(card)]);
  if (s.card?.sp !== card) return; // moved on meanwhile
  s.card.media = m;
  s.card.sounds = snd;
  renderPhoto(pickPhoto(card, m), false);
  renderActions(); // available hints depend on photos and sounds
}

function renderPhoto(photo, loading) {
  const frame = $("#photo-frame");
  const credit = $("#photo-credit");
  if (loading) { frame.replaceChildren(el("p", { class: "photo-note" }, "Loading photo…")); credit.textContent = ""; return; }
  if (!photo) {
    frame.replaceChildren(el("p", { class: "photo-note" }, navigator.onLine ? "No openly licensed photo found. Use the hints." : "Photo not saved for offline use yet. Use the hints."));
    credit.textContent = "";
    return;
  }
  const img = el("img", { src: photo.url, alt: "Photo of the bird to identify", decoding: "async" });
  img.onerror = () => renderPhoto(null, false);
  frame.replaceChildren(img);
  credit.replaceChildren(
    photo.page ? el("a", { href: photo.page, target: "_blank", rel: "noopener" }, photo.attribution) : photo.attribution,
    " · iNaturalist",
  );
}

function renderActions() {
  const c = s.card, hints = cardHints(c);
  const actions = $("#actions");
  if (!c.answered) {
    const next = hints[c.hintsUsed];
    const loading = !c.media; // wait for photos so the hint list is final
    actions.replaceChildren(
      el("button", { type: "button", class: "btn ghost", disabled: loading || !next, onclick: showHint }, loading ? "Hint" : next ? `Hint: ${next.label.toLowerCase()}` : "No more hints"),
      el("button", { type: "button", class: "btn primary", onclick: () => reveal() }, "Show answer"),
    );
  } else if (c.result === undefined) {
    actions.replaceChildren(
      el("p", { class: "ask" }, "Did you know it?"),
      el("button", { type: "button", class: "btn ghost", onclick: () => record(false) }, "No, missed it"),
      el("button", { type: "button", class: "btn primary", onclick: () => record(true) }, "Yes, knew it"),
    );
  } else {
    actions.replaceChildren(el("button", { type: "button", class: "btn primary wide", onclick: showCard }, s.queue.length ? "Next bird" : "Finish"));
  }
}

function showHint() {
  const c = s.card, hint = cardHints(c)[c.hintsUsed];
  if (!hint) return;
  c.hintsUsed++;
  let node;
  if (hint.kind === "choices") node = showChoices();
  else if (hint.kind === "photo") node = showExtraPhoto(c);
  else if (hint.kind === "sound") node = showSoundHint(c);
  else $("#hints").append(node = el("div", { class: "hint" }, el("span", { class: "hint-label" }, hint.label), el("span", {}, hint.text)));
  renderActions();
  bringIntoView(node);
}

// Scroll so a new hint is fully visible: below the sticky header and above
// the sticky button bar. If it's taller than the gap, show its top.
function bringIntoView(node) {
  if (!node) return;
  requestAnimationFrame(() => {
    const top = $(".bar").getBoundingClientRect().bottom + 8;
    const bottom = $("#actions").getBoundingClientRect().top - 8;
    const r = node.getBoundingClientRect();
    let dy = 0;
    if (r.height > bottom - top || r.top < top) dy = r.top - top;
    else if (r.bottom > bottom) dy = r.bottom - bottom;
    if (Math.abs(dy) < 2) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: dy, behavior: smooth ? "smooth" : "auto" });
  });
}

function showExtraPhoto(c) {
  const ph = pickPhoto(c.sp, c.media, 1);
  if (!ph) return;
  const credit = el("figcaption", { class: "credit" },
    ph.page ? el("a", { href: ph.page, target: "_blank", rel: "noopener" }, ph.attribution) : ph.attribution, " · iNaturalist");
  const img = el("img", { src: ph.url, alt: "Another photo of the same bird", decoding: "async" });
  const fig = el("figure", { class: "photo hint-photo" }, el("div", { class: "photo-frame" }, img), credit);
  img.onerror = () => fig.replaceChildren(el("p", { class: "photo-note" }, "This photo isn't available offline."));
  $("#hints").append(fig);
  return fig;
}

function showSoundHint(c) {
  const recs = c.sounds?.recordings || [];
  const rec = recs.find((r) => r.kind === "song") || recs[0];
  if (!rec) return;
  const node = player(rec, { autoplay: true });
  $("#hints").append(node);
  return node;
}

function showChoices() {
  const c = s.card;
  const options = shuffle([c.sp, ...lookalikes(c.sp, s.all)]);
  const box = $("#choices");
  box.hidden = false;
  box.replaceChildren(...options.map((o) => el("button", {
    type: "button", class: "choice", "data-code": o.code,
    onclick: () => {
      const right = o.code === c.sp.code;
      box.querySelectorAll("button").forEach((b) => {
        b.disabled = true;
        if (b.dataset.code === c.sp.code) b.classList.add("right");
        else if (b.dataset.code === o.code) b.classList.add("wrong");
      });
      reveal(o);
      record(right);
    },
  }, o.comName)));
  return box;
}

// Revealed layout: photo shrinks to a banner, hints and choices fold away,
// and the answer sits right under the photo so it's visible without scrolling.
function setRevealed(on) {
  $("#view-study").classList.toggle("revealed", on);
  if (on) {
    document.querySelectorAll("#hints audio").forEach((a) => a.pause());
    window.scrollTo({ top: 0 });
  }
}

async function reveal(chosen) {
  const c = s.card;
  if (c.answered) return;
  c.answered = true;
  const sp = c.sp;
  const pct = Math.round(sp.freq * 100);
  const ans = $("#answer");
  ans.hidden = false;
  setRevealed(true);
  ans.replaceChildren(
    chosen ? (chosen.code === sp.code
      ? el("p", { class: "ans-result right" }, "✓ Correct")
      : el("p", { class: "ans-result wrong" }, `✗ You chose ${chosen.comName}`)) : null,
    el("h2", { class: "ans-name" }, sp.comName),
    el("p", { class: "ans-sci" }, el("i", {}, sp.sciName), sp.family ? ` · ${sp.family}` : ""),
    el("p", { class: "ans-freq" }, `Seen on ${pct}% of ${periodText(s.month)} around ${s.placeName}.`),
    el("p", { class: "ans-summary" }),
    el("p", { class: "ans-links" },
      // Macaulay Library media can't be shown in-app without a license
      // (CLAUDE.md), so link out to eBird, which displays it.
      el("a", { class: "ebird-link", href: `https://ebird.org/species/${sp.code}`, target: "_blank", rel: "noopener" }, "More photos and sounds on eBird ↗"),
      el("span", { class: "credit" }, "From the Macaulay Library, Cornell Lab of Ornithology"),
    ),
  );
  const recs = c.sounds?.recordings || [];
  if (recs.length) ans.append(el("div", { class: "sounds" }, ...recs.map((r) => player(r))));
  renderActions();
  const m = await mediaFor(sp);
  if (s.card !== c || !m?.summary) return;
  const text = m.summary.length > 320 ? m.summary.slice(0, 320).replace(/\s+\S*$/, "") + "…" : m.summary;
  ans.querySelector(".ans-summary").replaceChildren(text, " ",
    m.wikipediaUrl ? el("a", { href: m.wikipediaUrl, target: "_blank", rel: "noopener" }, "Wikipedia") : "");
}

function record(knewIt) {
  const c = s.card;
  if (c.result !== undefined) return;
  c.result = knewIt;
  save(PROGRESS_KEY, grade(getProgress(), c.sp.code, { knewIt, hintsUsed: c.hintsUsed }));
  if (!s.firstTry.has(c.sp.code)) s.firstTry.set(c.sp.code, knewIt && c.hintsUsed === 0);
  if (!knewIt) s.queue = requeue(s.queue, c.sp);
  renderActions();
}

function finish() {
  stopAudio();
  setRevealed(false);
  const total = s.deck.length;
  const clean = [...s.firstTry.values()].filter(Boolean).length;
  const missed = s.deck.filter((sp) => s.firstTry.get(sp.code) === false || s.firstTry.get(sp.code) === undefined);
  $("#study-count").textContent = `${total} of ${total} done`;
  $("#study-meter").style.width = "100%";
  $("#photo-frame").replaceChildren(el("div", { class: "done" },
    el("p", { class: "done-big" }, `${clean} of ${total}`),
    el("p", {}, "named on sight with no hints."),
  ));
  $("#photo-credit").textContent = "";
  $("#hints").replaceChildren();
  $("#choices").hidden = true;
  const ans = $("#answer");
  ans.hidden = !missed.length;
  ans.replaceChildren(el("p", { class: "ans-freq" }, "Needed hints or missed:"), el("p", {}, missed.map((m) => m.comName).join(", ")));
  $("#actions").replaceChildren(
    el("button", { type: "button", class: "btn ghost", onclick: () => s.onExit() }, "Back to list"),
    el("button", { type: "button", class: "btn primary", onclick: () => startSession(s) }, "Study again"),
  );
}
