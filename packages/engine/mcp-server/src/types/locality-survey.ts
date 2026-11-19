import type { CatalogSearchResult } from "./catalog-search.js";
import type { CollectionsSearchResult } from "./collection.js";
import type { PopulationResponse } from "./place-population.js";
import type { VolumeSearchResult } from "./volume-search.js";
import type { WikiCollectionNotice, WikiPageSection } from "./wikiPage.js";
import type { StoredCollectionRow } from "../utils/external-collections-store.js";

export interface LocalitySurveyInput {
  standardPlace: string;
  startYear?: number;
  endYear?: number;
  projectPath?: string;
}

/** One call the survey can make. `surveyCallPlan` lists every one a survey could make, climbs
 *  included, so a caller holding canned answers can pre-answer them all. */
export type SurveyCall =
  | { tool: "place_population"; args: { standardPlace: string; startYear?: number; endYear?: number } }
  | { tool: "collections_search"; args: { standardPlace: string; startYear?: number; endYear?: number } }
  | { tool: "volume_search"; args: { standardPlace: string; startYear?: number; endYear?: number; summary: true } }
  | { tool: "catalog_search"; args: { standardPlace: string } }
  | { tool: "external_links_search"; args: { standardPlace: string } }
  | { tool: "wiki_place_page"; args: { standardPlace: string; section: WikiPageSection } }
  | { tool: "wiki_read"; args: { url: string } };

/** A wiki page read whole: raw text (before the sidebar is stripped) and its Legacy notices. */
export interface SurveyPage {
  url: string;
  content: string;
  collectionNotices?: WikiCollectionNotice[];
}

/** What the survey calls. `server.ts` binds the live tools; the eval mock binds canned answers.
 *  A page dep returns null when the page does not exist and throws when it cannot be read. */
export interface SurveyDeps {
  population(args: { standardPlace: string; startYear?: number; endYear?: number }): Promise<PopulationResponse>;
  collections(args: { standardPlace: string; startYear?: number; endYear?: number }): Promise<CollectionsSearchResult>;
  volumes(args: { standardPlace: string; startYear?: number; endYear?: number; summary: true }): Promise<VolumeSearchResult>;
  catalog(args: { standardPlace: string }): Promise<CatalogSearchResult>;
  linkRows(standardPlace: string): Promise<{ rows: StoredCollectionRow[] } | { tooLarge: number }>;
  placePage(standardPlace: string, section: WikiPageSection, noticesBy: number): Promise<SurveyPage | null>;
  page(url: string, noticesBy: number): Promise<SurveyPage | null>;
  /** Stores one level's rows in the project, as `external_links_search` does. */
  recordLinks?(queriedPlace: string, rows: StoredCollectionRow[], tooLarge: boolean): Promise<void>;
  /** Stages the whole answer; returns its ref. */
  stage?(answer: Record<string, unknown>): Promise<string | null>;
  now?(): number;
  /** Test seam: the survey clock's length (default `SURVEY_DEADLINE_MS`). */
  deadlineMs?: number;
}

export type SurveyPart<T> = T | { error: string };
