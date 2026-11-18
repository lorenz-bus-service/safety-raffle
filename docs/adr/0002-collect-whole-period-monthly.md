# Collect the whole raffle period at each monthly run; no daily job

The original plan was a daily job that stored the prior day's scores, to spread out the roughly 5,000 Samsara calls a month that the legacy per-driver endpoint needed. Samsara's newer `GET /safety-scores/drivers` endpoint returns every driver's score for a time window in one paginated request, so a month costs about 31 to 60 calls. We therefore collect the entire raffle period fresh every time the monthly job runs, and there is no daily job.

Daily collection would now be harmful as well as unnecessary: it stores scores before staff have reviewed safety events, and a later Revision would leave the stored score stale. Collecting at month end, a few days after the period closes, picks up Revisions in either direction with no special handling.

## Consequences

- One file per day is still written, as the record of what the Tickets were based on, not as a store that accumulates during the month.
- Samsara returns no scores, from either endpoint, for a Driver who has been deactivated. A Driver deactivated between driving and the monthly run therefore earns no Tickets for that period. This is accepted: at the organisation this was built for, deactivation means the person has left. Daily collection would be the only way to capture those scores, and was not judged worth a second scheduled job.
- The `collect` command accepts any date or range, so anyone who does want daily collection can schedule it themselves.
- This depends on the newer endpoint producing the same Tickets as the legacy one. That is verified with the `compare` command against a month produced by the old script; if the two disagree, this decision has to be revisited.
