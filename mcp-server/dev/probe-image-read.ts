/**
 * Probe script: test FamilySearch image endpoints with a real token.
 *
 * Usage:
 *   npx tsx dev/probe-image-read.ts "<image-url>"
 *
 * What this tells you:
 *   - Does adding auth actually fix the 401?
 *   - What Content-Type does the endpoint return?
 *   - How large is the image?
 */

import { getValidToken } from "../src/auth/refresh.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npx tsx dev/probe-image-read.ts <image-url>");
  process.exit(1);
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

console.log("Getting token...");
const token = await getValidToken();
console.log("Token OK.\n");

const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "image/*,*/*",
    "User-Agent": USER_AGENT,
  },
});

console.log("Status:      ", response.status, response.statusText);
console.log("Content-Type:", response.headers.get("content-type"));
console.log("Content-Length:", response.headers.get("content-length") ?? "(not set)");

if (!response.ok) {
  const body = await response.text();
  console.log("\nError body:", body);
  process.exit(1);
}

const buffer = await response.arrayBuffer();
console.log("Actual size: ", buffer.byteLength, "bytes");

const contentType = response.headers.get("content-type") ?? "";
if (contentType.startsWith("image/")) {
  console.log("\nSuccess — image received.");
  console.log("Size:", (buffer.byteLength / 1024).toFixed(1), "KB");
} else {
  console.log("\nWARNING: response is not an image. First 500 chars:");
  console.log(new TextDecoder().decode(buffer).slice(0, 500));
}
