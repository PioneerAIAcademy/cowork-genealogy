import { FsProjectStore } from "../../src/store/fs-project-store.js";
import { getProjectStore, setProjectStore, type ProjectStore } from "../../src/store/project-store.js";

/** True under `PROTO_STORE=pg` (U15): the process store is PgRoutingStore. */
export const ON_PG = process.env.PROTO_STORE === "pg";

/**
 * Run the calling test on the file store even under `PROTO_STORE=pg`, for a
 * case that asserts file-system behaviour with no Postgres meaning (a symlink,
 * a directory where a file was expected, an unreadable folder, nesting, the
 * atomic-rename seam, a document that is not JSON). The case still runs — it is
 * not a skip — but on `FsProjectStore`, and `reason` says why. The setup file
 * reinstalls the routing store after the test. A no-op on the file store.
 *
 * `grep -rn fileStoreOnly tests/` lists every such case.
 */
export function fileStoreOnly(reason: string): void {
  if (!reason) throw new Error("fileStoreOnly needs a reason");
  if (ON_PG) setProjectStore(new FsProjectStore());
}

/**
 * The store a fault-injecting double should wrap: the routing store under
 * `PROTO_STORE=pg`, so the injected fault sits in front of PgS3ProjectStore,
 * and a fresh file store otherwise. Call it inside the test, where the setup
 * file has installed the router.
 */
export function backingStore(): ProjectStore {
  return ON_PG ? getProjectStore() : new FsProjectStore();
}
