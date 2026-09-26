import { describe, it, expect } from "vitest";
import { isFamilySearchPersonId } from "../../src/utils/fs-id.js";

describe("isFamilySearchPersonId", () => {
  it.each(["KD96-TV2", "KWCJ-RN4", "LKFW-9XH", "kd96-tv2", "ZZZZ-ZZ9", "BBBB-111"])(
    "accepts %j",
    (id) => expect(isFamilySearchPersonId(id)).toBe(true),
  );

  it.each([
    ["I1", "a project-local id"],
    ["P123", "a project-local id"],
    ["KAE6-TV2", "vowels are not in the FamilySearch alphabet"],
    ["AAAA-111", "vowels are not in the FamilySearch alphabet"],
    ["KD96-TV22", "four characters after the hyphen"],
    ["KD9-TV2", "three characters before the hyphen"],
    ["KD96TV2", "no hyphen"],
    ["", "empty"],
  ])("rejects %j (%s)", (id) => expect(isFamilySearchPersonId(id)).toBe(false));

  it("does not trim: match-engine tests raw ark segments", () => {
    expect(isFamilySearchPersonId(" KD96-TV2 ")).toBe(false);
  });
});
