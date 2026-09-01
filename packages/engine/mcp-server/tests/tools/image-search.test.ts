import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { imageSearchTool } from "../../src/tools/image-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const SAMPLE_CHILDREN: Record<string, string> = {
  "TH-1951-22159-52423-62": "004884748_02613",
  "TH-1951-22159-52571-81": "004884748_02614",
  "TH-1942-22159-53144-63": "004884748_02615",
};

function okChildren(data: Record<string, string> = SAMPLE_CHILDREN) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data });
}

function okApid(apid: string) {
  return Promise.resolve({ ok: true, status: 200, text: async () => apid });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Test 1 — split form uses last segment, calls children/names directly
it("split form: uses last _ segment as groupId, skips apid lookup", async () => {
  mockFetch.mockResolvedValueOnce(okChildren());

  await imageSearchTool({ imageGroupNumber: "007621224_005_M99P-2TQ" });

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const url = mockFetch.mock.calls[0][0] as string;
  expect(url).toContain("/artifact/group/M99P-2TQ/children/names");
});

// Test 2 — bare form calls apid then children/names
it("bare form: calls apid endpoint, then children/names with the apid", async () => {
  mockFetch
    .mockResolvedValueOnce(okApid("TH-1942-27199-5790-22"))
    .mockResolvedValueOnce(okChildren());

  await imageSearchTool({ imageGroupNumber: "007621224" });

  expect(mockFetch).toHaveBeenCalledTimes(2);
  const apidUrl = mockFetch.mock.calls[0][0] as string;
  const childrenUrl = mockFetch.mock.calls[1][0] as string;
  expect(apidUrl).toContain("/group/007621224/apid");
  expect(childrenUrl).toContain(
    "/artifact/group/TH-1942-27199-5790-22/children/names"
  );
});

// Test 3 — apid body is plain text, whitespace is trimmed
it("reads apid body as plain text and trims whitespace", async () => {
  mockFetch
    .mockResolvedValueOnce(
      okApid("  TH-1942-27199-5790-22  \n")
    )
    .mockResolvedValueOnce(okChildren());

  await imageSearchTool({ imageGroupNumber: "007621224" });

  const childrenUrl = mockFetch.mock.calls[1][0] as string;
  expect(childrenUrl).toContain(
    "/artifact/group/TH-1942-27199-5790-22/children/names"
  );
});

// Test 4 — returns imageId values (not apid keys), sorted ascending
it("returns imageId values sorted ascending", async () => {
  mockFetch.mockResolvedValueOnce(
    okChildren({
      "TH-A": "004884748_02615",
      "TH-B": "004884748_02613",
      "TH-C": "004884748_02614",
    })
  );

  const result = await imageSearchTool({
    imageGroupNumber: "007621224_005_M99P-2TQ",
  });

  expect(result.imageIds).toEqual([
    "004884748_02613",
    "004884748_02614",
    "004884748_02615",
  ]);
});

// Test 5 — throws when imageGroupNumber is missing
it("throws when imageGroupNumber is missing", async () => {
  await expect(
    imageSearchTool({ imageGroupNumber: "" })
  ).rejects.toThrow("image_search requires an imageGroupNumber.");
  expect(mockFetch).not.toHaveBeenCalled();
});

// Test 6 — throws when apid lookup fails
it("throws when apid lookup returns non-OK", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 404,
    statusText: "Not Found",
  });

  await expect(
    imageSearchTool({ imageGroupNumber: "007621224" })
  ).rejects.toThrow(
    "Could not resolve image group number 007621224 to an image group."
  );
});

// Test 7 — empty response returns { imageIds: [] }
it("returns empty imageIds for an empty {} response", async () => {
  mockFetch.mockResolvedValueOnce(okChildren({}));

  const result = await imageSearchTool({
    imageGroupNumber: "007621224_005_M99P-2TQ",
  });

  expect(result.imageIds).toEqual([]);
});

// Test 8 — auth error propagates
it("throws auth error when not authenticated", async () => {
  mockedGetValidToken.mockRejectedValueOnce(
    new Error(
      "User is not logged in to FamilySearch. Call the login tool to authenticate."
    )
  );

  await expect(
    imageSearchTool({ imageGroupNumber: "007621224" })
  ).rejects.toThrow(/not logged in/);
  expect(mockFetch).not.toHaveBeenCalled();
});

// Test 9 — 401 on children/names
it("throws on 401 with re-login guidance", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
  });

  await expect(
    imageSearchTool({ imageGroupNumber: "007621224_005_M99P-2TQ" })
  ).rejects.toThrow(
    "FamilySearch session not accepted; call the login tool to re-authenticate."
  );
});

// Test 10 — network error
it("throws on network error", async () => {
  mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

  await expect(
    imageSearchTool({ imageGroupNumber: "007621224_005_M99P-2TQ" })
  ).rejects.toThrow(
    "Could not reach FamilySearch image search API: ECONNREFUSED."
  );
});

