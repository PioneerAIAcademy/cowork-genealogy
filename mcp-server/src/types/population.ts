// Pop Stats API Response Types
// GET {POP_STATS_BASE_URL}/population

export interface PopulationDataPoint {
  year: number;
  population: number;
  data_type: string;
}

export interface IndexedRecordDataPoint {
  period_start: number;
  period_end: number;
  records: number;
}

export interface ParentPlace {
  place_id: string;
  name: string;
}

export interface PopulationSourceEntry {
  source_url?: string;
  level?: string;
  place?: ParentPlace;
  data: PopulationDataPoint[];
}

export interface IndexedRecordsSourceEntry {
  description?: string;
  level?: string;
  place?: ParentPlace;
  data: IndexedRecordDataPoint[];
}

export interface PlaceInfo {
  place_id: string;
  name: string;
  level: string;
  parent?: ParentPlace;
}

export interface PopulationResponse {
  place: PlaceInfo;
  population?: Record<string, PopulationSourceEntry>;
  indexed_records?: Record<string, IndexedRecordsSourceEntry>;
}

// Tool Input Type

export interface PopulationToolInput {
  place_id: string;
  year?: number;
  year_start?: number;
  year_end?: number;
}
