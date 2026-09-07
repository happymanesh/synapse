@AGENTS.md

For the full product brief — what Synapse is, its data model, architecture rules, feature
spec, build order and the traps that cost real debugging time — see **[REBUILD.md](REBUILD.md)**.
It is written to be self-contained enough to recreate the project from an empty directory.
The rules below are the day-to-day conventions; REBUILD.md is the why behind them.

## Conventions

### Database changes — never `migrate dev` or `db push`

This database contains `sample_sales`, a hand-created table that is **not** a Prisma model. Both `prisma migrate dev` and `prisma db push` plan to drop it. Apply every schema change this way instead:

```bash
# 1. edit prisma/schema.prisma
# 2. hand-write prisma/migrations/<yyyymmddhhmmss>_<name>/migration.sql
npx prisma db execute --file prisma/migrations/<name>/migration.sql
npx prisma migrate resolve --applied <name>
npx prisma generate
```

`prisma db execute` takes no `--schema` flag — it reads `prisma.config.ts`. Prefer `ADD COLUMN IF NOT EXISTS` for columns on unmanaged tables so existing databases upgrade in place.

**After `prisma generate`, restart the dev server** (kill the process, delete `.next`, restart). A running `next dev` keeps the old Prisma client in memory, so new models appear "missing" at runtime while the code type-checks fine.

### Report SQL is read-only, and scoped by the engine

Report/filter query text is administrator-authored and executed dynamically, so two controls sit under it. Neither is optional.

- **`assertSelectOnly()` runs before every admin-authored template executes** — `bindReportTemplate()` is the only sanctioned entry point, and `runParameterizedQuery` / `countParameterizedQuery` / `bindAndWrapWithOwnership` all route through it. It rejects anything not starting with SELECT/WITH, anything after a `;`, and data-modifying constructs *anywhere* — including inside a CTE, because Postgres genuinely permits `WITH x AS (DELETE … RETURNING *)`. Keyword matching is by syntactic shape (`DELETE\s+FROM`), not bare words, so `SELECT start, last_update FROM t` still works.
- **Reads use `prismaReadOnly`; only engine-built writes use `prisma`.** `runBoundQuery` is the read path, `runWriteQuery` the write path — if you add a FORM-mode write, use the latter or it will fail against the read-only role. Set `DATABASE_URL_READONLY` to a role with no write grants; without it the connection falls back to the main one and only the application-level guard protects you (`REPORT_DB_IS_READONLY` reports which).
- **Scoping is applied by the engine, not by the query author.** `withSessionParams()` overlays reserved `:SESSION_COMPANY` / `:SESSION_HIERARCHY` / `:SESSION_USER` / `:SESSION_USER_UID` params *last*, so a submitted value can never spoof identity. Setting `ReportDefinition.companyScopeColumn` makes `applyCompanyScope()` wrap the result exactly as FORM mode wraps ownership. **Run and export must apply identical scoping** — otherwise a restricted report widens simply by being downloaded.

Pure logic lives in `src/lib/sql-core.ts` and `src/lib/menu-core.ts` (no `server-only`, no Prisma import) so it can be unit tested; `report-sql.ts`, `menu.ts` and `user-shell.ts` are the DB-backed layers around them. Any new access or scoping *rule* belongs in a `-core` module with a test, not inline in a query. Run `npm test`.

### Session validity

`getSession()` is the only place a request's identity is established, and it re-checks `UserDetails.isActive` on every call (memoised per request with React `cache()`). The session JWT stays cryptographically valid for its full 8 hours, so without that check, deactivating someone in User Master would not take effect until their token expired. Never decode the session cookie directly to bypass it, and don't move the active-user check out to individual call sites — it will be forgotten on the next route someone adds.

### Download file naming

Every file this app lets a user download (CSV exports today; any future export/report/document download) is named:

```
{username}_{timestamp}.{ext}
```

e.g. `Admin001_20260726-143005.csv`. Username and timestamp are separated by a single underscore; the timestamp itself uses `YYYYMMDD-HHMMSS` (dash inside, so it doesn't introduce a second ambiguous underscore).

Use `buildDownloadFilename(username, ext)` from `src/lib/download.ts` for this — don't invent a new naming scheme per feature. The username comes from the current session (`getSession()` in `src/lib/session.ts`), fetched server-side in the page and passed down as a `currentUsername` prop to whatever renders the download button (see `AdminCrudTable`'s `currentUsername` prop for the existing pattern).

### User-owned records: mandatory ownership + audit columns

Any table that end users add/edit their own records into (as opposed to admin-managed master data) must have `createdBy`, `updatedBy`, and `updatedOn` columns, populated from the current session on every write. List views for these tables must filter to the current user's own records (`createdBy = session.username`, or the equivalent ownership field) unless the user has an explicit elevated-visibility right — never show other users' records by default. This came up first for the dynamic-form/report engine's saved records, but applies to every future user-editable table, not just that one.

