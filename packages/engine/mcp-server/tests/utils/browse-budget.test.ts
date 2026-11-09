/**
 * Issue #3996 — a connector call naming no project must not pool its image-cap
 * count with every other connector user's no-project reads. Exercises
 * `checkImageBrowseCap`/`recordImageBrowse` directly against the unbound,
 * in-process branch (`getProjectStore().projectId === undefined`, no
 * `projectPath`), the same branch `image-read.test.ts`'s pre-existing
 * no-projectPath pooling test covers for LOCAL.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { LOCAL, connectorPrincipal } from "../../src/auth/principal.js";
import {
  IMAGE_BROWSE_CAP,
  checkImageBrowseCap,
  recordImageBrowse,
  __clearImageBrowseMemoryForTests,
} from "../../src/utils/browse-budget.js";
import { runWithProjectStore } from "../../src/store/project-store.js";
import { fileStoreOnly } from "../helpers/store-backend.js";
import { ScopedFsStore, SCOPED_ANCHOR } from "../helpers/scoped-fs-store.js";

const GROUP = "004884748";
const img = (seq: number): string => `${GROUP}_${String(seq).padStart(5, "0")}`;

function connector(userId: string) {
  return connectorPrincipal({ accessToken: "tok", userId });
}

async function readImages(
  principal: ReturnType<typeof connector> | typeof LOCAL,
  ids: number[],
): Promise<void> {
  for (const i of ids) {
    await recordImageBrowse(
      await checkImageBrowseCap({ imageId: img(i) }, undefined, "image_transcribe", principal),
    );
  }
}

beforeEach(() => {
  // The connector no-project cap is in-process state with no Postgres
  // meaning — the same reason image-read.test.ts's no-projectPath test calls
  // this.
  fileStoreOnly("the connector no-project cap is in-process state with no Postgres meaning");
  __clearImageBrowseMemoryForTests();
});

describe("checkImageBrowseCap — per-user scope for a connector call naming no project (#3996)", () => {
  it("lets two different connector users each read 20 images of the same group with no project", async () => {
    const userA = connector("user-a");
    const userB = connector("user-b");

    await readImages(userA, Array.from({ length: 20 }, (_, i) => i + 1));
    await readImages(userB, Array.from({ length: 20 }, (_, i) => i + 1));

    // Both users independently reached 20 over the SAME image ids — neither
    // advanced the other's count, or one of them would have been refused
    // before its own 20th read.
  });

  it("refuses a connector user's 21st distinct image without touching another user's count", async () => {
    const userA = connector("user-a");
    const userB = connector("user-b");

    await readImages(userA, Array.from({ length: 20 }, (_, i) => i + 1));
    await expect(
      checkImageBrowseCap({ imageId: img(21) }, undefined, "image_transcribe", userA),
    ).rejects.toThrow(/Image cap reached: 20 distinct images from image group 004884748/);

    // user-b has read nothing yet: its own first read of the same group must
    // still succeed — the refusal above must not have spent user-b's budget.
    const ticket = await checkImageBrowseCap({ imageId: img(1) }, undefined, "image_transcribe", userB);
    expect(ticket).toBeDefined();
  });

  it("the connector refusal names the account, never 'this server session'", async () => {
    const userA = connector("user-a");
    await readImages(userA, Array.from({ length: 20 }, (_, i) => i + 1));
    const err = await checkImageBrowseCap(
      { imageId: img(21) },
      undefined,
      "image_transcribe",
      userA,
    ).catch((e) => e);
    expect((err as Error).message).toMatch(
      /have already been read without a project under your account, so 004884748_00021(?: \(\S+\))? was not fetched\. A new agent does not reset it\./,
    );
    expect((err as Error).message).not.toContain("server session");
  });

  it("a LOCAL (non-connector) no-project read keeps the pre-#3996 shared 'server session' wording", async () => {
    await readImages(LOCAL, Array.from({ length: IMAGE_BROWSE_CAP }, (_, i) => i + 1));
    const err = await checkImageBrowseCap(
      { imageId: img(IMAGE_BROWSE_CAP + 1) },
      undefined,
      "image_transcribe",
      LOCAL,
    ).catch((e) => e);
    expect((err as Error).message).toMatch(/have already been read in this server session/);
  });

  it("a LOCAL no-project read and a connector no-project read never pool", async () => {
    const userA = connector("user-a");
    // LOCAL fills its own 20-image cap. Before #3996, LOCAL and a header-less
    // connector call shared one `<no-project>` bucket, so a brand-new image
    // here would have been refused for user-a too.
    await readImages(LOCAL, Array.from({ length: IMAGE_BROWSE_CAP }, (_, i) => i + 1));
    const ticket = await checkImageBrowseCap(
      { imageId: img(IMAGE_BROWSE_CAP + 1) },
      undefined,
      "image_transcribe",
      userA,
    );
    expect(ticket).toBeDefined();
  });

  it("the reverse direction: a connector's no-project reads never advance a LOCAL no-project read's count either", async () => {
    // The asymmetric half of the isolation claim. `inProcessSeen`'s general
    // (LOCAL/file-backend) union loop matches any in-process key ending in
    // `\0${group}` — a connector-scoped key (`<no-project>:user-a\0${group}`)
    // ends in exactly that too, so without excluding connector-scoped keys
    // from that union, user-a's reads would leak into LOCAL's count even
    // though the previous test proves the other direction is safe.
    const userA = connector("user-a");
    await readImages(userA, Array.from({ length: IMAGE_BROWSE_CAP }, (_, i) => i + 1));
    const ticket = await checkImageBrowseCap(
      { imageId: img(IMAGE_BROWSE_CAP + 1) },
      undefined,
      "image_transcribe",
      LOCAL,
    );
    expect(ticket).toBeDefined();
  });
});

describe("checkImageBrowseCap — a bound store's projectId, not the local projectPath argument, decides the scope", () => {
  it("a connector call whose projectPath was stripped (not-yet-created project) shares ONE count with the same project's later, projectPath-carrying calls", async () => {
    // Reproduces imageTranscribeMcpTool's behavior: it drops `projectPath`
    // from the call whenever classifyProjectPath answers "no_project" (a
    // project directory that exists but holds neither research.json nor
    // tree.gedcomx.json yet — e.g. a connector's very first image_transcribe
    // call against a fresh `/proj_<16hex>` path, before project_create has
    // run). The door (http-server.ts) still binds the store to that
    // project's real projectId regardless, so checkImageBrowseCap must scope
    // on the STORE's bound-ness, not on whether its own `projectPath`
    // parameter happens to be undefined — or the same project's cap silently
    // splits into two buckets depending on call order.
    fileStoreOnly("ScopedFsStore simulates the pg-bound per-request store over the file backend");
    const root = await mkdtemp(join(tmpdir(), "browse-cap-bound-"));
    try {
      const store = new ScopedFsStore(root, "proj_abc123");
      const userA = connector("user-a");

      await runWithProjectStore(store, async () => {
        // First 10: projectPath stripped, as imageTranscribeMcpTool does
        // before the project exists.
        for (let i = 1; i <= 10; i++) {
          await recordImageBrowse(
            await checkImageBrowseCap({ imageId: img(i) }, undefined, "image_transcribe", userA),
          );
        }
        // Next 10: the project now exists, so projectPath is kept.
        for (let i = 11; i <= 20; i++) {
          await recordImageBrowse(
            await checkImageBrowseCap({ imageId: img(i) }, SCOPED_ANCHOR, "image_transcribe", userA),
          );
        }
        // One count of 20, not two separate buckets of up to 20 each: a 21st
        // is refused whichever way it carries projectPath.
        await expect(
          checkImageBrowseCap({ imageId: img(21) }, undefined, "image_transcribe", userA),
        ).rejects.toThrow(/Image cap reached: 20 distinct images/);
        await expect(
          checkImageBrowseCap({ imageId: img(22) }, SCOPED_ANCHOR, "image_transcribe", userA),
        ).rejects.toThrow(/Image cap reached: 20 distinct images/);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names the account, not 'this server session', when the store is bound but the project has no persisted log yet", async () => {
    // The refusal WORDING must ask "is this principal a connector" on its
    // own terms, independent of `connectorUser` (the key-scoping variable,
    // correctly forced undefined once the store is bound) — or a connector
    // hitting a bound-but-not-yet-`project_create`d project falls through
    // to the LOCAL/file-backend "this server session" wording, exactly the
    // confusion #3996 exists to remove.
    fileStoreOnly("ScopedFsStore simulates the pg-bound per-request store over the file backend");
    const root = await mkdtemp(join(tmpdir(), "browse-cap-bound-wording-"));
    try {
      const store = new ScopedFsStore(root, "proj_wording1");
      const userA = connector("user-a");

      await runWithProjectStore(store, async () => {
        await readImages(userA, Array.from({ length: IMAGE_BROWSE_CAP }, (_, i) => i + 1));
        const err = await checkImageBrowseCap(
          { imageId: img(IMAGE_BROWSE_CAP + 1) },
          undefined,
          "image_transcribe",
          userA,
        ).catch((e) => e);
        expect((err as Error).message).toMatch(
          /have already been read without a project under your account/,
        );
        expect((err as Error).message).not.toContain("server session");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
