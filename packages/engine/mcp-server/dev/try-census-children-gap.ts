import { censusChildrenGap } from "../src/tools/census-children-gap.js";

const result = censusChildrenGap({
  censuses: [
    { year: 1900, childrenBorn: Number(process.argv[2] ?? 6), childrenLiving: Number(process.argv[3] ?? 5) },
    { year: 1910, childrenBorn: Number(process.argv[4] ?? 8), childrenLiving: Number(process.argv[5] ?? 7) },
  ],
  knownChildren: ["1886", "1888", "1891", "1894", "1897", "1906"].map((birthDate) => ({ birthDate })),
});
console.log(JSON.stringify(result, null, 2));
