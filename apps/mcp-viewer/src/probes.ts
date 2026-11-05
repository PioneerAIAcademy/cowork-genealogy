import type { ImageLink, ProjectDocument } from './contract'

// 1.3M puts a result just past the largest project's 1.55 MB research.json, once
// the project's own ~300 KB rides along.
export const SIZE_LADDER = [400_000, 1_000_000, 1_300_000, 2_000_000] as const

export const FALLBACK_IMAGE_REF = 'images/probe.jpg'

export interface SizeProbe {
  id: number
  chars: number
  status: 'running' | 'ok' | 'failed'
  ms?: number
  received?: number
  message?: string
  code?: string
}

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