// Test 11 — header contract on children/names call
it("sends correct headers on children/names call", async () => {
  mockFetch.mockResolvedValueOnce(okChildren());

  await imageSearchTool({ imageGroupNumber: "007621224_005_M99P-2TQ" });

  const init = mockFetch.mock.calls[0][1] as RequestInit;
  const hdrs = init.headers as Record<string, string>;
  expect(hdrs["Authorization"]).toBe("Bearer test-token");
  expect(hdrs["Accept"]).toBe("application/json");
  expect(hdrs["User-Agent"]).toBe(BROWSER_USER_AGENT);
  expect(hdrs["FS-User-Agent-Chain"]).toBe("chesworth");
});

// ---------------------------------------------------------------------------
// Defective children/names responses.
//
// Observed live 2026-08-25 on group M9SW-1CG (Barsebäck, 004514823_003): the
// endpoint returned its full 164 keys but sent `null` as the VALUE of one of
// them, for image 004514823_00672. `Record<string, string>` is asserted, not
// checked, so the null reached `imageIds` — and the real image vanished from
// the list, making that page unreachable for the rest of the run. Nine other
// calls to the same group were clean, so this is upstream flakiness the tool
// has to absorb rather than trust away.
// ---------------------------------------------------------------------------

const DEFECTIVE_CHILDREN = {
  "TH-A": "004514823_00671",
  "TH-B": null,
  "TH-C": "004514823_00673",
} as unknown as Record<string, string>;

const REPAIRED_CHILDREN: Record<string, string> = {
  "TH-A": "004514823_00671",
  "TH-B": "004514823_00672",
  "TH-C": "004514823_00673",
};

// Test 12 — a null value never reaches the caller
it("drops non-string values instead of emitting them as image IDs", async () => {
  mockFetch
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN))
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN));

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  });

  expect(result.imageIds).not.toContain(null);
  expect(result.imageIds.every((id) => typeof id === "string")).toBe(true);
});

// Test 13 — a defective response is re-requested once, recovering the lost image
it("re-requests once on a defective response and recovers the dropped image", async () => {
  mockFetch
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN))
    .mockResolvedValueOnce(okChildren(REPAIRED_CHILDREN));

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  });

  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(result.imageIds).toEqual([
    "004514823_00671",
    "004514823_00672",
    "004514823_00673",
  ]);
});

// Test 14 — a clean response is never re-requested
it("does not re-request when the first response is clean", async () => {
  mockFetch.mockResolvedValueOnce(okChildren(REPAIRED_CHILDREN));

  await imageSearchTool({ imageGroupNumber: "004514823_003_M9SW-1CG" });

  expect(mockFetch).toHaveBeenCalledTimes(1);
});

// Test 15 — still defective on retry: return what is there, do not throw
it("returns the surviving IDs when the retry is also defective", async () => {
  mockFetch
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN))
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN));

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  });

  expect(result.imageIds).toEqual([
    "004514823_00671",
    "004514823_00673",
  ]);
});

// Test 16 — a retry that REJECTS must not lose the usable IDs from attempt one.
// Reviewed catch on #1921: the re-request was unwrapped, so a 500/timeout/401 on
// the second call threw and the caller got nothing — strictly worse than the
// pre-filter behaviour, which at least returned the 163 survivors.
it("keeps the surviving IDs when the retry rejects", async () => {
  mockFetch
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN))
    .mockRejectedValueOnce(new Error("ECONNRESET"));

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  });

  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(result.imageIds).toEqual([
    "004514823_00671",
    "004514823_00673",
  ]);
});

// Test 17 — same guarantee when the retry is a non-OK HTTP response.
it("keeps the surviving IDs when the retry returns a server error", async () => {
  mockFetch
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN))
    .mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  });

  expect(result.imageIds).toEqual([
    "004514823_00671",
    "004514823_00673",
  ]);
});

// Test 18 — usable IDs win over a lower dropped count. A clean but shorter
// retry must not displace a longer defective one: 2 clean IDs are worse than
// 3 usable ones, whatever `dropped` says.
it("does not let a clean but shorter retry displace more usable IDs", async () => {
  mockFetch
    .mockResolvedValueOnce(
      okChildren({
        "TH-A": "004514823_00671",
        "TH-B": "004514823_00672",
        "TH-C": "004514823_00673",
        "TH-D": null,
      } as unknown as Record<string, string>)
    )
    .mockResolvedValueOnce(
      okChildren({
        "TH-A": "004514823_00671",
        "TH-B": "004514823_00672",
      })
    );

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  });

  expect(result.imageIds).toEqual([
    "004514823_00671",
    "004514823_00672",
    "004514823_00673",
  ]);
});
