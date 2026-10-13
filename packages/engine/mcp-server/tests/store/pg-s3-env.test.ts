import { describe, it, expect } from "vitest";
import { readPgS3Env } from "../../src/store/pg-s3-env.js";

// The GENEALOGY_* contract build/http.js starts from: DSN and bucket required,
// the S3 keys an optional pair (neither means the SDK default chain), region,
// endpoint and path style optional. An unset optional value is omitted, never
// passed on as "".

const BASE = { GENEALOGY_PG_DSN: "postgresql://u:p@h:1/d", GENEALOGY_S3_BUCKET: "projects" };

describe("readPgS3Env", () => {
  it("reports the two required variables when unset or empty", () => {
    expect(readPgS3Env({}).missing).toEqual(["GENEALOGY_PG_DSN", "GENEALOGY_S3_BUCKET"]);
    expect(readPgS3Env({ GENEALOGY_PG_DSN: "", GENEALOGY_S3_BUCKET: "" }).missing).toEqual([
      "GENEALOGY_PG_DSN",
      "GENEALOGY_S3_BUCKET",
    ]);
  });

  it("gives static credentials when both keys are set", () => {
    const r = readPgS3Env({ ...BASE, GENEALOGY_S3_ACCESS_KEY: "ak", GENEALOGY_S3_SECRET_KEY: "sk" });
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.backendOptions.s3).toMatchObject({ accessKeyId: "ak", secretAccessKey: "sk" });
  });

  it("omits both key fields when neither key is set, so the SDK default chain runs", () => {
    for (const env of [BASE, { ...BASE, GENEALOGY_S3_ACCESS_KEY: "", GENEALOGY_S3_SECRET_KEY: "" }]) {
      const r = readPgS3Env(env);
      expect(r.missing).toEqual([]);
      expect(r.backendOptions.s3).not.toHaveProperty("accessKeyId");
      expect(r.backendOptions.s3).not.toHaveProperty("secretAccessKey");
    }
  });

  it("reports the unset partner when exactly one key is set", () => {
    expect(readPgS3Env({ ...BASE, GENEALOGY_S3_ACCESS_KEY: "ak" }).missing).toEqual(["GENEALOGY_S3_SECRET_KEY"]);
    expect(readPgS3Env({ ...BASE, GENEALOGY_S3_SECRET_KEY: "sk" }).missing).toEqual(["GENEALOGY_S3_ACCESS_KEY"]);
    expect(
      readPgS3Env({ ...BASE, GENEALOGY_S3_ACCESS_KEY: "ak", GENEALOGY_S3_SECRET_KEY: "" }).missing,
    ).toEqual(["GENEALOGY_S3_SECRET_KEY"]);
  });

  it("omits the endpoint when unset or empty and defaults to virtual-hosted style", () => {
    for (const env of [BASE, { ...BASE, GENEALOGY_S3_ENDPOINT: "" }]) {
      const s3 = readPgS3Env(env).backendOptions.s3;
      expect(s3).not.toHaveProperty("endpoint");
      expect(s3.forcePathStyle).toBe(false);
    }
  });

  it("defaults to path style when an endpoint is set", () => {
    const s3 = readPgS3Env({ ...BASE, GENEALOGY_S3_ENDPOINT: "http://minio:9000" }).backendOptions.s3;
    expect(s3.endpoint).toBe("http://minio:9000");
    expect(s3.forcePathStyle).toBe(true);
  });

  it("lets GENEALOGY_S3_FORCE_PATH_STYLE override the default either way", () => {
    expect(
      readPgS3Env({ ...BASE, GENEALOGY_S3_ENDPOINT: "http://minio:9000", GENEALOGY_S3_FORCE_PATH_STYLE: "false" })
        .backendOptions.s3.forcePathStyle,
    ).toBe(false);
    expect(
      readPgS3Env({ ...BASE, GENEALOGY_S3_FORCE_PATH_STYLE: "true" }).backendOptions.s3.forcePathStyle,
    ).toBe(true);
  });

  it("reports a GENEALOGY_S3_FORCE_PATH_STYLE other than true or false as invalid", () => {
    for (const value of ["yes", "1", "TRUE", "False"]) {
      const r = readPgS3Env({ ...BASE, GENEALOGY_S3_FORCE_PATH_STYLE: value });
      expect(r.invalid, value).toEqual(["GENEALOGY_S3_FORCE_PATH_STYLE"]);
      expect(r.missing, value).toEqual([]);
    }
    expect(readPgS3Env({ ...BASE, GENEALOGY_S3_FORCE_PATH_STYLE: "" }).invalid).toEqual([]);
  });

  it("defaults the orphan sweep to hourly with a day's grace, and takes whole seconds", () => {
    expect(readPgS3Env(BASE).orphanSweep).toEqual({ intervalS: 3600, graceS: 86_400 });
    expect(
      readPgS3Env({ ...BASE, GENEALOGY_ORPHAN_SWEEP_INTERVAL_S: "", GENEALOGY_ORPHAN_GRACE_S: " " }).orphanSweep,
    ).toEqual({ intervalS: 3600, graceS: 86_400 });
    const r = readPgS3Env({ ...BASE, GENEALOGY_ORPHAN_SWEEP_INTERVAL_S: "0", GENEALOGY_ORPHAN_GRACE_S: " 7200 " });
    expect(r.invalid).toEqual([]);
    expect(r.orphanSweep).toEqual({ intervalS: 0, graceS: 7200 });
    expect(readPgS3Env({ ...BASE, GENEALOGY_ORPHAN_GRACE_S: "3600" }).orphanSweep.graceS).toBe(3600);
    // setTimeout's longest wait, and a grace far beyond it (a grace is never a timer).
    expect(readPgS3Env({ ...BASE, GENEALOGY_ORPHAN_SWEEP_INTERVAL_S: "2147483" }).orphanSweep.intervalS).toBe(2_147_483);
    expect(readPgS3Env({ ...BASE, GENEALOGY_ORPHAN_GRACE_S: "31536000" }).orphanSweep.graceS).toBe(31_536_000);
  });

  it("refuses an orphan sweep value that is not whole seconds, and a grace under an hour", () => {
    for (const value of ["abc", "-1", "NaN", "1e3", "3600.5", "0x10", "Infinity", "9".repeat(400)]) {
      for (const name of ["GENEALOGY_ORPHAN_SWEEP_INTERVAL_S", "GENEALOGY_ORPHAN_GRACE_S"]) {
        expect(readPgS3Env({ ...BASE, [name]: value }).invalid, `${name}=${value}`).toEqual([name]);
      }
    }
    // Past setTimeout's 2^31 - 1 ms the timer fires after 1 ms: passes would run back to back.
    for (const value of ["2147484", "31536000"]) {
      expect(readPgS3Env({ ...BASE, GENEALOGY_ORPHAN_SWEEP_INTERVAL_S: value }).invalid, value).toEqual([
        "GENEALOGY_ORPHAN_SWEEP_INTERVAL_S",
      ]);
    }
    for (const value of ["0", "60", "3599"]) {
      expect(readPgS3Env({ ...BASE, GENEALOGY_ORPHAN_GRACE_S: value }).invalid, value).toEqual([
        "GENEALOGY_ORPHAN_GRACE_S",
      ]);
    }
  });

  it("defaults the region to us-east-1 and takes an override", () => {
    expect(readPgS3Env(BASE).backendOptions.s3.region).toBe("us-east-1");
    expect(readPgS3Env({ ...BASE, GENEALOGY_S3_REGION: "" }).backendOptions.s3.region).toBe("us-east-1");
    expect(readPgS3Env({ ...BASE, GENEALOGY_S3_REGION: "us-west-2" }).backendOptions.s3.region).toBe("us-west-2");
  });
});
