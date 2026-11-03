/**
 * Probe: what does a FamilySearch image group's coverage place look like, and
 * does `imageGroupPlace` read it? Evidence for image-transcribe-tool-spec.md
 * §5.5.1 (the record country of an image record, lead 2026-10-29).
 *
 *   npx tsx dev/probe-image-group-place.ts <inputs.json>
 *
 * `inputs.json` is `{ "films": [...], "arks": [...] }`: the film of every
 * imageId, and every `ark`/`imageArk`, that an `image_transcribe` call in
 * `eval/runlogs/e2e/<slug>/run-*.json` was given.
 *
 * For each film it reads `group-service/group/{film}/apid` and the group's
 * metadata, and names each coverage's top-level place
 * (`placeRepIdHierarchy[0]`, resolved by id) to say which end of the place
 * string is the country. For each ARK it asks the resolver for the image's name.
 * Then `imageGroupPlace` runs on every input and must agree with the parts.
 *
 * Result (2026-10-29, the corpus at 1d9f43c05): 58 films from imageIds and 86
 * more reached from ARKs, 144 groups. 142 answered, 2 refused (403); every one
 * that answered had a coverage place. The top-level place was the LAST segment
 * of the place in all 147 (group, top-level) pairs, never the first ("San
 * Lorenzo, Grant, New Mexico, United States"). 25 groups list more than one
 * coverage place; 3 of them end in different countries (Austria and Hungary;
 * Slovakia, Hungary and Czechoslovakia, twice). Of 117 image ARKs, 102 named
 * their image, 11 were refused (403) and 4 answered 400. `imageGroupPlace`
 * agreed with the parts on every input: a place for 55 of 58 films and 98 of
 * 137 ARK inputs (the 20 that are no image ARK, such as record ARKs, ask
 * nothing).
 */
import { readFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { arkToUrl, findDocumentImageArk, toArk, UNPREFIXED_IMAGE_ID_RE } from "../src/utils/ark.js";
import { fsFetch } from "../src/utils/fs-fetch.js";
import {
  fetchGroupMetadata,
  imageGroupPlace,
  resolveGroupId,
  sharedCoveragePlace,
} from "../src/utils/image-group.js";
import { placeSegments, repIdToStandardPlace } from "../src/utils/place-resolver.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx dev/probe-image-group-place.ts <inputs.json>");
  process.exit(2);
}
const { films, arks } = JSON.parse(readFileSync(file, "utf-8")) as { films: string[]; arks: string[] };
const T = { timeoutMs: 20_000, budgetMs: 20_000 };

interface Group {
  status?: number;
  places: string[];
  tops: number[];
  shared: string | null;
}
const groups = new Map<string, Group>();
async function group(film: string): Promise<Group> {
  const known = groups.get(film);
  if (known) return known;
  const g: Group = { places: [], tops: [], shared: null };
  try {
    const { status, meta } = await fetchGroupMetadata(await resolveGroupId(film, LOCAL, T), LOCAL, T);
    g.status = status;
    for (const c of (meta?.coverages ?? []) as { place?: unknown; placeRepIdHierarchy?: unknown }[]) {
      if (typeof c.place === "string") g.places.push(c.place);
      if (Array.isArray(c.placeRepIdHierarchy) && typeof c.placeRepIdHierarchy[0] === "number") {
        g.tops.push(c.placeRepIdHierarchy[0]);
      }
    }
    g.shared = meta ? sharedCoveragePlace(meta) : null;
  } catch (e) {
    console.log(`  ${film}: ${(e as Error).message}`);
  }
  groups.set(film, g);
  return g;
}

for (const film of films) await group(film);
const arkStatus: Record<string, number> = {};
const arkFilm = new Map<string, string | null>();
for (const raw of arks) {
  const t = raw.trim();
  const ark = UNPREFIXED_IMAGE_ID_RE.test(t) ? `ark:/61903/3:1:${t}` : findDocumentImageArk(toArk(t));
  if (!ark) continue;
  const r = await fsFetch(LOCAL, arkToUrl(ark), { headers: { Accept: "application/json", "User-Agent": BROWSER_USER_AGENT } });
  arkStatus[r.status] = (arkStatus[r.status] ?? 0) + 1;
  const name = r.ok ? ((await r.json().catch(() => null)) as { name?: unknown } | null)?.name : undefined;
  const film = typeof name === "string" && /^\d+(_\d+)?$/.test(name) ? name.split("_")[0] : null;
  arkFilm.set(raw, film);
  if (film) await group(film);
}

let last = 0;
let first = 0;
let neither = 0;
const topName = new Map<number, string | null>();
for (const g of groups.values()) {
  for (const top of new Set(g.tops)) {
    if (!topName.has(top)) topName.set(top, await repIdToStandardPlace(String(top)));
    const name = topName.get(top);
    if (!name) continue;
    if (g.places.some((p) => placeSegments(p).at(-1) === name)) last++;
    else if (g.places.some((p) => placeSegments(p)[0] === name)) first++;
    else neither++;
  }
}
const read = [...groups.values()].filter((g) => g.status === 200);
const lastOf = (g: Group) => new Set(g.places.map((p) => placeSegments(p).at(-1)));
console.log(`groups ${groups.size}, answered ${read.length}, with a coverage place ${read.filter((g) => g.places.length).length}`);
console.log(`top-level place: last segment ${last}, first ${first}, neither ${neither}`);
console.log(`several coverage places ${read.filter((g) => new Set(g.places).size > 1).length}, ` +
  `ending in different countries ${read.filter((g) => lastOf(g).size > 1).length}`);
console.log(`image ARKs by status ${JSON.stringify(arkStatus)}`);

let disagree = 0;
let filmsWithPlace = 0;
let arksWithPlace = 0;
for (const film of films) {
  const got = await imageGroupPlace({ imageId: `${film}_00001` }, LOCAL);
  if (got !== (groups.get(film)?.shared ?? null)) disagree++;
  if (got) filmsWithPlace++;
}
for (const raw of arks) {
  const got = await imageGroupPlace({ ark: raw }, LOCAL);
  const film = arkFilm.get(raw);
  if (got !== (film ? (groups.get(film)?.shared ?? null) : null)) disagree++;
  if (got) arksWithPlace++;
}
console.log(`imageGroupPlace: a place for ${filmsWithPlace}/${films.length} films and ${arksWithPlace}/${arks.length} ARK inputs; ` +
  `disagrees with the parts on ${disagree}`);
