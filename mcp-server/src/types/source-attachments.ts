export interface SourceAttachmentsInput {
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

export interface SourceAttachmentsApiResponse {
  attachedSourcesMap: Record<string, AttachmentEntryRaw[]>;
}

export interface AttachedPerson {
  personId: string;
  tags: string[];
}

export interface SourceAttachmentsResult {
  attachments: Record<string, AttachedPerson[]>;
  unattached: string[];
}
