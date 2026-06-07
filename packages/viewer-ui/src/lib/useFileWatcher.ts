// This hook is a thin wrapper that connects the preload API listeners
// to the ResearchDataContext. The actual listener registration and state
// management lives in ResearchDataContext.tsx. This hook exists for
// components that just need the data without the full context API.

export { useResearchData } from '../contexts/ResearchDataContext'
