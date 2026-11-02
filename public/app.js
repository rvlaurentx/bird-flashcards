// Bird Flashcards — place search → ranked species list → flashcards.

import { $, api, load, save } from "./lib.js";
import { LEARNED_BOX } from "./learn.js";
import { startSession, getProgress } from "./study.js";

const RECENT_KEY = "bf-recent-places";
const state = { place: null, data: null, top: 25 };

// ---------- storage (per-device conveniences only) ----------
const getRecent = () => load(RECENT_KEY, []);
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
  const recent = getRecent();
  $("#recent-block").hidden = !recent.length;
  $("#recent").replaceChildren(...recent.map((p) => placeButton(p, openPlace)));
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

async function openPlace(p) {
  state.place = p; state.data = null;
  addRecent(p);
  show("list");
  $("#list-title").textContent = p.name;
  $("#list-meta").textContent = p.detail || "";
  $("#species").replaceChildren();
  $("#list-count").textContent = "";
  $("#study-start").hidden = true;
  const msg = $("#list-msg");
  msg.className = "msg"; msg.textContent = "Reading recent eBird checklists… this can take a few seconds.";
  try {
    // Round coordinates so nearby searches share one cached response.
    const data = await api(`/api/species?lat=${p.lat.toFixed(2)}&lng=${p.lng.toFixed(2)}`);
    state.data = data;
    msg.textContent = "";
    const s = data.sample;
    const range = s.from && s.to ? ` from ${fmtDate(s.from)} to ${fmtDate(s.to)}` : "";
    $("#list-meta").textContent = `${data.region.name} · ${s.checklists} recent ${s.completeOnly ? "complete " : ""}checklists${range}`;
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
$("#study-start").addEventListener("click", () => {
  show("study");
  startSession({
    deck: visible(), all: state.data.species, placeName: state.place.name,
    onExit: () => { show("list"); renderSpecies(); },
  });
});
document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
  state.top = Number(b.dataset.top);
  document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderSpecies();
}));

function updateNet() { $("#net").hidden = navigator.onLine; }
addEventListener("online", updateNet);
addEventListener("offline", updateNet);
updateNet();
renderRecent();

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { /* non-fatal */ }));
}
