import { populationTool } from "../src/tools/population.js";

const place_id = process.argv[2] ?? "1927069";

const yearFlag = process.argv.indexOf("--year");
const startFlag = process.argv.indexOf("--year-start");
const endFlag = process.argv.indexOf("--year-end");

const year = yearFlag !== -1 ? Number(process.argv[yearFlag + 1]) : undefined;
const year_start = startFlag !== -1 ? Number(process.argv[startFlag + 1]) : undefined;
const year_end = endFlag !== -1 ? Number(process.argv[endFlag + 1]) : undefined;

const result = await populationTool({ place_id, year, year_start, year_end });
console.log(JSON.stringify(result, null, 2));
