// A stand-in for @fs/sas-client (U29), for tests/http/http-entrypoint-exit.test.ts.
// The test writes node_modules/@fs/sas-client/index.js re-exporting this file
// into a temp dir and puts that on NODE_PATH (a committed node_modules is
// gitignored). getSecureObject returns FAKE_SAS_OBJECT_JSON, or rejects with
// code FAKE_SAS_ERROR_CODE when that is set.
"use strict";

class SasClient {
  async getSecureObject(name) {
    if (process.env.FAKE_SAS_ERROR_CODE) {
      throw Object.assign(new Error(`fake SAS refused ${name}`), { code: process.env.FAKE_SAS_ERROR_CODE });
    }
    return JSON.parse(process.env.FAKE_SAS_OBJECT_JSON);
  }

  clearCache() {}
}

module.exports = SasClient;
