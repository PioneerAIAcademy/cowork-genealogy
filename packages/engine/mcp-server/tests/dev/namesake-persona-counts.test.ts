import { describe, it, expect } from "vitest";
import { personaStampCounts } from "../../dev/namesake-persona-counts.js";

const HOUSE = "ark:/61903/1:1:HSE1-001";
const OTHER = "ark:/61903/1:1:OTH2-002";
const LOST = "ark:/61903/1:1:LST3-003";

const assertion = (id: string, recordId: string, persona: string | null) => ({ id, record_id: recordId, record_persona_id: persona });
const link = (id: string, assertionId: string, confidence = "probable", extra = {}) => ({
  id, assertion_id: assertionId, person_id: "I1", confidence, superseded_by: null, ...extra,
});

function research(row: Record<string, unknown>, rows = 1) {
  return {
    log: [
      { id: "log_001", tool: "record_search", results_ref: "results/log_001.json" },
      { id: "log_002", tool: "record_search", results_ref: null },
      { id: "log_003", tool: "image_search", results_ref: null },
      { id: "log_004", tool: "fulltext_search", results_ref: "results/log_004.json" },
    ],
    assertions: [
      assertion("a_001", HOUSE, "p_9"), // the namesake's persona in the shared household record
      assertion("a_002", HOUSE, "p_1"), // the subject's own persona in it
      assertion("a_003", "HSE1-001", "p_9"), // bare spelling of the same record
      assertion("a_004", OTHER, "p_4"),
    ],
    person_evidence: [
      link("pe_001", "a_001"),
      link("pe_002", "a_002", "confident"),
      link("pe_003", "a_003"),
      link("pe_004", "a_004"),
      link("pe_005", "a_001", "speculative"),
      link("pe_006", "a_001", "probable", { superseded_by: "pe_001" }),
    ],
    namesakes: Array.from({ length: rows }, (_, i) => ({
      id: `ns_00${i + 1}`, person_id: "I1", record_ids: [HOUSE, LOST], log_entry_ids: ["log_001"],
      record_persona_ids: { [HOUSE]: "p_9" }, ...row,
    })),
  };
}

describe("personaStampCounts (item 10 of #3363)", () => {
  it("counts the stamped, the absent, the links a persona rule refuses and the ones it spares", () => {
    expect(personaStampCounts(research({}))).toEqual({
      listed: 2, unstampable: 0, stamped: 1, absent: 1, wouldRefuse: 2, spared: 1,
    });
  });

  it("keeps a page's image id and a full-text hit's id out of listed", () => {
    const page = personaStampCounts(
      research({ record_ids: ["004567123_00058"], log_entry_ids: ["log_003"], record_persona_ids: undefined }),
    );
    expect([page.listed, page.unstampable, page.stamped, page.absent]).toEqual([0, 1, 0, 0]);
    const hit = personaStampCounts(
      research({ record_ids: ["ark:/61903/3:1:3Q9M-CS1Z-9Q7S"], log_entry_ids: ["log_004"], record_persona_ids: undefined }),
    );
    expect([hit.listed, hit.unstampable, hit.stamped, hit.absent]).toEqual([0, 1, 0, 0]);
  });

  it("counts nothing for a pool row, which lists no record", () => {
    const c = personaStampCounts(research({ record_ids: [], record_persona_ids: undefined, notes: "pool: ..." }));
    expect([c.listed, c.unstampable, c.stamped, c.absent]).toEqual([0, 0, 0, 0]);
  });

  it("counts an unstamped record as absent only when its row cites a persona search with a sidecar", () => {
    expect(personaStampCounts(research({ log_entry_ids: ["log_002"] })).absent).toBe(0);
    expect(personaStampCounts(research({ log_entry_ids: [] })).absent).toBe(0);
  });

  it("judges no link on a record with no stamp", () => {
    const c = personaStampCounts(research({ record_persona_ids: {} }));
    expect([c.stamped, c.wouldRefuse, c.spared]).toEqual([0, 0, 0]);
  });

  it("counts a link to the stamped persona read from another member's record id", () => {
    // ns_001 of the hannah-earnest-children run: the row lists Hannah's ark, the
    // assertion came from the read of her husband's, with her persona.
    const r = research({});
    r.assertions.push(assertion("a_005", "ark:/61903/1:1:HSE1-00H", "p_9"));
    r.person_evidence.push(link("pe_007", "a_005"));
    expect(personaStampCounts(r).wouldRefuse).toBe(3);
  });

  it("counts a link once when the person has two rows", () => {
    const c = personaStampCounts(research({}, 2));
    expect([c.listed, c.wouldRefuse, c.spared]).toEqual([4, 2, 1]);
  });
});
