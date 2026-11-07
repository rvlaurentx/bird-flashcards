// Flashcard study screen: photo → hints → answer → "did you know it?".
// Sound quiz mode (s.mode === "sound"): recording → hints → answer.

import { $, el, fill, api, load, save, shuffle, mediaUrl, soundsUrl, hintsUrl, periodText } from "./lib.js";

let where = null; // trip place + season for photos (set per session)
import { grade, sessionOrder, requeue, hintsFor, soundHintsFor, progressKey, lookalikes, scoreAnswer, hintCost, maxScore } from "./learn.js";

const BEST_KEY = "bf-best-scores"; // best session score per trip (place + month + list size)

const PROGRESS_KEY = "bf-progress";
const media = new Map(); // code -> Promise<media>
const sounds = new Map(); // code -> Promise<sounds>

export const getProgress = () => load(PROGRESS_KEY, {});

function mediaFor(sp) {
  const url = mediaUrl(sp, where);
  if (!media.has(url)) media.set(url, api(url).catch(() => ({ photos: [], summary: null })));
  return media.get(url);
}

// "© Name … · iNaturalist", plus where and when a local photo was taken.
function photoCredit(ph) {
  return [
    ph.page ? el("a", { href: ph.page, target: "_blank", rel: "noopener" }, ph.attribution) : ph.attribution,
    ` · ${ph.source || "iNaturalist"}`,
    ph.local && ph.context ? el("span", { class: "photo-where" }, ` · Taken ${ph.context}`) : null,
  ];
}

const extras = new Map(); // code -> Promise<size/field-mark/habitat hints>
function extraFor(sp) {
  // Keep the reason on failure so the answer card can say why hints are missing.
  if (!extras.has(sp.code)) extras.set(sp.code, api(hintsUrl(sp)).catch((e) => ({ available: false, error: e.message })));
  return extras.get(sp.code);
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
  extraFor(sp);
  mediaFor(sp).then((m) => { [0, 1].forEach((o) => { const ph = pickPhoto(sp, m, o); if (ph) new Image().src = ph.url; }); });
}

// Rotate photos across reviews; offset 1 gives the "another photo" hint.
function pickPhoto(sp, m, offset = 0) {
  if (!m?.photos?.length) return null;
  const seen = (getProgress()[sp.code]?.right || 0) + (getProgress()[sp.code]?.wrong || 0);
  return m.photos[(seen + offset) % m.photos.length];
}

const isSound = () => s?.mode === "sound";
const pkey = (sp) => progressKey(sp.code, s?.mode);

const cardHints = (c) => {
  const extra = c.extra?.available ? c.extra : null;
  return isSound()
    ? soundHintsFor(c.sp, c.sounds?.recordings?.length || 0, c.media?.photos?.length || 0, extra)
    : hintsFor(c.sp, c.media?.photos?.length || 0, c.sounds?.recordings?.length || 0, extra);
};

// Rotate recordings across sound-quiz reviews; offset 1 = "another recording".
function pickRecording(sp, snd, offset = 0) {
  const recs = snd?.recordings || [];
  if (!recs.length) return null;
  const p = getProgress()[progressKey(sp.code, "sound")];
  const seen = (p?.right || 0) + (p?.wrong || 0);
  return recs[(seen + offset) % recs.length];
}

// Sound quiz: the card's "photo" area is a listening panel.
function renderListen(c) {
  const rec = pickRecording(c.sp, c.sounds);
  const audio = el("audio", { controls: true, preload: "auto", src: rec.url });
  audio.addEventListener("play", () => document.querySelectorAll("#view-study audio").forEach((a) => a !== audio && a.pause()));
  audio.addEventListener("error", () => fill($("#photo-frame"), el("p", { class: "photo-note" },
    navigator.onLine ? "This recording couldn't be played. Use the hints." : "This recording isn't saved for offline use.")));
  const replay = el("button", { type: "button", class: "btn primary listen-btn", onclick: () => { audio.currentTime = 0; audio.play().catch(() => {}); } }, "▶ Play again");
  fill($("#photo-frame"), el("div", { class: "listen" }, el("p", { class: "listen-q" }, "Which bird is this?"), replay, audio));
  $("#photo-credit").textContent = "Recording details are shown with the answer.";
  audio.play().catch(() => { /* the user can press play */ });
}

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

export function startSession({ deck, all, placeName, month = 0, photoWhere = null, mode = "photo", onExit }) {
  where = photoWhere;
  const key = (sp) => progressKey(sp.code, mode);
  s = {
    deck: [...deck], all, placeName, month, photoWhere, mode, onExit, queue: sessionOrder(deck, getProgress(), Math.random, key),
    done: 0, firstTry: new Map(), card: null, score: 0, streak: 0, bestStreak: 0, skipped: [],
  };
  $("#view-study").classList.toggle("sound-mode", mode === "sound");
  $("#study-exit").onclick = () => { stopAudio(); onExit(); };
  showCard();
}

