import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { attachIndexReadings, indexReadingsForPage, READING_NOTE } from "../../src/utils/index-readings.js";

const ARK = "ark:/61903/3:1:S3HT-DTXQ-WTP";
const RESEARCH = {
  sources: [
    { id: "src_001", image_ark: ARK },
    { id: "src_002", image_ark: "ark:/61903/3:1:OTHER-PAGE" },
    { id: "src_003" },
  ],
  assertions: [
    { id: "a_001", source_id: "src_001", record_id: "r1", record_role: "head_of_household", fact_type: "name", value: "Tyler" },
    { id: "a_002", source_id: "src_001", record_id: "r1", record_role: "daughter", fact_type: "name", value: "Dora Lightfoot" },
    { id: "a_003", source_id: "src_001", record_id: "r1", record_role: "head_of_household", fact_type: "sex", value: "Female" },
    { id: "a_004", source_id: "src_001", record_id: "r1", record_role: "head_of_household", fact_type: "name", value: "Old", superseded_by: "a_001" },
    { id: "a_005", source_id: "src_002", record_id: "r2", record_role: "head", fact_type: "name", value: "Elsewhere" },
    { id: "a_006", source_id: "src_003", record_id: "r3", record_role: "deceased", fact_type: "name", value: "Ann Tone Lightfoot" },
  ],
};

describe("indexReadingsForPage (#4578)", () => {
  it("gives the live indexed names of the held records on that page only", () => {
    expect(indexReadingsForPage(RESEARCH, ARK)).toEqual([
      { sourceId: "src_001", recordId: "r1", role: "head_of_household", name: "Tyler" },
      { sourceId: "src_001", recordId: "r1", role: "daughter", name: "Dora Lightfoot" },
    ]);
  });

  it("matches the page through a cc= query on either side", () => {
    expect(indexReadingsForPage(RESEARCH, `${ARK}?cc=1325221`)).toHaveLength(2);
    const stored = { ...RESEARCH, sources: [{ id: "src_001", image_ark: `${ARK}?cc=1325221` }] };
    expect(indexReadingsForPage(stored, ARK)).toHaveLength(2);
  });

  it("gives nothing for an ARK whose i= picks one of several images, or an unheld page", () => {
    expect(indexReadingsForPage(RESEARCH, `${ARK}?i=4`)).toEqual([]);
    expect(indexReadingsForPage(RESEARCH, "ark:/61903/3:1:NOT-HELD")).toEqual([]);
    expect(indexReadingsForPage({}, ARK)).toEqual([]);
  });
});

describe("attachIndexReadings (#4578)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });
  async function project(research: unknown): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "idxread-"));
    dirs.push(d);
    await writeFile(join(d, "research.json"), JSON.stringify(research));
    await writeFile(join(d, "tree.gedcomx.json"), "{}");
    return d;
  }

  it("adds the note and the readings", async () => {
    const out = await attachIndexReadings(await project(RESEARCH), {}, ARK);
    expect(out.readingNote).toBe(READING_NOTE);
    expect(out.indexReadings?.map((r) => r.name)).toEqual(["Tyler", "Dora Lightfoot"]);
  });

  it("adds the note alone for a file read, or an unreadable project", async () => {
    const dir = await project(RESEARCH);
    expect(await attachIndexReadings(dir, {}, undefined)).toEqual({ readingNote: READING_NOTE });
    await writeFile(join(dir, "research.json"), "{ not json");
    expect(await attachIndexReadings(dir, {}, ARK)).toEqual({ readingNote: READING_NOTE });
    const empty = await mkdtemp(join(tmpdir(), "idxread-none-"));
    dirs.push(empty);
    expect(await attachIndexReadings(empty, {}, ARK)).toEqual({ readingNote: READING_NOTE });
  });

  it("says what the issue's bundle broke, in the note", () => {
    for (const rule of [/one machine reading/, /never say the image or page shows, reads or is clear/,
      /never call its text the name as written/,
      /side by side/, /name the line/, /never call the index wrong or a misread/,
      /second transcription of the same page/, /never call it a rendering, variant or split/,
      /never state a correction/, /after declining to read it/, /only a different record/,
      /never call a disagreeing spelling consistent/, /never drop a reading on a premise/]) {
      expect(READING_NOTE).toMatch(rule);
    }
  });
});
