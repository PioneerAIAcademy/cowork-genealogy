'use client';

import type { ResearchData, GedcomxData } from './lib/schema';
import { ScenarioDataProvider } from './ScenarioDataProvider';
import ProjectOverview from './components/sections/ProjectOverview';
import QuestionsSection from './components/sections/QuestionsSection';
import PlansSection from './components/sections/PlansSection';
import ResearchLogSection from './components/sections/ResearchLogSection';
import SourcesSection from './components/sections/SourcesSection';
import AssertionsSection from './components/sections/AssertionsSection';
import PersonEvidenceSection from './components/sections/PersonEvidenceSection';
import ConflictsSection from './components/sections/ConflictsSection';
import HypothesesSection from './components/sections/HypothesesSection';
import TimelinesSection from './components/sections/TimelinesSection';
import ProofSummariesSection from './components/sections/ProofSummariesSection';
import tokenStyles from './scenario-tokens.module.css';

/**
 * Read-only research-project viewer for the score-review screen. Lifted from
 * the cowork-genealogy-ui desktop app (see
 * docs/plan/eval-scoring-scenario-context.md). Renders the whole project as
 * one vertical stack of sections so a genealogist can see what has been
 * researched while judging the LLM's scores.
 *
 * `research`/`gedcomx` come straight from the run-log snapshot as parsed JSON;
 * we cast to the desktop app's schema types. Sections render defensively, so
 * any schema drift degrades to blank fields rather than a crash.
 */
export function ScenarioViewer({
  research,
  gedcomx,
}: {
  research: Record<string, unknown> | null;
  gedcomx: Record<string, unknown> | null;
}): React.JSX.Element {
  return (
    <div className={tokenStyles.scenarioViewer} style={{ padding: 16 }}>
      <ScenarioDataProvider
        research={(research as unknown as ResearchData) ?? null}
        gedcomx={(gedcomx as unknown as GedcomxData) ?? null}
      >
        <ProjectOverview />
        <QuestionsSection />
        <PlansSection />
        <ResearchLogSection />
        <SourcesSection />
        <AssertionsSection />
        <PersonEvidenceSection />
        <ConflictsSection />
        <HypothesesSection />
        <TimelinesSection />
        <ProofSummariesSection />
      </ScenarioDataProvider>
    </div>
  );
}
