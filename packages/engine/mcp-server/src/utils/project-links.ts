// The web tier's upload link for the project the bound store serves, on
// `project_context`.
//
// The id is the store's `projectId`, never derived from `projectPath`: on the hosted
// worker path every project arrives under the same anchor path (`/project`). A store
// with no id (the file backend) gets no link, which is right on the desktop.

import type { Principal } from "../auth/principal.js";
import { loadConfig } from "../auth/config.js";
import { getProjectStore } from "../store/project-store.js";

export interface ProjectLinks {
  /** `<webPublicUrl>/upload/<id>`, the web tier's upload page (#4001) — only when `uploadsEnabled`. */
  uploadUrl?: string;
}

export async function projectLinks(principal: Principal): Promise<ProjectLinks> {
  const id = getProjectStore().projectId;
  if (!id) return {};
  const config = await loadConfig(principal);
  const base = typeof config.webPublicUrl === "string" ? config.webPublicUrl.trim().replace(/\/+$/, "") : "";
  if (!base || config.uploadsEnabled !== true) return {};
  return { uploadUrl: `${base}/upload/${id}` };
}
