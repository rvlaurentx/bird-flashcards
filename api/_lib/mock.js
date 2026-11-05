// Sample data used when EBIRD_MOCK=1, so the app runs without a key or network.
// Shapes mirror the eBird API 2.0 responses that api/species.js reads.
// The numbers are invented; they are not real eBird frequencies.

const SPECIES = [
  // code, common name, scientific name, family, familyCode, taxonOrder, rough frequency
  ["norcar", "Northern Cardinal", "Cardinalis cardinalis", "Cardinals, Grosbeaks, and Allies", "cardin1", 32000, 0.82],
  ["amerob", "American Robin", "Turdus migratorius", "Thrushes and Allies", "turdid1", 26000, 0.74],
  ["blujay", "Blue Jay", "Cyanocitta cristata", "Crows, Jays, and Magpies", "corvid1", 20000, 0.66],
  ["carwre", "Carolina Wren", "Thryothorus ludovicianus", "Wrens", "troglo1", 25000, 0.61],
  ["moudov", "Mourning Dove", "Zenaida macroura", "Pigeons and Doves", "columb1", 9000, 0.6],
  ["amecro", "American Crow", "Corvus brachyrhynchos", "Crows, Jays, and Magpies", "corvid1", 20100, 0.57],
  ["dowwoo", "Downy Woodpecker", "Dryobates pubescens", "Woodpeckers", "picida1", 17000, 0.52],
  ["haiwoo", "Hairy Woodpecker", "Dryobates villosus", "Woodpeckers", "picida1", 17010, 0.18],
  ["rebwoo", "Red-bellied Woodpecker", "Melanerpes carolinus", "Woodpeckers", "picida1", 16900, 0.5],
  ["tuftit", "Tufted Titmouse", "Baeolophus bicolor", "Tits, Chickadees, and Titmice", "parida1", 22000, 0.49],
  ["carchi", "Carolina Chickadee", "Poecile carolinensis", "Tits, Chickadees, and Titmice", "parida1", 21900, 0.47],
  ["eursta", "European Starling", "Sturnus vulgaris", "Starlings and Mynas", "sturni1", 25900, 0.45],
  ["sonspa", "Song Sparrow", "Melospiza melodia", "New World Sparrows", "passer3", 30000, 0.44],
  ["houfin", "House Finch", "Haemorhous mexicanus", "Finches, Euphonias, and Allies", "fringi1", 28000, 0.4],
  ["purfin", "Purple Finch", "Haemorhous purpureus", "Finches, Euphonias, and Allies", "fringi1", 28010, 0.07],
  ["amegfi", "American Goldfinch", "Spinus tristis", "Finches, Euphonias, and Allies", "fringi1", 28100, 0.38],
  ["comgra", "Common Grackle", "Quiscalus quiscula", "Troupials and Allies", "icteri1", 31000, 0.35],
  ["rewbla", "Red-winged Blackbird", "Agelaius phoeniceus", "Troupials and Allies", "icteri1", 30900, 0.34],
  ["wbnuth", "White-breasted Nuthatch", "Sitta carolinensis", "Nuthatches", "sittid1", 24000, 0.31],
  ["norfli", "Northern Flicker", "Colaptes auratus", "Woodpeckers", "picida1", 17200, 0.28],
  ["grbher3", "Great Blue Heron", "Ardea herodias", "Herons, Egrets, and Bitterns", "ardeid1", 8000, 0.26],
  ["turvul", "Turkey Vulture", "Cathartes aura", "New World Vultures", "cathar1", 8500, 0.25],
  ["rethaw", "Red-tailed Hawk", "Buteo jamaicensis", "Hawks, Eagles, and Kites", "accipi1", 8700, 0.22],
  ["easblu", "Eastern Bluebird", "Sialia sialis", "Thrushes and Allies", "turdid1", 25990, 0.21],
  ["cangoo", "Canada Goose", "Branta canadensis", "Ducks, Geese, and Waterfowl", "anatid1", 300, 0.2],
  ["mallar3", "Mallard", "Anas platyrhynchos", "Ducks, Geese, and Waterfowl", "anatid1", 600, 0.19],
  ["daejun", "Dark-eyed Junco", "Junco hyemalis", "New World Sparrows", "passer3", 29900, 0.17],
  ["whtspa", "White-throated Sparrow", "Zonotrichia albicollis", "New World Sparrows", "passer3", 29950, 0.15],
  ["cedwax", "Cedar Waxwing", "Bombycilla cedrorum", "Waxwings", "bombyc1", 23000, 0.12],
  ["coohaw", "Cooper's Hawk", "Astur cooperii", "Hawks, Eagles, and Kites", "accipi1", 8600, 0.1],
  ["shshaw", "Sharp-shinned Hawk", "Accipiter striatus", "Hawks, Eagles, and Kites", "accipi1", 8590, 0.05],
  ["belkin1", "Belted Kingfisher", "Megaceryle alcyon", "Kingfishers", "alcedi1", 15000, 0.08],
];
// Non-species taxa, to exercise the filtering/roll-up logic.
const EXTRA = [
  { speciesCode: "woodpe1", comName: "woodpecker sp.", sciName: "Picidae sp.", category: "spuh", taxonOrder: 17500 },
  { speciesCode: "yshfli", comName: "Northern Flicker (Yellow-shafted)", sciName: "Colaptes auratus auratus/luteus", category: "issf", reportAs: "norfli", taxonOrder: 17201 },
];

