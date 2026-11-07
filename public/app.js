// Bird Flashcards — place search → ranked species list → flashcards.

import { $, el, fill, api, load, save, speciesUrl, MONTHS, periodText, coord, hasCoords, photoContextFor } from "./lib.js";
import { LEARNED_BOX } from "./learn.js";
import { startSession, getProgress } from "./study.js";
import { SOUND_CHOICES, deckId, getDeck, listDecks, downloadDeck, removeDeck, estimateBytes, formatBytes } from "./decks.js";

const RECENT_KEY = "bf-recent-places";
const MONTH_KEY = "bf-trip-month";
const state = { place: null, data: null, top: 25, month: Number(load(MONTH_KEY, 0)) || 0 };
const monthName = (m) => (m ? MONTHS[m - 1] : "recent sightings");
// Offline-save panel. `id` ties a running download to its place.
const off = { mode: "idle", id: null, sounds: 1, done: 0, total: 0, bytes: 0, controller: null, note: "", error: false };

// ---------- storage (per-device conveniences only) ----------
const getRecent = () => load(RECENT_KEY, []).filter(hasCoords);
function addRecent(p) {
  save(RECENT_KEY, [p, ...getRecent().filter((r) => !(r.lat === p.lat && r.lng === p.lng))].slice(0, 6));
}

// ---------- views ----------
function show(view) {
  for (const v of ["search", "list", "study"]) $(`#view-${v}`).hidden = view !== v;
  window.scrollTo(0, 0);
}

function placeButton(p, onPick) {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = `<span class="p-name"></span><span class="p-detail"></span>`;
  b.querySelector(".p-name").textContent = p.name;
  b.querySelector(".p-detail").textContent = p.detail || "";
  b.addEventListener("click", () => onPick(p));
  li.append(b);
  return li;
}

function renderRecent() {
  const saved = listDecks().filter(hasCoords);
  const savedIds = new Set(saved.map((d) => d.id));
  const recent = getRecent().filter((p) => !savedIds.has(deckId(p)));
  $("#recent-block").hidden = !recent.length;
  $("#recent").replaceChildren(...recent.map((p) => placeButton(p, openPlace)));
  $("#saved-block").hidden = !saved.length;
  $("#saved").replaceChildren(...saved.map((d) => {
    const li = placeButton({ ...d, detail: `${d.birds} birds · ${d.month ? MONTHS[d.month - 1] : "recent sightings"} · ${formatBytes(d.bytes)} · saved ${fmtDay(d.savedAt)}` }, () => openPlace(d, { fromDeck: true }));
    li.querySelector("button").append(el("span", { class: "p-badge" }, "✓ Works offline"));
    return li;
  }));
}

const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function setTop(n) {
  state.top = n;
  document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.top) === n)));
}

async function searchPlaces(q) {
  const msg = $("#search-msg");
  msg.className = "msg"; msg.textContent = "Searching…";
  $("#places").replaceChildren();
  try {
    const { places } = await api(`/api/places?q=${encodeURIComponent(q)}`);
    if (!places.length) { msg.textContent = `No places found for “${q}”. Try adding a state or country.`; return; }
    msg.textContent = places.length > 1 ? "Pick the place you mean:" : "";
    $("#places").replaceChildren(...places.map((p) => placeButton(p, openPlace)));
    if (places.length === 1) openPlace(places[0]);
  } catch (e) { msg.className = "msg error"; msg.textContent = e.message; }
}

function setMonth(m) {
  state.month = m;
  $("#month").value = String(m);
}

async function openPlace(p, { fromDeck = false } = {}) {
  p = { name: p.name, detail: p.detail, lat: coord(p.lat), lng: coord(p.lng) };
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    show("search");
    const msg = $("#search-msg");
    msg.className = "msg error";
    msg.textContent = `“${p.name || "That place"}” came back without map coordinates, so its birds can't be looked up. Try a nearby town or a more specific name.`;
    return;
  }
  state.place = p; state.data = null;
  const deck = getDeck(p);
  if (deck) {
    p.detail = deck.detail; setTop(deck.top ?? 25);
    // Opening a saved trip (or any saved place while offline) shows the month it was saved for.
    if (fromDeck || !navigator.onLine) setMonth(deck.month ?? 0);
  }
  $("#month").value = String(state.month);
  loadSpecies();
}

