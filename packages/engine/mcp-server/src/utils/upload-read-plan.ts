// How a caller reads each uploaded file, stated by project_context so no agent
// has to work it out from `uploadUrl`, `hasText` and the file name. One function,
// run by the tool and by the eval mock (eval/harness/harness/mock_mcp.py), which
// adds `uploadUrl` after the tool has answered.

export interface UploadRow {
  name: string;
  uploaded: string;
  hasText: boolean;
  /** On a stored project: the tool that reads this upload. */
  readWith?: "sidecar_read" | "image_transcribe";
  /** With `readWith: "sidecar_read"`: the ref to pass. */
  ref?: string;
}

export interface UploadReadPlan {
  /** "files": the uploads are files in the project folder. "stored": they are in
   *  the hosted store and are read through the tools. Absent with no uploads. */
  uploadsAre?: "files" | "stored";
  uploads: UploadRow[];
}

/** `hosted` is whether the project serves an `uploadUrl`. A folder project's rows
 *  carry no `readWith`: its callers do not agree on one reader for an image
 *  (search-external-sites reads the file, translation transcribes it). */
export function uploadReadPlan(rows: readonly UploadRow[], hosted: boolean): UploadReadPlan {
  const bare = rows.map(({ name, uploaded, hasText }) => ({ name, uploaded, hasText }));
  if (bare.length === 0) return { uploads: [] };
  if (!hosted) return { uploadsAre: "files", uploads: bare };
  return {
    uploadsAre: "stored",
    uploads: bare.map((row) => {
      if (row.hasText) return { ...row, readWith: "sidecar_read" as const, ref: `uploads/${row.name}.txt` };
      if (row.name.toLowerCase().endsWith(".txt")) {
        return { ...row, readWith: "sidecar_read" as const, ref: `uploads/${row.name}` };
      }
      return { ...row, readWith: "image_transcribe" as const };
    }),
  };
}
