// The web tier's upload link for the project the bound store serves, on
// `project_context`.
//
// The id is the store's `projectId`, never derived from `projectPath`: on the hosted
// worker path every project arrives under the same anchor path (`/project`). A store
// with no id (the file backend) gets no link, which is right on the desktop.

import type { Principal } from "../auth/principal.js";
import { loadConfig } from "../auth/config.js";
import { getProjectStore } from "../store/project-store.js";
import type { AppConfig } from "../types/auth.js";

export interface ProjectLinks {
  /** `<webPublicUrl>/#/p/<id>/upload` — only when `uploadsEnabled`. */
  uploadUrl?: string;
}

/** `webPublicUrl` with no trailing slash, or `""` when it is unset. */
export function webPublicBase(config: AppConfig): string {
  return typeof config.webPublicUrl === "string" ? config.webPublicUrl.trim().replace(/\/+$/, "") : "";
}

export async function projectLinks(principal: Principal): Promise<ProjectLinks> {
  const id = getProjectStore().projectId;
  if (!id) return {};
  const config = await loadConfig(principal);
  const base = webPublicBase(config);
  if (!base || config.uploadsEnabled !== true) return {};
  return { uploadUrl: `${base}/#/p/${id}/upload` };
}
