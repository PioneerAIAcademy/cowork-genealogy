import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResearchData, useResearchDataOptional } from '../ResearchDataContext'

// The chat pane needs to resolve schema ids, but it renders on a DIFFERENT condition
// than the viewer does (SessionView renders ChatPane on `conn`, the viewer on
// `transport`). So a chat that called the throwing accessor would crash whenever the
// viewer is absent. The optional accessor is what lets an id degrade to plain text
// instead of taking the pane down.

describe('useResearchDataOptional', () => {
  it('returns null outside a provider instead of throwing', () => {
    const { result } = renderHook(() => useResearchDataOptional())
    expect(result.current).toBeNull()
  })

  it('the strict accessor still throws, so existing callers keep their guarantee', () => {
    expect(() => renderHook(() => useResearchData())).toThrow(/ResearchDataProvider/)
  })
})
