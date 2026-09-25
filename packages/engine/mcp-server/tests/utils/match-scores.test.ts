import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  SCORES_SUBDIR,
  findRecordedScore,
  readMatchScores,
  recordMatchScore,
  scoreKey,
  scoresRef,
  type RecordedMatchScore,
} from "../../src/utils/match-scores.js";

/**
 * The `same_person` attestation (issue #1731 step 2).
 *
 * What these pin is the part a future gate depends on: that a score can be
 * found again from the tokens a `person_evidence` entry actually carries, and
 * that two personas of one record do not collapse into one record (ADR-0009
 * constraint 3).
 */

const ARK = "ark:/61903/1:1:MARR-8T3";
const URL_FORM = "https://www.familysearch.org/ark:/61903/1:1:MARR-8T3";

function score(over: Partial<RecordedMatchScore> = {}): RecordedMatchScore {
  return {
    record_id: ARK,
    record_persona_id: null,
    record_role: "principal",
    tree_person_id: "I1",
    score: 0.87,
    confidence: 5,
    matched: true,
    assertion_id: "a_005",
    record_source: "record_read",
    computed: "2026-09-21T00:00:00.000Z",
    ...over,
  };
}

describe("match-scores", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "match-scores-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a score and finds it by role", async () => {
    await recordMatchScore(dir, score());
    const file = await readMatchScores(dir, ARK);
    expect(file?.record_id).toBe(ARK);
    expect(findRecordedScore(file, "a_005", "I1")?.score).toBe(0.87);
  });

  it("lands under results/.scores/, invisible to the orphan check", async () => {
    // The validator lists results/ NON-recursively and errors on any top-level
    // *.json no log entry references. A dot-directory is how .staging already
    // stays out of that walk.
    await recordMatchScore(dir, score());
    expect(scoresRef(ARK).startsWith(`${SCORES_SUBDIR}/`)).toBe(true);
    const topLevel = await readdir(join(dir, "results"));
    expect(topLevel.filter((n) => n.endsWith(".json"))).toEqual([]);
    expect(topLevel).toContain(".scores");
  });

  it("keeps DIFFERENT ARK type-spaces in different files", async () => {
    // 1:1: is a record persona, 1:2: its source, 3:1: an image. record-read.ts
    // documents them as different entities that share an id tail (#2061).
    // Collapsing the type segment filed their scores together, so an
    // attestation for one answered a lookup for another. The corpus carries
    // 542 `3:1:` and 65 `1:2:` record ids alongside 9,945 `1:1:`.
    const persona = "ark:/61903/1:1:ABCD-123";
    expect(scoresRef(persona)).not.toBe(scoresRef("ark:/61903/1:2:ABCD-123"));
    expect(scoresRef(persona)).not.toBe(scoresRef("ark:/61903/3:1:ABCD-123"));

    await recordMatchScore(dir, score({ record_id: persona }));
    await recordMatchScore(dir, score({ record_id: "ark:/61903/1:2:ABCD-123", score: 0.1 }));
    expect(findRecordedScore(await readMatchScores(dir, persona), "a_005", "I1")?.score).toBe(0.87);
    expect(
      findRecordedScore(await readMatchScores(dir, "ark:/61903/1:2:ABCD-123"), "a_005", "I1")?.score,
    ).toBe(0.1);
  });

  it("normalises the record id, so the URL and bare forms are one file", async () => {
    // 561 corpus assertions store record_id as a resolver URL and 9,993 as a
    // bare ark:. Two files for one record would mean a score written by one
    // call is unfindable by the next.
    expect(scoresRef(URL_FORM)).toBe(scoresRef(ARK));
    await recordMatchScore(dir, score({ record_id: URL_FORM }));
    expect(await readMatchScores(dir, ARK)).not.toBeNull();
  });

  it("keeps two personas of ONE record apart — ADR-0009 constraint 3", async () => {
    // Both against the SAME tree person, deliberately. With different tree
    // persons the pairings stay apart under any key, so that version of this
    // test passes a break-test that collapses the discriminator out — which is
    // the exact failure constraint 3 names: "a record-level exemption lets a
    // second persona of an already-linked record attach unscored."
    //
    // The discriminator is now the ASSERTION, because an assertion carries one
    // `record_role` and one `record_persona_id` and so IS a (record, party)
    // pair. Two personas of one record are two assertions.
    await recordMatchScore(dir, score({ assertion_id: "a_005", record_role: "principal" }));
    await recordMatchScore(
      dir,
      score({ assertion_id: "a_006", record_role: "wife", score: 0.4 }),
    );
    const file = await readMatchScores(dir, ARK);
    expect(Object.keys(file!.scores).sort()).toEqual(
      [scoreKey("a_005", "I1"), scoreKey("a_006", "I1")].sort(),
    );
    expect(findRecordedScore(file, "a_005", "I1")?.score).toBe(0.87);
    expect(findRecordedScore(file, "a_006", "I1")?.score).toBe(0.4);
  });

  it("keeps two tree persons scored against ONE persona apart", async () => {
    await recordMatchScore(dir, score({ tree_person_id: "I1" }));
    await recordMatchScore(dir, score({ tree_person_id: "I2", score: 0.4 }));
    const file = await readMatchScores(dir, ARK);
    expect(Object.keys(file!.scores)).toHaveLength(2);
    expect(findRecordedScore(file, "a_005", "I2")?.score).toBe(0.4);
  });

  it("keys on the assertion whatever party the call resolved", async () => {
    // The party is NOT stable across routes: the fetched route resolves a real
    // persons[].id where the assertion carries null. Keying on it filed the
    // score under what was resolved while every reader computes the key from
    // the assertion, so a legitimate score became unfindable and the gate
    // refused the links whose call HAD been made.
    await recordMatchScore(dir, score({ record_persona_id: "PERSON1", record_role: "principal" }));
    const file = await readMatchScores(dir, ARK);
    expect(Object.keys(file!.scores)).toEqual([scoreKey("a_005", "I1")]);
    expect(findRecordedScore(file, "a_005", "I1")?.score).toBe(0.87);
  });

  it("is NOT findable by tree person alone", async () => {
    // The old reader had a tree-person-only fallback. It returned ANY entry for
    // that person, which is ADR-0009 constraint 3 verbatim — a second persona of
    // an already-linked record riding the first one's score. Removed with the
    // re-key, and pinned here so it cannot come back as a convenience.
    await recordMatchScore(dir, score({ assertion_id: "a_005" }));
    const file = await readMatchScores(dir, ARK);
    expect(findRecordedScore(file, "a_999", "I1")).toBeNull();
    expect(findRecordedScore(file, null, "I1")).toBeNull();
    expect(findRecordedScore(file, "a_005", "I-nope")).toBeNull();
  });

  it("a later score for the same pairing replaces the earlier one", async () => {
    await recordMatchScore(dir, score({ score: 0.1 }));
    await recordMatchScore(dir, score({ score: 0.9 }));
    const file = await readMatchScores(dir, ARK);
    expect(Object.keys(file!.scores)).toHaveLength(1);
    expect(findRecordedScore(file, "a_005", "I1")?.score).toBe(0.9);
  });

  it("writes nothing when no assertion identifies the score", async () => {
    // The explicit two-document arm has no assertion, so nothing could ever look
    // it up: a file would be dead weight rather than an attestation.
    await recordMatchScore(dir, score({ assertion_id: null }));
    expect(await readMatchScores(dir, ARK)).toBeNull();
  });

  it("reads an absent or corrupt file as 'no attestation', never throwing", async () => {
    expect(await readMatchScores(dir, ARK)).toBeNull();
    expect(findRecordedScore(null, "a_005", "I1")).toBeNull();
  });

  it("treats a `scores: null` file as no attestation rather than throwing", async () => {
    // `typeof null === "object"`, so a bare typeof check passes this through
    // and `Object.values(null)` then throws inside findRecordedScore. The file
    // is on disk and can be corrupt or hand-edited, and an unusable one must
    // read as "no attestation" — this function's stated contract.
    await recordMatchScore(dir, score());
    await writeFile(join(dir, scoresRef(ARK)), JSON.stringify({ record_id: ARK, scores: null }), "utf8");
    expect(await readMatchScores(dir, ARK)).toBeNull();
  });

  it("findRecordedScore survives a hand-built file with a bad scores field", () => {
    for (const bad of [{ scores: null }, { scores: [] }, { scores: "x" }] as any[]) {
      expect(() => findRecordedScore(bad, "a_005", "I1")).not.toThrow();
      expect(findRecordedScore(bad, "a_005", "I1")).toBeNull();
    }
  });
});