async function loadSpecies() {
  const p = state.place;
  if (off.mode !== "downloading") Object.assign(off, { mode: "idle", note: "", error: false });
  $("#offline-box").hidden = true;
  addRecent(p);
  show("list");
  $("#list-title").textContent = p.name;
  $("#list-meta").textContent = p.detail || "";
  $("#species").replaceChildren();
  $("#list-count").textContent = "";
  $("#study-start").hidden = true;
  $("#sound-start").hidden = true;
  const msg = $("#list-msg");
  msg.className = "msg";
  msg.textContent = state.month
    ? `Reading eBird checklists from ${MONTHS[state.month - 1]} in past years… this can take a few seconds.`
    : "Reading recent eBird checklists… this can take a few seconds.";
  const month = state.month;
  try {
    // Round coordinates so nearby searches share one cached response.
    const data = await api(speciesUrl(p, month));
    if (state.place !== p || state.month !== month) return; // changed meanwhile
    state.data = data;
    msg.textContent = "";
    const s = data.sample;
    const range = s.from && s.to ? ` from ${fmtDate(s.from)} to ${fmtDate(s.to)}` : "";
    const kind = `${s.richest ? "most species-rich " : ""}${s.completeOnly ? "complete " : ""}checklists`;
    const of = s.considered ? ` of ${s.considered}` : "";
    $("#list-meta").textContent = month
      ? `${data.region.name} · ${s.checklists} ${kind}${of} from ${MONTHS[month - 1]} (${yearsOf(s)})`
      : `${data.region.name} · ${s.checklists} ${kind}${of} recent${range}`;
    renderSpecies();
  } catch (e) { msg.className = "msg error"; msg.textContent = e.message; }
}

const visible = () => { const all = state.data?.species || []; return state.top ? all.slice(0, state.top) : all; };

function renderSpecies() {
  const all = state.data?.species || [];
  const list = visible();
  const progress = getProgress();
  const learned = list.filter((sp) => (progress[sp.code]?.box ?? 0) >= LEARNED_BOX).length;
  $("#list-count").textContent = `${list.length} of ${all.length} species · ${learned} learned`;
  const btn = $("#study-start");
  btn.hidden = !list.length;
  btn.textContent = `Study these ${list.length} birds`;
  $("#sound-start").hidden = !list.length;
  renderOffline();
  $("#species").replaceChildren(...list.map((sp, i) => {
    const li = document.createElement("li");
    li.className = "sp";
    const pct = Math.round(sp.freq * 100);
    li.innerHTML = `
      <span class="sp-rank">${i + 1}</span>
      <span class="sp-text"><span class="sp-name"></span><br><span class="sp-sci"></span> <span class="sp-fam"></span></span>
      <span class="sp-pct" title="Seen on ${pct}% of sampled checklists">${pct}%</span>
      <span class="sp-meter" aria-hidden="true"><i style="width:${Math.max(2, pct)}%"></i></span>`;
    li.querySelector(".sp-name").textContent = sp.comName;
    if ((progress[sp.code]?.box ?? 0) >= LEARNED_BOX) li.querySelector(".sp-name").append(Object.assign(document.createElement("span"), { className: "learned-dot", title: "Learned" }));
    li.querySelector(".sp-sci").textContent = sp.sciName;
    li.querySelector(".sp-fam").textContent = sp.family ? `· ${sp.family}` : "";
    return li;
  }));
}

// ---------- offline trip decks ----------
function renderOffline() {
  const box = $("#offline-box");
  if (!state.data || !state.place) { box.hidden = true; return; }
  box.hidden = false;
  box.classList.remove("bare");
  const id = deckId(state.place);
  const deck = getDeck(state.place);
  const list = visible();
  const mine = off.id === id;
  const mode = off.mode === "downloading" && !mine ? "busy" : mine || off.mode === "downloading" ? off.mode : "idle";
  const btn = (label, cls, onclick, extra = {}) => el("button", { type: "button", class: `btn ${cls}`, onclick, ...extra }, label);
  const note = off.note && mine ? el("p", { class: `off-note${off.error ? " error" : ""}` }, off.note) : null;

  if (mode === "downloading") {
    const pct = off.total ? Math.round((off.done / off.total) * 100) : 0;
    fill(box, 
      el("p", { class: "off-title" }, "Saving for offline use…"),
      el("div", { class: "meter" }, el("i", { style: `width:${pct}%` })),
      el("p", { class: "off-note" }, `${off.done} of ${off.total} birds · ${formatBytes(off.bytes)} so far. Keep the app open.`),
      btn("Cancel", "ghost wide", () => off.controller?.abort()),
    );
    return;
  }
  if (mode === "busy") {
    fill(box, el("p", { class: "off-note" }, "Another trip is being saved. You can save this one when it finishes."));
    return;
  }
  if (mode === "choose") {
    const est = () => `About ${formatBytes(estimateBytes(list.length, off.sounds))} for ${list.length} birds (2 photos each${off.sounds ? ", plus sounds" : ""}).`;
    const estP = el("p", { class: "off-note" }, est());
    const opts = el("fieldset", { class: "sound-opts" }, el("legend", {}, "Sounds to save"),
      ...SOUND_CHOICES.map((c) => el("label", {},
        el("input", { type: "radio", name: "deck-sounds", id: `deck-sounds-${c.id}`, value: c.id, checked: off.sounds === c.id,
          onchange: () => { off.sounds = c.id; estP.textContent = est(); } }),
        el("span", {}, c.label), el("span", { class: "opt-note" }, c.note))));
    fill(box, 
      el("p", { class: "off-title" }, deck ? "Update the saved trip" : `Save these ${list.length} birds for offline use`),
      opts, estP,
      el("div", { class: "row" }, btn("Cancel", "ghost", () => { off.mode = "idle"; renderOffline(); }), btn("Download", "primary", startDownload)),
    );
    return;
  }
  if (mode === "confirmRemove") {
    fill(box, 
      el("p", { class: "off-title" }, `Remove the offline copy of ${state.place.name}?`),
      el("p", { class: "off-note" }, "Your learning progress is kept. You can save the trip again later."),
      el("div", { class: "row" }, btn("Keep it", "ghost", () => { off.mode = "idle"; renderOffline(); }), btn("Remove", "primary", async () => {
        await removeDeck(id);
        Object.assign(off, { mode: "idle", id, note: "Offline copy removed.", error: false });
        renderOffline();
      })),
    );
    return;
  }
  // idle
  if (deck) {
    const parts = [
      el("p", { class: "off-title saved" }, "✓ Saved for offline use"),
      el("p", { class: "off-note" }, `${deck.birds} birds · ${monthName(deck.month ?? 0)} · ${formatBytes(deck.bytes)} · saved ${fmtDay(deck.savedAt)}${deck.soundsPerBird ? "" : " · no sounds"}`),
    ];
    if ((deck.month ?? 0) !== state.month) parts.push(el("p", { class: "off-note" }, `Saved for ${monthName(deck.month ?? 0)}; you're viewing ${monthName(state.month)}. Update to save this month instead.`));
    if (deck.missing?.length) parts.push(el("p", { class: "off-note" }, `No photos saved for: ${deck.missing.join(", ")}.`));
    else if (list.length !== deck.birds) parts.push(el("p", { class: "off-note" }, `You're viewing ${list.length} birds. Update to save these instead.`));
    if (note) parts.push(note);
    parts.push(el("div", { class: "row" },
      btn("Update", "ghost", () => { Object.assign(off, { mode: "choose", id, sounds: deck.soundsPerBird ?? 1, note: "" }); renderOffline(); }, { disabled: !navigator.onLine }),
      btn("Remove", "ghost", () => { Object.assign(off, { mode: "confirmRemove", id, note: "" }); renderOffline(); })));
    fill(box, ...parts);
    return;
  }
  box.classList.add("bare");
  fill(box, 
    btn(navigator.onLine ? "Save for offline use" : "Connect to the internet to save this trip", "ghost wide",
      () => { Object.assign(off, { mode: "choose", id, note: "", error: false }); renderOffline(); }, { disabled: !navigator.onLine }),
    ...(note ? [note] : []),
  );
}

