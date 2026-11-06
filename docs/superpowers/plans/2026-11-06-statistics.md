# User-owned statistics

User delegated implementation details and confirmed all reports must be scoped to their own data.

- [x] Add read-only overview and per-auction reports behind existing authentication/ownership checks.
- [x] Reuse undo snapshots for winning contributions and the losing team's last confirmed bid; never treat editable drafts as confirmed bids. Missing historical detail stays explicitly unavailable.
- [x] Add Statistics as the last tab, preserve login deep links, and inherit existing parchment/table styles with Turkish/English copy and loading/error/empty states.
- [x] Verify ownership, confirmed-vs-draft amounts, no-bid cases, sale undo, old records, full tests, types and responsive rendering.

No new dependency, schema migration, tracking system, cross-user metrics or export feature. Overview counts active owned library records; auction summaries include owned drafts/ongoing/completed auctions. Per-auction reports include settled sales in ongoing auctions, team spending/balances and individual spending.

## Verification

- New API tests observed failing before implementation, then passing (3 tests); web transport, navigation/deep links and report rendering covered (5 tests).
- `pnpm typecheck` and both package builds passed.
- With `DATABASE_URL` and `AUTH_TEST_DATABASE_URL` explicitly pointing to a newly created local disposable database: `pnpm --filter odi-bid-battle-api --filter odi-bid-battle-web test --maxWorkers=2 --minWorkers=1 --testTimeout=30000` passed: API 313, web 142, total 455 tests.
- Default full-suite runs initially exposed missing database configuration, then resource-sensitive auth test timeouts/deadlocks. The auth suite passed independently; the full suite passed with bounded workers and a longer test timeout, without changing application code or test configuration.
- Real browser login retained the statistics deep link. Draft selection showed the empty-sales state; simulated server failure recovered with Retry; TR/EN switching worked. Desktop 1440px and mobile 390px captures showed no page overflow.
- Impeccable detector returned no findings. Independent read-only review disposition: **ship**, with no material fixes; incumbent visual system preserved.
- Production deployment, physical projector and large-history load testing were not performed. Historical details cannot be reconstructed if undo snapshots are missing; the UI explicitly reports that limitation.