### Date/number column formatting and sorting

Every report/results table in this app formats and sorts columns by their declared `dataType` (`TEXT | NUMBER | DATE | DATETIME` on `ReportColumn`), never by guessing from the raw value or by comparing formatted text:

- `DATE` columns display as `dd-Mmm-yy` (e.g. `26-Jul-26`), center-aligned.
- `DATETIME` columns display as `dd-Mmm-yy hh:mm` (e.g. `26-Jul-26 14:30`), center-aligned.
- **Seconds are not part of the default.** They are noise on a business date and only earn
  their place where events can land inside the same minute and their *order* matters — the
  ticket audit trail, and the timestamps behind a merge. Use `formatDateTimeSeconds()`
  (`dd-Mmm-yy hh:mm:ss`) there, and only there.
- `NUMBER` columns are right-aligned; set `decimalPlaces` on the column (e.g. `2` for an amount) to force that many decimals.
- `TEXT` columns are left-aligned (the default).
- Sorting a `DATE`/`DATETIME` column always compares the underlying `Date` value, never the formatted string — sorting text like `"26-Jul-2026"` alphabetically would sort by month name, not chronologically.

Use `formatCellByType()`, `alignmentForType()`, `compareByType()`, and `formatDateTime()` / `formatDateTimeSeconds()` from `src/lib/report-format.ts` for this — don't reimplement date/number formatting or sorting per report or per table. This applies to any tabular report/list in the app, not just the dynamic report engine's `ResultsTable`.

### Report drill-down

Any `ReportColumn` can drill into another report by setting `drillDownReportId`, `drillDownTargetParam`, `drillDownMode` (`PAGE`, labeled "Normal" in the admin UI and the default | `MODAL`, labeled "Popup"), and `drillDownModalSize` (`AUTO | SMALL | MEDIUM | LARGE`, `MODAL` only) via the Report Master's column editor. Clicking a drillable cell renders it as a link (`ResultsTable`'s `onDrillDown`) and either navigates to the target report's page with a "← Back" link (`PAGE`/Normal) or opens it in a sized popup (`MODAL`/Popup, via `DrillDownModal`) — see `ReportRunner`'s `handleDrillDown`. Either way, the target report's own filter section is hidden — `ReportRunner`'s `hideFilterPanel` is `!!backLink || !!isEmbeddedInModal`, **not** `!!autoShow`: its values are already resolved by the drill, so showing an editable filter form again would just be redundant.

