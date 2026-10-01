/**
 * The rejection Node's global `fetch` really produces on a socket failure
 * (#3031): `TypeError("fetch failed")` whose `.cause` is an AggregateError with
 * an EMPTY message, the socket code one level further down. A plain
 * `new Error("ECONNREFUSED")` prints the same through `err.message` as through
 * `describeFetchError`, so it cannot tell a site that walks the cause from one
 * that drops it. Returns a fresh error per call.
 */
export function socketFetchFailure(): TypeError {
  return Object.assign(new TypeError("fetch failed"), {
    cause: new AggregateError(
      [Object.assign(new Error("connect ETIMEDOUT 208.111.35.209:443"), { code: "ETIMEDOUT" })],
      "",
    ),
  });
}
