// Flashcard study screen: photo → hints → answer → "did you know it?".

import { $, el, api, load, save, shuffle } from "./lib.js";
import { grade, sessionOrder, requeue, hintsFor, lookalikes } from "./learn.js";

const PROGRESS_KEY = "bf-progress";
const media = new Map(); // code -> Promise<media>

export const getProgress = () => load(PROGRESS_KEY, {});

function mediaFor(sp) {
  if (!media.has(sp.code)) {
    const p = api(`/api/media?sci=${encodeURIComponent(sp.sciName)}&name=${encodeURIComponent(sp.comName)}`)
      .catch(() => ({ photos: [], summary: null }));
    media.set(sp.code, p);
  }
  return media.get(sp.code);
}

// Warm the next card's data and image so it appears instantly.
function prefetch(sp) {
  if (!sp) return;
  mediaFor(sp).then((m) => { const ph = pickPhoto(sp, m); if (ph) new Image().src = ph.url; });
}

function pickPhoto(sp, m) {
  if (!m?.photos?.length) return null;
  const seen = (getProgress()[sp.code]?.right || 0) + (getProgress()[sp.code]?.wrong || 0);
  return m.photos[seen % m.photos.length]; // rotate photos across reviews
}

let s = null; // session state

export function startSession({ deck, all, placeName, onExit }) {
  s = { deck, all, placeName, onExit, queue: sessionOrder(deck, getProgress()), done: 0, firstTry: new Map(), card: null };
  $("#study-exit").onclick = () => onExit();
  showCard();
}

async function showCard() {
  if (!s.queue.length) return finish();
  const [card, ...rest] = s.queue;
  s.queue = rest;
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

  const m = await mediaFor(card);
  if (s.card?.sp !== card) return; // moved on meanwhile
  renderPhoto(pickPhoto(card, m), false);
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
  const c = s.card, hints = hintsFor(c.sp);
  const actions = $("#actions");
  if (!c.answered) {
    const next = hints[c.hintsUsed];
    actions.replaceChildren(
      el("button", { type: "button", class: "btn ghost", disabled: !next, onclick: showHint }, next ? `Hint: ${next.label.toLowerCase()}` : "No more hints"),
      el("button", { type: "button", class: "btn primary", onclick: reveal }, "Show answer"),
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
  const c = s.card, hint = hintsFor(c.sp)[c.hintsUsed];
  if (!hint) return;
  c.hintsUsed++;
  if (hint.kind === "choices") showChoices();
  else $("#hints").append(el("div", { class: "hint" }, el("span", { class: "hint-label" }, hint.label), el("span", {}, hint.text)));
  renderActions();
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
      reveal();
      record(right);
    },
  }, o.comName)));
}

async function reveal() {
  const c = s.card;
  if (c.answered) return;
  c.answered = true;
  const sp = c.sp;
  const pct = Math.round(sp.freq * 100);
  const ans = $("#answer");
  ans.hidden = false;
  ans.replaceChildren(
    el("h2", { class: "ans-name" }, sp.comName),
    el("p", { class: "ans-sci" }, el("i", {}, sp.sciName), sp.family ? ` · ${sp.family}` : ""),
    el("p", { class: "ans-freq" }, `Seen on ${pct}% of recent checklists around ${s.placeName}.`),
    el("p", { class: "ans-summary" }),
    el("p", { class: "ans-links" },
      el("a", { href: `https://ebird.org/species/${sp.code}`, target: "_blank", rel: "noopener" }, "eBird species page"),
    ),
  );
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
