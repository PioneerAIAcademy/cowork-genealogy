import { describe, expect, it } from "vitest";
import { SolutionError } from "../shared/errors.js";
import { imageUrls } from "../shared/familysearch.js";
import { openRouterLlm, type Llm, type LlmRequest } from "../shared/llm.js";
import { characterErrorRate } from "./eval.js";
import { transcribeImage } from "./index.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function image(status = 200, contentType = "image/jpeg") {
  return new Response(status === 200 ? JPEG : "no", { status, headers: { "content-type": contentType } });
}

/** A fake fetch that answers each call from `responses` in turn and records the requests. */
function fakeFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function fakeLlm(text: string, truncated = false) {
  const requests: LlmRequest[] = [];
  const llm: Llm = {
    async complete(req) {
      requests.push(req);
      return { text, truncated, model: "fake-model" };
    },
  };
  return { llm, requests };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SolutionError) return error.code;
    throw error;
  }
  return "no error";
}

describe("transcribeImage", () => {
  it("fetches the scan as the user and returns the model's text", async () => {
    const { fetch, calls } = fakeFetch(image());
    const { llm, requests } = fakeLlm("JOHN SMITH b. 1820");
    const out = await transcribeImage({ imageId: "004884748_02613" }, { fsToken: "tok", fetch, llm });

    expect(out).toEqual({
      text: "JOHN SMITH b. 1820",
      truncated: false,
      model: "fake-model",
      imageUrl: "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["User-Agent"]).toMatch(/^Mozilla/);
    expect(headers.Accept).toBe("image/*,*/*");
    expect(requests[0].images?.[0]).toEqual({ bytes: JPEG, contentType: "image/jpeg", url: out.imageUrl });
  });

  it("passes truncation through", async () => {
    const { fetch } = fakeFetch(image());
    const { llm } = fakeLlm("first half", true);
    const out = await transcribeImage({ ark: "ark:/61903/3:1:3Q9M-CSDM-2S31-F" }, { fsToken: "t", fetch, llm });
    expect(out.truncated).toBe(true);
  });

  it("refuses an empty transcription rather than returning a blank page", async () => {
    const { fetch } = fakeFetch(image());
    const { llm } = fakeLlm("");
    expect(await codeOf(transcribeImage({ imageId: "1_2" }, { fsToken: "t", fetch, llm }))).toBe("upstream");
  });

  it("falls back to the bare ARK when the page-context URL returns HTML", async () => {
    const { fetch, calls } = fakeFetch(image(200, "text/html"), image());
    const { llm } = fakeLlm("text");
    const ark = "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSDM-2S31-F?lang=en&i=4&cc=1858355";
    const out = await transcribeImage({ ark }, { fsToken: "t", fetch, llm });
    expect(calls.map((c) => c.url)).toEqual([
      "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSDM-2S31-F?i=4&cc=1858355",
      "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSDM-2S31-F",
    ]);
    expect(out.imageUrl).toBe(calls[1].url);
  });

  it.each([
    [403, "forbidden"],
    [401, "unauthorized"],
    [404, "not_found"],
    [500, "upstream"],
  ])("maps a FamilySearch %i to %s", async (status, code) => {
    const { fetch } = fakeFetch(image(status));
    const { llm } = fakeLlm("x");
    expect(await codeOf(transcribeImage({ imageId: "1_2" }, { fsToken: "t", fetch, llm }))).toBe(code);
  });
});

describe("imageUrls", () => {
  it.each([
    ["ark:/61903/3:2:77TF-QKLH", "https://www.familysearch.org/ark:/61903/3:2:77TF-QKLH"],
    ["3:1:3Q9M-CSDM-2S31-F", "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSDM-2S31-F"],
  ])("resolves %s", (ark, url) => {
    expect(imageUrls({ ark })).toEqual([url]);
  });

  it("names a record ARK as the wrong kind of identifier", () => {
    expect(() => imageUrls({ ark: "ark:/61903/1:1:QVS9-DHDB" })).toThrow(/record or person ARK/);
  });

  it.each([{}, { ark: "3:1:A", imageId: "1_2" }, { imageId: "abc" }])("rejects %j", (ref) => {
    expect(() => imageUrls(ref)).toThrow(SolutionError);
  });
});

describe("openRouterLlm", () => {
  const ok = (body: object) => new Response(JSON.stringify(body), { status: 200 });

  it("sends the image as a data URL with training retention denied", async () => {
    const { fetch, calls } = fakeFetch(ok({ model: "m", choices: [{ message: { content: " hi " } }] }));
    const out = await openRouterLlm({ apiKey: "k", fetch }).complete({
      prompt: "read",
      images: [{ bytes: JPEG, contentType: "image/jpeg" }],
      maxTokens: 10,
    });
    expect(out).toEqual({ text: "hi", truncated: false, model: "m" });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.provider).toEqual({ data_collection: "deny" });
    expect(body.messages[0].content[1].image_url.url).toBe("data:image/jpeg;base64,/9j/4A==");
  });

  it.each(["length", "MAX_TOKENS"])("reads finish reason %s as truncated", async (reason) => {
    const { fetch } = fakeFetch(ok({ choices: [{ message: { content: "x" }, native_finish_reason: reason }] }));
    const out = await openRouterLlm({ apiKey: "k", fetch }).complete({ prompt: "p", maxTokens: 1 });
    expect(out.truncated).toBe(true);
  });

  it("retries a 429 once, honouring Retry-After", async () => {
    const busy = new Response("busy", { status: 429, headers: { "retry-after": "0" } });
    const { fetch, calls } = fakeFetch(busy, ok({ choices: [{ message: { content: "x" } }] }));
    const out = await openRouterLlm({ apiKey: "k", fetch }).complete({ prompt: "p", maxTokens: 1 });
    expect(out.text).toBe("x");
    expect(calls).toHaveLength(2);
  });

  it("refuses an image over the model's request limit before sending it", async () => {
    const { fetch, calls } = fakeFetch();
    const big = { bytes: new Uint8Array(15 * 2 ** 20), contentType: "image/jpeg" };
    const llm = openRouterLlm({ apiKey: "k", fetch });
    expect(await codeOf(llm.complete({ prompt: "p", images: [big], maxTokens: 1 }))).toBe("too_large");
    expect(calls).toHaveLength(0);
  });

  it("maps a rejected key to unauthorized", async () => {
    const { fetch } = fakeFetch(new Response("no", { status: 401 }));
    expect(await codeOf(openRouterLlm({ apiKey: "k", fetch }).complete({ prompt: "p", maxTokens: 1 }))).toBe(
      "unauthorized",
    );
  });
});

describe("characterErrorRate", () => {
  it("ignores whitespace layout and counts edits against the key", () => {
    expect(characterErrorRate("JOHN  SMITH\nb. 1820", "JOHN SMITH b. 1820")).toBe(0);
    expect(characterErrorRate("JOHN SMYTH", "JOHN SMITH")).toBeCloseTo(0.1);
  });
});
