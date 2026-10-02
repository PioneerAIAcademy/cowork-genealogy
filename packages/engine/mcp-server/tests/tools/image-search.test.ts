import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { imageSearchTool } from "../../src/tools/image-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import { socketFetchFailure } from "../helpers/fetch-failed.js";

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

  await imageSearchTool({ imageGroupNumber: "007621224_005_M99P-2TQ" }, LOCAL);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const url = mockFetch.mock.calls[0][0] as string;
  expect(url).toContain("/artifact/group/M99P-2TQ/children/names");
});

// Test 2 — bare form calls apid then children/names
it("bare form: calls apid endpoint, then children/names with the apid", async () => {
  mockFetch
    .mockResolvedValueOnce(okApid("TH-1942-27199-5790-22"))
    .mockResolvedValueOnce(okChildren());

  await imageSearchTool({ imageGroupNumber: "007621224" }, LOCAL);

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

  await imageSearchTool({ imageGroupNumber: "007621224" }, LOCAL);

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
  }, LOCAL);

  expect(result.imageIds).toEqual([
    "004884748_02613",
    "004884748_02614",
    "004884748_02615",
  ]);
});

// Test 5 — throws when imageGroupNumber is missing
it("throws when imageGroupNumber is missing", async () => {
  await expect(
    imageSearchTool({ imageGroupNumber: "" }, LOCAL)
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
    imageSearchTool({ imageGroupNumber: "007621224" }, LOCAL)
  ).rejects.toThrow(
    "Could not resolve image group number 007621224 to an image group."
  );
});

// Test 7 — empty response returns { imageIds: [] }
it("returns empty imageIds for an empty {} response", async () => {
  mockFetch.mockResolvedValueOnce(okChildren({}));

  const result = await imageSearchTool({
    imageGroupNumber: "007621224_005_M99P-2TQ",
  }, LOCAL);

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
    imageSearchTool({ imageGroupNumber: "007621224" }, LOCAL)
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
    imageSearchTool({ imageGroupNumber: "007621224_005_M99P-2TQ" }, LOCAL)
  ).rejects.toThrow(
    "FamilySearch session not accepted; call the login tool to re-authenticate."
  );
});

// Test 10 — network error (retried by fetchWithRetry before surfacing)
it("throws on network error", async () => {
  mockFetch.mockRejectedValue(socketFetchFailure());

  await expect(
    imageSearchTool({ imageGroupNumber: "007621224_005_M99P-2TQ" }, LOCAL)
  ).rejects.toThrow(
    /Could not reach FamilySearch image search API: fetch failed <- ETIMEDOUT/
  );
});

// Test 11 — header contract on children/names call
it("sends correct headers on children/names call", async () => {
  mockFetch.mockResolvedValueOnce(okChildren());

  await imageSearchTool({ imageGroupNumber: "007621224_005_M99P-2TQ" }, LOCAL);

  const init = mockFetch.mock.calls[0][1] as RequestInit;
  const hdrs = new Headers(init.headers as HeadersInit);
  expect(hdrs.get("Authorization")).toBe("Bearer test-token");
  expect(hdrs.get("Accept")).toBe("application/json");
  expect(hdrs.get("User-Agent")).toBe(BROWSER_USER_AGENT);
  expect(hdrs.get("FS-User-Agent-Chain")).toBe("chesworth");
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
  }, LOCAL);

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
  }, LOCAL);

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

  await imageSearchTool({ imageGroupNumber: "004514823_003_M9SW-1CG" }, LOCAL);

  expect(mockFetch).toHaveBeenCalledTimes(1);
});

// Test 15 — still defective on retry: return what is there, do not throw
it("returns the surviving IDs when the retry is also defective", async () => {
  mockFetch
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN))
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN));

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  }, LOCAL);

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
  // First fetchChildren succeeds (defective), all subsequent calls reject
  // (fetchWithRetry retries the rejection before re-throwing).
  mockFetch
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN))
    .mockRejectedValue(new Error("ECONNRESET"));

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  }, LOCAL);

  expect(result.imageIds).toEqual([
    "004514823_00671",
    "004514823_00673",
  ]);
});

// Test 17 — same guarantee when the retry is a non-OK HTTP response.
it("keeps the surviving IDs when the retry returns a server error", async () => {
  // First fetchChildren succeeds (defective), all subsequent calls return 500
  // (fetchWithRetry retries the 500 before returning the last response).
  mockFetch
    .mockResolvedValueOnce(okChildren(DEFECTIVE_CHILDREN))
    .mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
    });

  const result = await imageSearchTool({
    imageGroupNumber: "004514823_003_M9SW-1CG",
  }, LOCAL);

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
  }, LOCAL);

  expect(result.imageIds).toEqual([
    "004514823_00671",
    "004514823_00672",
    "004514823_00673",
  ]);
});

// ─── Within-item addressing (item / itemImage) ──────────────────────────────
// A fake film shaped like the live 004528134 (probed 2026-10-02): image-bearing
// groups in film order, then image-less ones; group 5's metadata is refused.

