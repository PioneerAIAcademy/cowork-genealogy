import type { BrowseBudgetAdvisory } from "../utils/browse-budget.js";

/** One probe already taken. `year: null` means "probed, no year found" — see the
 *  spec §3 for why that case must be representable. */
export interface VolumeBisectReading {
  /** Index into the sub-volume's own ordered image list. */
  position: number;
  /** The imageId that position named when it was probed. Re-checked on every
   *  call, because `image_search`'s null-drop defect shifts positions. */
  imageId: string;
  year: number | null;
}

export interface VolumeBisectInput {
  /** A split Natural Group name from volume_search, `{prefix}_{part}_{naturalId}`. */
  imageGroupNumber: string;
  targetYear: number;
  readings?: VolumeBisectReading[];
  projectPath?: string;
}

export type VolumeBisectConfidence =
  | "converging"
  | "inconclusive"
  | "non-monotonic"
  | "resolved";

export interface VolumeBisectBracket {
  lowPosition: number;
  lowYear: number | null;
  highPosition: number;
  highYear: number | null;
}

export interface VolumeBisectResult {
  bracket: VolumeBisectBracket;
  confidence: VolumeBisectConfidence;
  /** Absent once the tool has stopped. */
  nextImageId?: string;
  /** The probe this call took, for the caller to echo back in `readings`. */
  reading?: VolumeBisectReading;
  browseBudget?: BrowseBudgetAdvisory;
  /** Present with a reason when the tool declines to continue. */
  stopped?: string;
}