async function startDownload() {
  const place = state.place, data = state.data, species = visible(), id = deckId(place), month = state.month;
  Object.assign(off, { mode: "downloading", id, done: 0, total: species.length, bytes: 0, controller: new AbortController(), note: "", error: false });
  renderOffline();
  try {
    const meta = await downloadDeck({
      place, month, data, species, top: state.top, soundsPerBird: off.sounds, signal: off.controller.signal,
      photoWhere: photoContextFor(place, month, data),
      onProgress: (done, total, bytes) => { Object.assign(off, { done, total, bytes }); if (state.place && deckId(state.place) === id) renderOffline(); },
    });
    Object.assign(off, { mode: "idle", note: meta.missing.length ? "" : "Ready. This trip now works with no signal.", error: false });
  } catch (e) {
    const cancelled = e?.name === "AbortError";
    Object.assign(off, { mode: "idle", note: cancelled ? "Download cancelled. Nothing was saved." : `Couldn't save this trip: ${e.message}`, error: !cancelled });
  }
  off.controller = null;
  renderRecent();
  if (state.place && deckId(state.place) === id) renderOffline();
}

function yearsOf(sample) {
  const ys = [sample.from, sample.to].filter(Boolean).map((d) => d.slice(0, 4));
  return [...new Set(ys)].sort().reverse().join(" and ") || "past years";
}

function fmtDate(d) {
  const dt = new Date(d.replace(" ", "T"));
  return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------- wiring ----------
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#q").value.trim();
  if (q.length >= 2) searchPlaces(q);
});
$("#back").addEventListener("click", () => { show("search"); renderRecent(); });
function startStudy(mode) {
  show("study");
  startSession({
    deck: visible(), all: state.data.species, placeName: state.place.name, month: state.month,
    photoWhere: photoContextFor(state.place, state.month, state.data), mode,
    onExit: () => { show("list"); renderSpecies(); },
  });
}
$("#study-start").addEventListener("click", () => startStudy("photo"));
$("#sound-start").addEventListener("click", () => startStudy("sound"));
$("#month").addEventListener("change", () => {
  setMonth(Number($("#month").value));
  save(MONTH_KEY, state.month);
  if (state.place) loadSpecies();
});
document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
  setTop(Number(b.dataset.top));
  renderSpecies();
}));

function updateNet() { $("#net").hidden = navigator.onLine; if (!$("#view-list").hidden) renderOffline(); }
addEventListener("online", updateNet);
addEventListener("offline", updateNet);
updateNet();
renderRecent();

if ("serviceWorker" in navigator) {
  // When a new version's worker takes over, reload once so its files are used.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").then((r) => r.update()).catch(() => { /* non-fatal */ }));
}
