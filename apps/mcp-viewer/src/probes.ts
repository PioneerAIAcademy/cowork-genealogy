import type { ImageLink, ProjectDocument } from './contract'

export const FALLBACK_IMAGE_REF = 'images/probe.jpg'

export interface ImageProbe {
  ref: string
  status: 'asking' | 'refused' | 'showing' | 'loaded' | 'failed'
  url?: string
  expiresAt?: number
  message?: string
  width?: number
  height?: number
}

export function imageProbeRef(snapshot: ProjectDocument | null): string {
  const sources = snapshot?.research?.sources
  const found = Array.isArray(sources) ? sources.find((source) => typeof source?.image_filename === 'string') : undefined
  return (found?.image_filename as string | undefined) ?? FALLBACK_IMAGE_REF
}

export function isImageLink(value: unknown): value is ImageLink {
  return typeof (value as ImageLink | null | undefined)?.url === 'string'
}