async function showCard() {
  if (!s.queue.length) return finish();
  const [card, ...rest] = s.queue;
  s.queue = rest;
  stopAudio();
  setRevealed(false);
  s.card = { sp: card, hintsUsed: 0, hintKinds: [], answered: false };
  prefetch(rest[0]);

  const total = s.deck.length;
  const firstDone = s.firstTry.size;
  updateCounter();
  $("#study-meter").style.width = `${(firstDone / total) * 100}%`;

  $("#hints").replaceChildren();
  $("#choices").hidden = true;
  $("#choices").replaceChildren();
  $("#answer").hidden = true;
  $("#answer").replaceChildren();
  if (isSound()) { fill($("#photo-frame"), el("p", { class: "photo-note" }, "Loading recording…")); $("#photo-credit").textContent = ""; }
  else renderPhoto(null, true);
  renderActions();

  const [m, snd, extra] = await Promise.all([mediaFor(card), soundsFor(card), extraFor(card)]);
  if (s.card?.sp !== card) return; // moved on meanwhile
  s.card.media = m;
  s.card.sounds = snd;
  s.card.extra = extra;
  if (isSound()) {
    // No recording (none on xeno-canto, or not saved for offline): skip the bird.
    if (!snd?.recordings?.length) {
      s.skipped.push(card);
      s.deck = s.deck.filter((x) => x !== card);
      return showCard();
    }
    renderListen(s.card);
  } else renderPhoto(pickPhoto(card, m), false);
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
  fill(credit, photoCredit(photo));
}

