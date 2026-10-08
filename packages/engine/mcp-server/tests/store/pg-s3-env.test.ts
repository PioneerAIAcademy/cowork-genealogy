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

  it("defaults the region to us-east-1 and takes an override", () => {
    expect(readPgS3Env(BASE).backendOptions.s3.region).toBe("us-east-1");
    expect(readPgS3Env({ ...BASE, GENEALOGY_S3_REGION: "" }).backendOptions.s3.region).toBe("us-east-1");
    expect(readPgS3Env({ ...BASE, GENEALOGY_S3_REGION: "us-west-2" }).backendOptions.s3.region).toBe("us-west-2");
  });
});
