/**
 * Trigger the FamilySearch OAuth login flow.
 * Opens your browser for authorization.
 *
 * Usage: npx tsx dev/try-login.ts
 */

import { performLogin } from "../src/auth/login.js";

performLogin()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((err) => console.error(err.message));
