export interface RecordAttachmentsInput {
  uris: string[];
}

export interface AttachedPersonRaw {
  contributorId: string;
  entityId: string;
  modified: number;
  tags: string[];
  tfEntityRefId: string;
}

export interface AttachmentEntryRaw {
  persons: AttachedPersonRaw[];
  sourceId: string;
}

export interface RecordAttachmentsApiResponse {
  attachedSourcesMap: Record<string, AttachmentEntryRaw[]>;
}

export interface AttachedPerson {
  personId: string;
  tags: string[];
}

export interface RecordAttachmentsResult {
  attachments: Record<string, AttachedPerson[]>;
  unattached: string[];
}
