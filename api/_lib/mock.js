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

function checklist(n) {
  const r = rand(n * 7919 + 1);
  const obs = SPECIES.filter((s) => r() < s[6]).map((s) => ({ speciesCode: s[0], howManyStr: String(1 + Math.floor(r() * 6)) }));
  if (r() < 0.15) obs.push({ speciesCode: "woodpe1", howManyStr: "1" });
  if (r() < 0.2) obs.push({ speciesCode: "yshfli", howManyStr: "1" });
  const day = String(1 + (n % 28)).padStart(2, "0");
  return { subId: `S${100000 + n}`, allObsReported: n % 9 !== 0, obsDt: `2026-10-${day} 07:30`, numSpecies: obs.length, obs };
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
  if (route.startsWith("/product/lists/")) return Array.from({ length: 60 }, (_, i) => ({ subId: `S${100000 + i}`, numSpecies: 12, obsDt: "2026-10-01" }));
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
