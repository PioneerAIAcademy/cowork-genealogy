import { populationTool } from "../src/tools/place-population.js";

const standardPlace = process.argv[2] ?? "Nigeria";

const yearFlag = process.argv.indexOf("--year");
const startFlag = process.argv.indexOf("--startYear");
const endFlag = process.argv.indexOf("--endYear");

const year = yearFlag !== -1 ? Number(process.argv[yearFlag + 1]) : undefined;
const startYear = startFlag !== -1 ? Number(process.argv[startFlag + 1]) : undefined;
const endYear = endFlag !== -1 ? Number(process.argv[endFlag + 1]) : undefined;

const result = await populationTool({ standardPlace, year, startYear, endYear });
console.log(JSON.stringify(result, null, 2));
