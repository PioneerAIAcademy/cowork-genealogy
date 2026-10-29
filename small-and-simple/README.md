# small-and-simple

Single-purpose genealogy functions meant to run inside an existing Node server.
Each one makes a few FamilySearch API calls and one or two LLM calls, then
returns JSON. There is no agent loop, no MCP server and no Python, and runtime
dependencies are zero.

This directory is independent of the rest of the repo. It imports nothing from
`packages/` and has its own `package.json`, lockfile and CI job.

| Solution | What it does |
|---|---|
| [`transcribe-image/`](transcribe-image/) | Reads a FamilySearch page scan and returns a verbatim transcription. |

## The contract every solution follows

```ts
const result = await solution(input, { fsToken, llm, fetch? });
```

- **`input`** holds plain JSON: identifiers and options.
- **`fsToken`** is the signed-in user's FamilySearch access token. The function
  calls FamilySearch as that user. It never logs in and never refreshes a token.
- **`llm`** is an `Llm` from [`shared/llm.ts`](shared/llm.ts). `openRouterLlm` is
  one adapter. To use a different gateway, write a ~30-line adapter with the same
  `complete()` signature.
- **`fetch`** is optional and defaults to the global `fetch`. Tests pass a fake.
- **No hidden inputs.** No environment variables, no config files, no
  filesystem access. Everything comes in through the arguments.
- **Errors are `SolutionError`** ([`shared/errors.ts`](shared/errors.ts)). Branch
  on `code` (`bad_input`, `unauthorized`, `forbidden`, `not_found`, `too_large`,
  `upstream`). The `message` is safe to show a user.

### Wiring one into a server

```ts
import { transcribeImage } from "./small-and-simple/transcribe-image/index.js";
import { openRouterLlm } from "./small-and-simple/shared/llm.js";
import { SolutionError } from "./small-and-simple/shared/errors.js";

const llm = openRouterLlm({ apiKey: process.env.OPENROUTER_API_KEY! });
const STATUS = { bad_input: 400, unauthorized: 401, forbidden: 403, not_found: 404, too_large: 413, upstream: 502 };

app.post("/api/transcribe-image", async (req, res) => {
  try {
    res.json(await transcribeImage(req.body, { fsToken: req.session.fsToken, llm }));
  } catch (e) {
    if (!(e instanceof SolutionError)) throw e;
    res.status(STATUS[e.code]).json({ error: e.code, message: e.message });
  }
});
```

The source is TypeScript with NodeNext `.js` import specifiers. `tsc` or any
bundler compiles it.

## Layout

```
shared/            code more than one solution will need
  errors.ts        SolutionError
  http.ts          fetch with a timeout and a small retry on 429/5xx
  familysearch.ts  FamilySearch quirks, image fetch
  llm.ts           the Llm interface and the OpenRouter adapter
<solution>/
  index.ts         the exported function
  prompt.ts        the prompt, on its own so it can be tuned without touching code
  *.test.ts        offline tests against a fake fetch and a fake LLM (run in CI)
  eval.ts          live accuracy check against fixtures/ (run by hand)
  fixtures/        real cases with human-verified answers
  README.md        input, output, errors, measured accuracy
```

## Adding a solution

1. Create `<name>/index.ts` exporting one function with the contract above.
2. Put the prompt in `prompt.ts`.
3. Add offline tests. Cover each error code the function can throw.
4. Add `fixtures/` with real cases and human-verified answers, and an `eval.ts`
   that scores the function against them. Without this, nobody can say how
   often the function is right.
5. Add a `README.md` with the measured score, then add a row to the table above.

Move code into `shared/` once a second solution needs it, not before.

## FamilySearch quirks the shared code handles

- **User agent.** Public endpoints sit behind Imperva, which answers 403 to
  non-browser user agents (`BROWSER_USER_AGENT`).
- **Image `Accept` header.** With `image/*,*/*`, an image ARK redirects straight
  to a pre-signed S3 URL. With `image/*` alone it redirects to
  `ark.familysearch.org`. `fetch` drops the token on that cross-host hop, so the
  request fails with 401.
- **Multi-image ARKs.** A film ARK can resolve to the wrong page without its
  `i`/`cc`/`groupId` parameters. They are forwarded when given. Some single-image
  ARKs answer them with an HTML page, so the bare ARK is tried second.
- **Record vs image ARKs.** `1:1:` and `1:2:` ARKs are records or personas, not
  images. Changing the prefix does not turn one into the other.

## Commands

```sh
npm ci
npm run typecheck
npm test                       # offline
npm run eval:transcribe-image  # live: needs FS_TOKEN and OPENROUTER_API_KEY
```
