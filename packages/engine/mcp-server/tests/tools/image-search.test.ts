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