interface FakeGroup {
  id: string;
  images?: (string | null)[];
  status?: number;
  meta?: { groupName?: string; coverages?: { place?: string }[] } | number;
}

function filmGroups(): FakeGroup[] {
  const span = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `004528134_${String(from + i).padStart(5, "0")}`);
  const named = (id: string, n: number, place: string, from: number, to: number): FakeGroup => ({
    id,
    images: span(from, to),
    meta: { groupName: `004528134_${String(n).padStart(3, "0")}_${id}`, coverages: [{ place }] },
  });
  return [
    named("G1", 1, "Strijen", 1, 389),
    named("G2", 2, "Tienhoven", 390, 440),
    named("G3", 3, "Nieuwe-Tonge", 441, 537),
    named("G4", 4, "Oude-Tonge", 538, 622),
    { id: "M92M-53P", images: span(623, 644), meta: 403 },
    named("G6", 6, "Oude-Tonge", 645, 700),
    { id: "MMXT-1", images: [] , meta: 403 },
    { id: "MMXT-2", images: [] , meta: 403 },
  ];
}

function serveFilm(groups: FakeGroup[], apid = "TH-FILM") {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/group/004528134/apid")) return { ok: true, status: 200, text: async () => apid };
    if (url.endsWith(`/group/${apid}/children`)) {
      return { ok: true, status: 200, json: async () => groups.map((g) => g.id) };
    }
    for (const g of groups) {
      if (url.endsWith(`/artifact/group/${g.id}/children/names`)) {
        const status = g.status ?? 200;
        const images = g.images ?? [];
        return {
          ok: status === 200,
          status,
          statusText: status === 200 ? "OK" : "Forbidden",
          json: async () => Object.fromEntries(images.map((v, i) => [`apid-${g.id}-${i}`, v])),
        };
      }
      if (url.endsWith(`/group-service/group/${g.id}`)) {
        if (typeof g.meta === "number" || g.meta === undefined) {
          return { ok: false, status: typeof g.meta === "number" ? g.meta : 404, statusText: "Forbidden" };
        }
        const meta = g.meta;
        return { ok: true, status: 200, json: async () => meta };
      }
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

describe("image_search — item / itemImage", () => {
  it("item 5, itemImage 10 resolves the tester's citation to 004528134_00632", async () => {
    serveFilm(filmGroups());
    const r = await imageSearchTool({ imageGroupNumber: "004528134", item: 5, itemImage: 10 }, LOCAL);
    expect(r.imageId).toBe("004528134_00632");
    expect(r.imageIds).toHaveLength(22);
    expect(r.imageIds[0]).toBe("004528134_00623");
    // Group 5's metadata is refused, so its name is composed from the position.
    expect(r.imageGroupNumber).toBe("004528134_005_M92M-53P");
    expect(r.imageGroupNumberFrom).toBe("position");
    expect(r.place).toBeNull();
  });

  it("uses the group's own name and place when they are readable", async () => {
    serveFilm(filmGroups());
    const r = await imageSearchTool({ imageGroupNumber: "004528134", item: 4 }, LOCAL);
    expect(r.imageGroupNumber).toBe("004528134_004_G4");
    expect(r.imageGroupNumberFrom).toBe("name");
    expect(r.place).toBe("Oude-Tonge");
    expect(r.imageId).toBeUndefined();
  });

  it("does not read groups after the target", async () => {
    const groups = filmGroups();
    groups[6] = { id: "MMXT-1", status: 500 };
    groups.push(...Array.from({ length: 10 }, (_, i) => ({ id: `LATE-${i}`, status: 500 })));
    serveFilm(groups);
    const r = await imageSearchTool({ imageGroupNumber: "004528134", item: 2 }, LOCAL);
    expect(r.imageIds[0]).toBe("004528134_00390");
    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("LATE-"))).toBe(false);
  });

  it("counts image-less groups out and names the range when item is too large", async () => {
    serveFilm(filmGroups());
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item: 7 }, LOCAL),
    ).rejects.toThrow("film 004528134 has 6 items with images; item must be 1–6.");
  });

  it("names the range when itemImage is past the item's last image", async () => {
    serveFilm(filmGroups());
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item: 5, itemImage: 23 }, LOCAL),
    ).rejects.toThrow("item 5 has 22 images; itemImage must be 1–22.");
  });

  it("says the film is not split when no child holds images", async () => {
    serveFilm([{ id: "MMXG-HLW", images: [], meta: 403 }]);
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item: 1 }, LOCAL),
    ).rejects.toThrow("film 004528134 is not split into items; call image_search without item.");
  });

  it("throws, rather than shifting, when a group before the target is refused", async () => {
    const groups = filmGroups();
    groups[1] = { id: "G2", status: 403 };
    serveFilm(groups);
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item: 5 }, LOCAL),
    ).rejects.toThrow(/group G2 \(2 of 8\) could not be read.*every later item is unknown/);
  });

  it("throws, rather than resolving item 6, when a group before the target lists only nulls", async () => {
    const groups = filmGroups();
    groups[1] = { id: "G2", images: [null, null, null] };
    serveFilm(groups);
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item: 5 }, LOCAL),
    ).rejects.toThrow(/group G2 \(2 of 8\) returned a defective image list/);
  });

  it("refuses to count within an item whose list stays one image short, but still browses it", async () => {
    const groups = filmGroups();
    const target = groups[4];
    target.images = [...(target.images as string[]).slice(0, 5), null, ...(target.images as string[]).slice(6)];
    serveFilm(groups);
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item: 5, itemImage: 10 }, LOCAL),
    ).rejects.toThrow(/item 5 of film 004528134 came back with 1 unreadable image entry/);
    const browse = await imageSearchTool({ imageGroupNumber: "004528134", item: 5 }, LOCAL);
    expect(browse.imageIds).toHaveLength(21);
  });

  it("reports a request that runs out of time as the deadline, not as a bad group", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = Date.now();
      serveFilm(filmGroups());
      const inner = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: string, init: unknown) => {
        if (url.endsWith("/artifact/group/G2/children/names")) {
          vi.setSystemTime(start + 45_500);
          throw new DOMException("The operation timed out.", "TimeoutError");
        }
        return inner(url, init);
      });
      await expect(
        imageSearchTool({ imageGroupNumber: "004528134", item: 5 }, LOCAL),
      ).rejects.toThrow(/gave up on film 004528134 after 45s/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a film lookup that runs past the deadline as the deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = Date.now();
      mockFetch.mockImplementation(async () => {
        vi.setSystemTime(start + 45_500);
        throw new DOMException("The operation timed out.", "TimeoutError");
      });
      await expect(
        imageSearchTool({ imageGroupNumber: "004528134", item: 5 }, LOCAL),
      ).rejects.toThrow(/gave up on film 004528134 after 45s, before listing its groups/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the film when its group list is not JSON", async () => {
    serveFilm(filmGroups());
    const inner = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: string, init: unknown) => {
      if (url.endsWith("/group/TH-FILM/children")) {
        return { ok: true, status: 200, json: async () => JSON.parse("<html>blocked</html>") };
      }
      return inner(url, init);
    });
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item: 5 }, LOCAL),
    ).rejects.toThrow("Could not list the items of film 004528134: the response was not JSON.");
  });

  it("names the film when its group list is refused", async () => {
    serveFilm(filmGroups());
    const inner = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: string, init: unknown) => {
      if (url.endsWith("/group/TH-FILM/children")) return { ok: false, status: 403, statusText: "Forbidden" };
      return inner(url, init);
    });
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item: 5 }, LOCAL),
    ).rejects.toThrow("Could not list the items of film 004528134: 403 Forbidden.");
  });

  it("coerces a numeric string", async () => {
    serveFilm(filmGroups());
    const r = await imageSearchTool(
      { imageGroupNumber: "004528134", item: "5", itemImage: "10" } as never,
      LOCAL,
    );
    expect(r.imageId).toBe("004528134_00632");
  });

  it.each([0, -1, 1.5, "five", true])("rejects item %j before any fetch", async (item) => {
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", item } as never, LOCAL),
    ).rejects.toThrow(/`item` must be an integer of 1 or more/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects itemImage without item", async () => {
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", itemImage: 10 }, LOCAL),
    ).rejects.toThrow(/`itemImage` needs `item`/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects item on a split group name", async () => {
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134_005_M92M-53P", item: 1 }, LOCAL),
    ).rejects.toThrow(/needs a bare film number/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["itemNumber", 5],
    ["item_number", 5],
    ["imageNumber", 10],
    ["page", 10],
    ["frame", "632"],
  ])("rejects the misspelled address %s instead of serving the whole film", async (key, value) => {
    await expect(
      imageSearchTool({ imageGroupNumber: "004528134", [key]: value } as never, LOCAL),
    ).rejects.toThrow(`image_search has no parameter \`${key}\``);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lets an unrelated text key through and lists the film", async () => {
    mockFetch.mockResolvedValueOnce(okApid("TH-FILM")).mockResolvedValueOnce(okChildren());
    const r = await imageSearchTool(
      { imageGroupNumber: "004528134", lookingFor: "Flynn family" } as never,
      LOCAL,
    );
    expect(r).toEqual({ imageIds: Object.values(SAMPLE_CHILDREN).sort() });
  });

  it("gives up with a readable error when the deadline passes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const groups = filmGroups();
      const start = Date.now();
      serveFilm(groups);
      const inner = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: string, init: unknown) => {
        // The film's children list answers after 46s: every list after it is out of time.
        if (url.endsWith("/group/TH-FILM/children")) vi.setSystemTime(start + 46_000);
        return inner(url, init);
      });
      await expect(
        imageSearchTool({ imageGroupNumber: "004528134", item: 5 }, LOCAL),
      ).rejects.toThrow(/gave up on film 004528134 after 45s/);
    } finally {
      vi.useRealTimers();
    }
  });
});
