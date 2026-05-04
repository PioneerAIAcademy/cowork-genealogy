/**
 * Refresh and print a valid FamilySearch access token.
 * Used to populate $FS_TOKEN for curl-based exploration.
 * Output: just the token, no extra text. Don't echo to terminal in shared sessions.
 */
import { getValidToken } from "../src/auth/refresh.js";

const token = await getValidToken();
process.stdout.write(token);
