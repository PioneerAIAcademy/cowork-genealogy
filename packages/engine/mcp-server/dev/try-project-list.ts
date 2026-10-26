import { projectList } from "../src/tools/project-list.js";

const result = await projectList();
console.log(JSON.stringify(result, null, 2));