function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

const TAX = Object.fromEntries([
  ...SPECIES.map(([speciesCode, comName, sciName, familyComName, familyCode, taxonOrder]) =>
    [speciesCode, { speciesCode, comName, sciName, familyComName, familyCode, taxonOrder, category: "species" }]),
  ...EXTRA.map((t) => [t.speciesCode, t]),
]);

// Rough seasonality so month views differ in mock mode: winter visitors are
// absent in summer, and blackbirds/kingfishers are scarce in deep winter.
const WINTER_ONLY = new Set(["daejun", "whtspa", "purfin"]);
const SUMMER_ONLY = new Set(["rewbla", "belkin1", "turvul"]);
function seasonal(code, month) {
  if (!month) return 1;
  if (WINTER_ONLY.has(code)) return [11, 12, 1, 2, 3, 4].includes(month) ? 2.2 : 0;
  if (SUMMER_ONLY.has(code)) return [12, 1, 2].includes(month) ? 0.1 : 1.6;
  return 1;
}

// Checklist number n encodes its month (n = month*1000 + ...; 0 = recent feed).
function checklist(n) {
  const r = rand(n * 7919 + 1);
  const month = Math.floor(n / 1000);
  const obs = SPECIES.filter((s) => r() < Math.min(0.97, s[6] * seasonal(s[0], month))).map((s) => ({ speciesCode: s[0], howManyStr: String(1 + Math.floor(r() * 6)) }));
  if (r() < 0.15) obs.push({ speciesCode: "woodpe1", howManyStr: "1" });
  if (r() < 0.2) obs.push({ speciesCode: "yshfli", howManyStr: "1" });
  const day = String(1 + (n % 28)).padStart(2, "0");
  const mm = String(month || 10).padStart(2, "0");
  const year = month ? (n % 1000 >= 500 ? 2024 : 2025) : 2026;
  return { subId: `S${100000 + n}`, allObsReported: n % 9 !== 0, obsDt: `${year}-${mm}-${day} 07:30`, numSpecies: obs.length, obs };
}

