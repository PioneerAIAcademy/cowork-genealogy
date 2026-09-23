-- research-as-a-job 0a: bound the retry on a resumed attempt that does no work.
-- Additive and idempotent like 001-004 -- applied by initdb on an empty volume AND by the
-- worker at start (proto/worker/worker.py), so a volume that predates this file gets the
-- column without a `make proto-down`.
--
-- turns.zero_progress_attempts: how many CONSECUTIVE redelivered attempts of this turn
-- ran no model turn and recorded no tool call. The worker bumps it on such an attempt and
-- clears it the moment an attempt records its first tool call -- at the call, not at
-- completion, so an attempt killed at the step ceiling AFTER doing real work does not
-- leave a stale count for the next redelivery to trip over. At ZERO_PROGRESS_CAP the
-- worker stops re-running the model and closes the turn with outcome 'no_progress'.
--
-- Why a column and not receive_count: a read timeout requeues and SQS increments
-- receive_count too, so it counts a healthy ceiling crossing and a deterministic failure
-- with the same number -- and under continuous work the median run crosses it twice and
-- the longest in the corpus six times. Any cap safe at p90 is 4 or more and bounds
-- nothing; any cap that bounds the loop kills the 39% of healthy runs needing three
-- attempts. elasticmq.conf records the same reason for having no redrive policy.

ALTER TABLE turns ADD COLUMN IF NOT EXISTS zero_progress_attempts int NOT NULL DEFAULT 0;
