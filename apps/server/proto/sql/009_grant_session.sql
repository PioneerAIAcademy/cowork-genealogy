-- U3: grant custody (docs/plan/familysearch-handoff.md, U3; list 3 step 19). Idempotent
-- like every file here: the web tier and the worker apply sql/*.sql at each start.
--
-- The web tier is the only refresher (proto/grants.py holds every statement that reads or
-- writes these columns, so the two tiers cannot drift):
--
--   session_started_at      when the CURRENT FamilySearch session began: set at sign-in and
--                           on every successful refresh (a refresh token starts a new
--                           session). A session dies at min(last use + 8 h, start + 24 h),
--                           so it is alive until start + 8 h whatever it was used for; the
--                           worker's start gate and the refresher's age both read this.
--                           Readers use COALESCE(session_started_at, granted_at): before
--                           009 only sign-in wrote a row, so granted_at IS the session start
--                           (the backfill below), and a pre-009 web instance's write during a
--                           rolling start still reads correctly.
--   refresh_started_at      the crash marker. Set by the refresher just before its HTTP
--                           call and cleared when it records the outcome; left set when the
--                           outcome is ambiguous (a timeout after FamilySearch may have
--                           processed it, or the web process died), since FamilySearch may
--                           already have revoked the stored access token. While it is set
--                           no attempt starts on the grant. Cleared by a sign-in.
--   refresh_refused_at      FamilySearch refused the refresh (or the stored ciphertext is
--   refresh_refused_reason  undecryptable): the patron must sign in again. Every attempt on
--                           the grant then ends signin_required. Cleared by a sign-in.
--
-- granted_at keeps U2's meaning (the sign-in) and expires_at keeps its write-only role.

ALTER TABLE familysearch_tokens ADD COLUMN IF NOT EXISTS session_started_at timestamptz;
ALTER TABLE familysearch_tokens ADD COLUMN IF NOT EXISTS refresh_started_at timestamptz;
ALTER TABLE familysearch_tokens ADD COLUMN IF NOT EXISTS refresh_refused_at timestamptz;
ALTER TABLE familysearch_tokens ADD COLUMN IF NOT EXISTS refresh_refused_reason text;

UPDATE familysearch_tokens SET session_started_at = granted_at WHERE session_started_at IS NULL;

-- The refresher's "this patron has an open turn" EXISTS (grants.DUE_SQL).
CREATE INDEX IF NOT EXISTS turns_open_project_idx ON turns (project_id) WHERE completed_at IS NULL;
