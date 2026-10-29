/**
 * Live accuracy check: transcribe every fixture page and score it against its
 * human-verified key by character error rate (edit distance / key length, after
 * collapsing whitespace). Calls FamilySearch and OpenRouter; not run in CI.
 *
 *   FS_TOKEN=... OPENROUTER_API_KEY=... npm run eval:transcribe-image
 *
 * Either value falls back to ~/.familysearch-mcp/ (tokens.json, config.json).
 * OPENROUTER_MODEL overrides the model.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openRouterLlm } from "../shared/llm.js";
import { transcribeImage } from "./index.js";

interface Case {
  slug: string;
  ark: string;
  key: string;
}

const FIXTURES = join(import.meta.dirname, "fixtures");

function fromHomeFile(file: string, field: string): string | undefined {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".familysearch-mcp", file), "utf-8"))[field];
  } catch {
    return undefined;
  }
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

export function characterErrorRate(candidate: string, key: string): number {
  const a = normalize(candidate);
  const b = normalize(key);
  let prev = Uint32Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] / Math.max(1, b.length);
}

async function main() {
  const fsToken = required("FS_TOKEN", process.env.FS_TOKEN ?? fromHomeFile("tokens.json", "accessToken"));
  const apiKey = required(
    "OPENROUTER_API_KEY",
    process.env.OPENROUTER_API_KEY ?? fromHomeFile("config.json", "openRouterApiKey"),
  );
  const llm = openRouterLlm({ apiKey, model: process.env.OPENROUTER_MODEL });
  const { cases } = JSON.parse(readFileSync(join(FIXTURES, "fixtures.json"), "utf-8")) as { cases: Case[] };

  const rates: number[] = [];
  for (const c of cases) {
    const key = readFileSync(join(FIXTURES, c.key), "utf-8");
    const started = Date.now();
    try {
      const out = await transcribeImage({ ark: c.ark }, { fsToken, llm });
      const cer = characterErrorRate(out.text, key);
      rates.push(cer);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${c.slug}  CER ${(cer * 100).toFixed(1)}%  ${secs}s${out.truncated ? "  TRUNCATED" : ""}`);
    } catch (error) {
      console.log(`${c.slug}  ERROR ${(error as Error).message}`);
    }
  }
  if (rates.length === 0) process.exit(1);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  console.log(`\nmean CER ${(mean * 100).toFixed(1)}% over ${rates.length} of ${cases.length} pages`);
  if (rates.length < cases.length) process.exit(1);
}

if (process.argv[1] === import.meta.filename) await main();