function renderActions() {
  const c = s.card, hints = cardHints(c);
  const actions = $("#actions");
  if (!c.answered) {
    const next = hints[c.hintsUsed];
    const loading = !c.media; // wait for photos so the hint list is final
    actions.replaceChildren(
      el("button", { type: "button", class: "btn ghost", disabled: loading || !next, onclick: showHint },
        loading ? "Hint" : next ? `Hint: ${next.label.toLowerCase()} (−${hintCost(next.kind)})` : "No more hints"),
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
  c.hintKinds.push(hint.kind);
  let node;
  if (hint.kind === "choices") node = showChoices();
  else if (hint.kind === "photo") node = showExtraPhoto(c);
  else if (hint.kind === "sound") node = showSoundHint(c);
  else if (hint.kind === "recording") {
    const rec = pickRecording(c.sp, c.sounds, 1);
    if (rec) $("#hints").append(node = player(rec, { autoplay: true }));
  } else if (hint.kind === "seephoto") node = showExtraPhoto(c, 0);
  else {
    const body = Array.isArray(hint.text)
      ? el("ul", { class: "hint-list" }, ...hint.text.map((t) => el("li", {}, t)))
      : el("span", {}, hint.text);
    $("#hints").append(node = el("div", { class: "hint" }, el("span", { class: "hint-label" }, hint.label), body));
  }
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

function showExtraPhoto(c, offset = 1) {
  const ph = pickPhoto(c.sp, c.media, offset);
  if (!ph) return;
  const credit = el("figcaption", { class: "credit" }, ...photoCredit(ph));
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

// Size, field marks and habitat on the answer side (when available).
function answerFacts(x) {
  if (!x) return null;
  // Say why size / field-mark / habitat hints are missing, instead of nothing.
  const why = x.error ? `couldn't load (${x.error})` : !x.available ? (x.reason || "are switched off") : null;
  if (why) return el("p", { class: "credit facts-missing" }, `Size, field-mark and habitat hints ${why.replace(/\.$/, "")}.`);
  if (!(x.size || x.fieldMarks?.length || x.habitat)) {
    return el("p", { class: "credit facts-missing" }, x.source ? "Wikipedia had no size, field-mark or habitat details for this bird." : "No Wikipedia article found for this bird, so there are no size, field-mark or habitat hints.");
  }
  const row = (label, body) => el("div", { class: "fact" }, el("span", { class: "hint-label" }, label), body);
  return el("div", { class: "facts" },
    x.size ? row("Size", el("span", {}, x.size)) : null,
    x.fieldMarks?.length ? row("Field marks", el("ul", { class: "hint-list" }, ...x.fieldMarks.map((t) => el("li", {}, t)))) : null,
    x.habitat ? row("Habitat", el("span", {}, x.habitat)) : null,
    x.source ? el("p", { class: "credit" }, "Condensed by Claude from ",
      el("a", { href: x.source.url, target: "_blank", rel: "noopener" }, `Wikipedia: ${x.source.title}`), ` (${x.source.license})`) : null,
  );
}

async function reveal(chosen) {
  const c = s.card;
  if (c.answered) return;
  c.answered = true;
  const sp = c.sp;
  const pct = Math.round(sp.freq * 100);
  const ans = $("#answer");
  ans.hidden = false;
  // Sound quiz: show the bird's photo now.
  if (isSound()) renderPhoto(pickPhoto(sp, c.media), false);
  setRevealed(true);
  fill(ans,
    chosen ? (chosen.code === sp.code
      ? el("p", { class: "ans-result right" }, "✓ Correct")
      : el("p", { class: "ans-result wrong" }, `✗ You chose ${chosen.comName}`)) : null,
    el("h2", { class: "ans-name" }, sp.comName),
    el("p", { class: "ans-sci" }, el("i", {}, sp.sciName), sp.family ? ` · ${sp.family}` : ""),
    el("p", { class: "ans-freq" }, `Seen on ${pct}% of ${periodText(s.month)} around ${s.placeName}.`),
    answerFacts(c.extra),
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

function updateCounter() {
  $("#study-count").textContent = `${s.firstTry.size} of ${s.deck.length} done · ${s.score} pts`;
}

// "+8 points · 1 hint" (or a streak / no-hints note) at the top of the answer.
function showPoints(r, hintsUsed) {
  let label, note;
  if (r.practice) { label = "Practice round"; note = "no points on a second try"; }
  else if (!r.points) { label = "0 points"; note = "it'll come back in a few cards"; }
  else {
    label = `+${r.points} point${r.points === 1 ? "" : "s"}`;
    note = r.clean ? (r.bonus ? `no hints · ${r.streak} in a row, +${r.bonus} streak bonus` : "no hints!") : `${hintsUsed} hint${hintsUsed === 1 ? "" : "s"}`;
  }
  const badge = el("p", { class: `points ${r.points ? (r.clean ? "clean" : "some") : "none"}` }, el("strong", {}, label), ` · ${note}`);
  $("#answer").prepend(badge);
}

function record(knewIt) {
  const c = s.card;
  if (c.result !== undefined) return;
  c.result = knewIt;
  const r = scoreAnswer({ knewIt, hintKinds: c.hintKinds, firstAttempt: !s.firstTry.has(c.sp.code), streak: s.streak });
  s.score += r.points;
  s.streak = r.streak;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  showPoints(r, c.hintsUsed);
  save(PROGRESS_KEY, grade(getProgress(), pkey(c.sp), { knewIt, hintsUsed: c.hintsUsed }));
  if (!s.firstTry.has(c.sp.code)) s.firstTry.set(c.sp.code, knewIt && c.hintsUsed === 0);
  if (!knewIt) s.queue = requeue(s.queue, c.sp);
  updateCounter();
  renderActions();
}

function finish() {
  stopAudio();
  setRevealed(false);
  const total = s.deck.length;
  const clean = [...s.firstTry.values()].filter(Boolean).length;
  const missed = s.deck.filter((sp) => s.firstTry.get(sp.code) === false || s.firstTry.get(sp.code) === undefined);
  updateCounter();
  $("#study-meter").style.width = "100%";
  if (!total) {
    fill($("#photo-frame"), el("div", { class: "done" },
      el("p", { class: "done-big" }, "No recordings"),
      el("p", { class: "done-note" }, navigator.onLine
        ? "None of these birds have recordings available."
        : "This trip was saved without sounds. Update it with sounds to quiz by ear offline.")));
    $("#photo-credit").textContent = ""; $("#hints").replaceChildren(); $("#answer").hidden = true;
    $("#actions").replaceChildren(el("button", { type: "button", class: "btn primary wide", onclick: () => s.onExit() }, "Back to list"));
    return;
  }
  // Best score for this trip (same place, month, list size and quiz type).
  const key = `${s.placeName}|${s.month}|${total}${isSound() ? "|sound" : ""}`;
  const bests = load(BEST_KEY, {});
  const prev = bests[key]?.score;
  const isBest = prev === undefined || s.score > prev;
  if (isBest) save(BEST_KEY, { ...bests, [key]: { score: s.score, at: Date.now() } });
  fill($("#photo-frame"), el("div", { class: "done" },
    el("p", { class: "done-big" }, `${s.score} points`),
    el("p", {}, `out of ${maxScore(total)} possible`),
    prev !== undefined && isBest ? el("p", { class: "new-best" }, `New best! Previous: ${prev}`) : null,
    prev !== undefined && !isBest ? el("p", { class: "done-note" }, `Your best for this trip: ${prev}`) : null,
    el("p", { class: "done-note" }, `${clean} of ${total} named ${isSound() ? "by ear " : ""}with no hints · best streak ${s.bestStreak}`),
    s.skipped.length ? el("p", { class: "done-note" }, `Skipped ${s.skipped.length} without a recording.`) : null,
  ));
  $("#photo-credit").textContent = "";
  $("#hints").replaceChildren();
  $("#choices").hidden = true;
  const ans = $("#answer");
  ans.hidden = !missed.length;
  ans.replaceChildren(el("p", { class: "ans-freq" }, "Needed hints or missed:"), el("p", {}, missed.map((m) => m.comName).join(", ")));
  $("#actions").replaceChildren(
    el("button", { type: "button", class: "btn ghost", onclick: () => s.onExit() }, "Back to list"),
    el("button", { type: "button", class: "btn primary", onclick: () => startSession({ ...s, deck: [...s.deck, ...s.skipped] }) }, isSound() ? "Quiz again" : "Study again"),
  );
}