- **Why `hideFilterPanel` isn't keyed off `autoShow`.** `autoShow` also turns on for the *return* case: `handleShow` syncs the current filter values into the report's own URL (`router.replace`, preserving any existing `drillFrom`/`drillFromTitle` params) so that a PAGE-mode "← Back" navigation — which fully re-mounts the page — lands on a URL that reproduces the exact last-shown state instead of a blank form. That restored report has `autoShow=true` (it has values to auto-run) but must still show its own filter panel, so `hideFilterPanel` keys off `backLink` (only ever set for a genuine drill landing) and the explicit `isEmbeddedInModal` flag (always true for `DrillDownModal`'s nested `ReportRunner`, which must never call `router.replace` itself — it isn't the routed page).
- **Target param — plain string vs. JSON discriminator.** Most columns just name one target filter component code directly (e.g. `"SALES_PRODUCT"`). If a column's meaning depends on another filter in the *same* report (e.g. a summary report's single "Product / Region" column, grouped by whichever the user picked), store a JSON discriminator map instead: `{"__discriminator":"SALES_SUMMARY_TYPE","PRODUCT":"SALES_DETAIL_PRODUCT","REGION":"SALES_DETAIL_REGION"}` — the *current* value of the named discriminator filter picks which target param the cell's value actually goes into. `resolveDrillTargetParam()` in `ReportRunner.tsx` implements this; a value that doesn't start with `{` is always treated as the plain-string case.
- **Filter carry-over is automatic, not configured.** The parent report's entire current filter-value set is forwarded to the target (as query params in `PAGE` mode, as `initialValues` in `MODAL` mode) — the target report simply ignores any key that isn't one of its own filter items' component codes (`getReportDefinitionView` + the `[reportId]/page.tsx` route do this filtering). This is *why* a summary and its detail report should reuse the same component code for anything meant to carry over (e.g. both use `SALES_COMPANY`/`SALES_DATE_RANGE`, not separately-named equivalents) — there is no explicit source→target field mapping to configure.
- **`MODAL` sizing**: `AUTO` sizes the popup off the drilled-into report's own result (`ReportRunner`'s `onResultLoaded` callback) — small/medium/large break on column and row count. A fixed `SMALL`/`MEDIUM`/`LARGE` overrides that regardless of data.
- The drilled-into report is a completely ordinary `ReportDefinition` — it doesn't need a menu entry at all if it's only ever reached via drill-down (see `SALES_DETAIL`, invoked only from `SALES_SUMMARY`'s `group_value` column).

### Multi-app (App Master)

The product hosts several apps per company (`AppMaster`, managed at `/admin/apps`). **App access is never stored — it's derived**: `user → active roles → role_menu_map → menu → menu.appCode` (`getAppsForUser` in `src/lib/apps.ts`). Granting a role a menu therefore automatically grants the app that menu belongs to; there is deliberately no user↔app or role↔app mapping table to keep in sync.

- **`MenuMaster.appCode` is nullable, and NULL means global** — the menu shows in *every* app. Administration is seeded this way on purpose: scoping it to one app would let an admin switch app and lose access to App Master itself. A NULL-app menu grants no app on its own (it can't, since it belongs to none).
- **`getAccessibleMenuCodes()` is the single source of truth** shared by `getMenuForUser` and `getAppsForUser`, so "menus I can see" and "apps I can open" can never drift apart. `getMenuForUser(uid, appCode)` then narrows to `appCode = <app> OR appCode IS NULL`.
- **The active app is resolved server-side, per request**, in `(app)/layout.tsx` — `resolveActiveApp()` returns the user's `lastAppCode` if they still have access to it (it may have been deactivated or their role revoked), else their first app. Everything downstream keys off the resulting `menuItems`: the sidebar, the top-bar search index (`flattenMenu` in `AppShellClient`), and `/api/favorites` (which filters to the active app's menus + globals). Add a new app-aware surface by deriving it from `menuItems`/the active app, not by re-querying menus unscoped.
- **Switching apps writes `UserDetails.lastAppCode`** via `POST /api/apps/select` (which re-checks access server-side), so the next login reopens the same app. `AppSwitcher` then `router.push("/dashboard") + router.refresh()` — the menu tree lives in a server component, so a refresh is what actually swaps it. With the sidebar's "New window" toggle on it `window.open`s a new tab instead; the selection is persisted either way, since a new tab has no other way to learn which app to start in.

### Menu usage logging

Every menu selection is logged to `MenuUsageLog` and kept for **7 days** (`MENU_USAGE_RETENTION_DAYS`), feeding the "Frequently used options" strip on the dashboard.

- **The write sits on the click path, so it is built to be cheap and unblocking.** `logSelection()` (from `useMenuUsage()`) posts with `keepalive: true`, is never awaited, and swallows failures — logging must never delay or break navigation. `keepalive` is what lets the request outlive the route change that immediately follows it.
- **The table has no foreign keys and denormalises company/app/menu names on purpose**: inserts skip constraint checks, and a row stays meaningful after the menu or user it names is deleted. Don't "fix" this by adding relations.
- **The client supplies the menu's position** (`mainMenu`/`subMenu`) from the tree it already holds. Re-deriving it server-side would mean running the roles→menus chain on every click — exactly the cost this avoids. It is not a trust boundary: identity always comes from the session, never the body, and the log grants nothing.
- **Retention needs no cron** — same reasoning as notification scheduling. Reads filter by the cutoff (so the window is correct even if a purge is late) and `recordMenuSelection` purges at most once an hour per process.
- **Top-N groups by `menuCode`, then joins back to `menu_master` for display.** Grouping by the denormalised name would split a menu's history when it's renamed; the join also drops menus that have since been deleted or deactivated, so the dashboard can't render a dead card. It over-fetches (`limit * 3`) before filtering so it still returns a full list.

### Notifications

Admins compose a `Notification` (`/admin/notifications`) targeted at either a whole `HIERARCHY` (`targetHierarchyCode`) or one specific `USER` (`targetUserUid`) — there is no fixed recipient list stored anywhere; `GET /api/notifications` resolves "does this apply to me" at read-time by matching the current session's `hierarchyCode`/`userUid` against the notification's target. This is why per-user read state needs its own `NotificationRead` join table (one row per `notificationId`+`userUid`) rather than a flag on `Notification` itself — a hierarchy-targeted message has no single fixed "the" recipient row to flag as read.

- **Scheduling needs no cron/worker.** `scheduledFor` is just a nullable `DateTime` filtered at query time (`scheduledFor IS NULL OR scheduledFor <= now()`) in `GET /api/notifications` — a message scheduled in the future simply doesn't match the query yet. Don't build a background job for this; the query-time filter is the whole mechanism.
- **Delivery is two independent booleans, not a mode enum**: `deliveryPopup` (shown once via `LoginNotificationPopup` on a fresh app-shell mount, for messages not yet in `NotificationRead`) and `deliveryBell` (listed in `NotificationBell`'s dropdown, with an unread-count badge) — a message can be either, both, or (if unchecked) delivered as neither and just sit in the admin log.
- Use `formatDateTime()` from `src/lib/report-format.ts` for every notification timestamp shown to users, same as report `DATETIME` columns.