export async function mockEbird(path) {
  const [route, qs = ""] = path.split("?");
  const q = new URLSearchParams(qs);
  if (route === "/ref/hotspot/geo") {
    const lat = Number(q.get("lat")), lng = Number(q.get("lng"));
    return Array.from({ length: 12 }, (_, i) => ({
      locId: `L${9000 + i}`, locName: `Sample Hotspot ${i + 1}`, countryCode: "US", subnational1Code: "US-XX", subnational2Code: "US-XX-001",
      lat: lat + (i - 6) * 0.01, lng: lng + (i % 4) * 0.01, numSpeciesAllTime: 120 + i * 7,
    }));
  }
  const dated = route.match(/^\/product\/lists\/[^/]+\/(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (dated) {
    const [, y, m, d] = dated.map(Number);
    // n = month*1000 + (older year ? 500 : 0) + day*10 + i
    return Array.from({ length: 6 }, (_, i) => {
      const n = m * 1000 + (y % 2 === 0 ? 500 : 0) + d * 10 + i;
      return { subId: `S${100000 + n}`, numSpecies: checklist(n).numSpecies, obsDt: `${y}-${m}-${d}` };
    });
  }
  if (route.startsWith("/product/lists/")) return Array.from({ length: 60 }, (_, i) => ({ subId: `S${100000 + i}`, numSpecies: checklist(i).numSpecies, obsDt: "2026-10-01" }));
  if (route.startsWith("/product/checklist/view/")) return checklist(Number(route.split("/").pop().slice(1)) - 100000);
  if (route === "/ref/taxonomy/ebird") return (q.get("species") || "").split(",").map((c) => TAX[c]).filter(Boolean);
  if (route.startsWith("/ref/region/info/")) return { result: "Sample County (demo data)" };
  throw new Error(`mock: no route for ${path}`);
}

export async function mockGeocode(q) {
  const base = [
    { name: "Cape May", detail: "Cape May County, New Jersey, United States", lat: 38.935, lng: -74.906 },
    { name: "Cape May Point", detail: "Cape May County, New Jersey, United States", lat: 38.937, lng: -74.965 },
    { name: "Springfield", detail: "Sangamon County, Illinois, United States", lat: 39.8, lng: -89.644 },
    { name: "Springfield", detail: "Hampden County, Massachusetts, United States", lat: 42.101, lng: -72.59 },
    { name: "Asheville", detail: "Buncombe County, North Carolina, United States", lat: 35.595, lng: -82.551 },
  ];
  const hits = base.filter((p) => p.name.toLowerCase().startsWith(q.toLowerCase()));
  return hits.length ? hits : [{ name: q, detail: "Demo place (mock mode)", lat: 40.0, lng: -75.0 }];
}

// Placeholder "photo" (inline SVG) so the study screen can be tried offline.
export function mockMedia(sci, name, where = {}) {
  const hue = [...(sci || name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const photo = (n, light) => ({
    url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 375"><rect width="500" height="375" fill="hsl(${hue} 35% ${light}%)"/><text x="250" y="200" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">Sample photo ${n} (mock mode)</text></svg>`),
    attribution: `(c) Sample photographer ${n}, some rights reserved (CC BY)`, license: "CC-BY", page: null,
  });
  return {
    taxonId: null, inatUrl: null,
    photos: [photo(1, 55), photo(2, 40)].map((p, i) => (Number.isFinite(where.lat) && i === 0
      ? { ...p, local: true, context: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][((where.month || 10) - 1)]} 2025 · Sample place near the trip` }
      : p)),
    summary: `${name || sci} is a sample species shown in mock mode. With real data this paragraph comes from Wikipedia via iNaturalist.`,
    wikipediaUrl: null,
  };
}

// A short generated tone (WAV) per species, so audio UI can be tried offline.
function toneBuffer(freq) {
  const rate = 8000, n = rate * 0.6, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000 * Math.min(1, (n - i) / 800)), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const toneWav = (freq) => "data:audio/wav;base64," + toneBuffer(freq).toString("base64");

// Bytes for /api/audio in mock mode (id 1 = song tone, 2 = call tone).
export function mockAudio(id) { return toneBuffer(Number(id) === 2 ? 1300 : 900); }

export function mockSounds(sci, name) {
  const f = 600 + ([...(sci || name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 1200);
  const rec = (kind, n, freq) => ({
    id: `XC00000${n}`, kind, type: kind, url: toneWav(freq), recordist: `Sample recordist ${n}`,
    license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    page: "https://xeno-canto.org", length: "0:01", country: "United States", quality: "A",
  });
  return { recordings: [rec("song", 1, f), rec("call", 2, f * 1.5)] };
}

// Sample size / field-mark / habitat hints for mock mode.
export function mockHints(sci, name) {
  const n = [...(sci || name)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const cm = 12 + (n % 30);
  return {
    available: true,
    size: `${cm}–${cm + 2} cm (about ${((cm + 1) / 2.54).toFixed(1)} in), sample size comparison`,
    fieldMarks: ["Sample field mark one (mock mode)", "Sample field mark two", "Sample field mark three"],
    habitat: "Sample habitat: woodland edges and gardens (mock mode).",
    source: { title: name || sci, url: "https://en.wikipedia.org", license: "CC BY-SA 4.0" },
  };
}
