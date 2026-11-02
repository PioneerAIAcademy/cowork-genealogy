import { projectList } from "../src/tools/project-list.js";
import { LOCAL } from "../src/auth/principal.js";

const result = await projectList(LOCAL);
console.log(JSON.stringify(result, null, 2));
