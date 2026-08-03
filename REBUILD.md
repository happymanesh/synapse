# SIHL Synapse — Rebuild Specification

A complete, self-contained brief for recreating this project from an empty directory.
Written to be handed to a coding agent (or a developer) as the single source of truth.

Read this top-to-bottom before writing code. The **Conventions** and **Traps** sections
encode decisions that were expensive to discover — following them from the start avoids
rework, and several of them are not guessable from the requirements alone.

---

## 1. What this is

**Synapse** is an internal web platform for **Shah Investor's Home Limited (SIHL)**, a
SEBI-registered Indian stockbroker. It is a **multi-app portal**: one login, a company's
several products (Broking, Back Office, …) selectable from an app switcher, each with its
own menu tree, plus a shared Administration area.

Its centrepiece is an **admin-driven dynamic report/form engine**: non-developers compose
reusable filter components into filters, bind a filter to a SQL query, and get a fully
featured report — or bind it to a table instead and get an add/edit/delete form. No code
change is needed to add a new report or form.

**Primary users:** internal staff (management, CSO, employees, branches, franchisees,
sub-brokers, remisiers) and, in later phases, clients.

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) | Server Components by default |
| Language | TypeScript, strict | |
| Styling | **Tailwind CSS v4** | CSS-first config in `globals.css`, no `tailwind.config.ts` |
| Database | **PostgreSQL 16** | |
| ORM | **Prisma 7** with driver adapters | `@prisma/adapter-pg` + `pg`; client generated to `generated/prisma` |
| Auth | **jose** JWT in an httpOnly cookie | 8h expiry; `bcryptjs` for hashing |
| Validation | **zod** | one schema per admin entity |
| Charts | **recharts** | |
| Scripts | `dev` / `build` / `start` / `lint` (`eslint`) | seed via `prisma db seed` → `tsx prisma/seed.ts` |

Package manager: **npm**. (pnpm had approve-builds problems on the target machine.)

Environment variables (`.env`):

```
DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/sihl_synapse
SESSION_SECRET=<random 32+ char string>
SEED_USER_PASSWORD=<optional; password for the seeded accounts>
```

`SESSION_SECRET` is read at module load in `src/lib/session.ts` and **throws if missing** —
deliberate, so a missing secret fails loudly at boot instead of silently issuing
unverifiable tokens.

`SEED_USER_PASSWORD` sets the password for the accounts created by `prisma/seed.ts`. It
falls back to the obvious placeholder `ChangeMe@2026` so that a clone of this repository can
never contain a working credential. `.env` is gitignored; never hardcode a real password in
the seed script.

---

## 3. Data model

All models live in `prisma/schema.prisma`; every table/column uses `@map` to snake_case.

### Identity & access
- **`CompanyMaster`** — `companyCode` (unique), name, PAN/TAN, registered address, logo path.
- **`AppMaster`** — `appCode` (PK), name, `companyCode` FK, description, emoji `icon`,
  `appLogoUrl`, `displayOrder`, `isActive`. One product within a company.
- **`HierarchyMaster`** — `hierarchyCode` (unique), name, `seqId`. Flat lookup, **not**
  compounded with company: Management `0000`, CSO `0100`, Employee `0200`, Branch `0300`,
  Franchisee `0400`, SubBroker `0500`, Remisior `0600`, Family `0700`, Client `0800`,
  Admin `9999`.
- **`ClientCategoryMaster`** — `clientCategoryCode` (PK), name. Default `C00`.
- **`UserDetails`** — `uid` (PK), `companyCode`, `username` (unique), `passwordHash`,
  `customerId`, `fullName`, `mobile`, `email`, `lastPasswordChangedDate`, `createdDate`,
  `modifiedDate`, `hierarchyCode`, `clientCategoryCode`, `isActive`, **`lastAppCode`**
  (nullable, no FK — a deleted/revoked app must degrade gracefully, not break login).
- **`PasswordHistory`** — prior hashes per user, for reuse checks.
- **`UserIpMapping`** — `userUid`, `ipMapping` (dotted pattern, `*` wildcard per octet),
  `isActive`. **No active mapping ⇒ user may log in from anywhere**; adding one restricts them.
- **`LoginLog`** — audit of attempts, success/failure.
- **`AccountRequest`** — captured "open an account" / help requests.

### Navigation & authorization
- **`MenuMaster`** — `menuCode` (PK), `parentMenuCode` (self-FK, 3 levels),
  `menuName`, `icon`, `routePath`, `level`, `displayOrder`, `companyCode`,
  `hierarchyCode`, `menuType` (`ROUTE | REPORT | EXTERNAL`), `externalUrl`, `reportId` FK,
  **`appCode`** (nullable FK — **NULL means global, shown in every app**), `isActive`.
- **`RoleMaster`** — `roleCode` (PK), name, `companyCode`, `hierarchyCode`.
- **`RoleMenuMap`** — role ↔ menu, unique on
  `(roleCode, menuCode, companyCode, hierarchyCode)`.
- **`UserRoleMap`** — user ↔ role.
- **`UserFavoriteMenu`** — user ↔ menu, unique on `(userUid, menuCode)`.

### Report/form engine
- **`FilterComponentMaster`** — `componentCode` (PK), name, `componentType`
  (`TEXT | NUMBER | DATE | DATE_RANGE | DROPDOWN | MULTI_SELECT | CHECKBOX | RADIO`),
  `dataSourceType` (`STATIC | SQL | NONE`), `staticOptionsJson`, `dataSourceQuery`
  (returns `value`/`label`; may reference `:parentValue` for cascading).
  **The reusable component repository** — build once, arrange many times.
- **`FilterDefinition`** — `filterId` (PK), name, `isCollapsible`, `defaultCollapsed`.
- **`FilterDefinitionItem`** — placement of a component in a filter: `filterId`,
  `componentCode`, `rowNo`, `positionNo`, `isMandatory`, `labelOverride`, `defaultValue`,
  **`mappedColumn`** (FORM mode: which column this field writes),
  **`dependsOnItemId`** (self-FK: which sibling feeds this one's `:parentValue`).
  Cascading is a property of the *arrangement*, not the component — so the same
  component can be standalone in one filter and dependent in another.
- **`ReportDefinition`** — `reportId` (PK), `reportTitle`, `filterId` FK,
  `mode` (`REPORT | FORM`), `queryText` (parameterized SQL), `targetTable` (FORM only),
  `maxRows` (default 2000), `freezeColumns`, `displayStyle` (`PAGED | FULL_FROZEN`),
  `footerNote`, `allowedFormats` (`String[]`), `allowedDeliveries` (`String[]`).
- **`ReportColumn`** — `reportId`, `columnKey` (must match a result column), `displayLabel`,
  `displayOrder`, `dataType` (`TEXT | NUMBER | DATE | DATETIME`), `decimalPlaces`,
  `isHighlighted`, `showTotal`, `isIdentifier` (FORM: the PK to edit/delete by), plus
  drill-down fields: `drillDownReportId`, `drillDownTargetParam`,
  `drillDownMode` (`PAGE` default | `MODAL`), `drillDownModalSize` (`AUTO|SMALL|MEDIUM|LARGE`).
- **`ReportRowHighlightRule`** — `reportId`, `columnKey`,
  `operator` (`EQ|NEQ|GT|LT|GTE|LTE|CONTAINS`), `compareValue`, `highlightColor`, `priority`.

### Notifications
- **`Notification`** — `senderUid`, `targetType` (`HIERARCHY | USER`),
  `targetHierarchyCode` / `targetUserUid`, `deliveryPopup`, `deliveryBell`, `messageText`,
  `scheduledFor` (nullable), `createdAt`, `isActive`.
- **`NotificationRead`** — `notificationId` + `userUid`, unique together.

---

## 4. Core architecture rules

These are load-bearing. Violating them produces subtly wrong behaviour, not compile errors.

### 4.1 App access is derived, never stored

```
user → active roles → role_menu_map → menu → menu.appCode
```

There is **no** user↔app or role↔app table. Granting a role a menu automatically grants
the app that menu belongs to. `getAccessibleMenuCodes()` in `src/lib/apps.ts` is the single
source of truth shared by `getMenuForUser()` and `getAppsForUser()`, so "menus I can see"
and "apps I can open" can never drift apart.

`MenuMaster.appCode = NULL` means **global** — the menu appears in every app, and grants no
app on its own. Administration is seeded this way deliberately: scoping it to one app would
let an admin switch app and lose access to App Master itself.

The active app is resolved **server-side per request** in `(app)/layout.tsx`:
`resolveActiveApp()` returns the user's `lastAppCode` if they still have access (it may have
been deactivated or their role revoked), else their first app. Everything downstream keys off
the resulting `menuItems` — sidebar, top-bar search index, and `/api/favorites`. Add new
app-aware surfaces by deriving from `menuItems`, never by re-querying menus unscoped.

Switching apps writes `lastAppCode` via `POST /api/apps/select` (which re-checks access
server-side), so the next login reopens the same app. The switcher then
`router.push("/dashboard") + router.refresh()`; `<main>` is **keyed on the active app code**
so client pages genuinely remount rather than merely re-render — otherwise the dashboard,
which fetches favorites once on mount, would keep showing the previous app's data.

### 4.2 SQL: structure is trusted, values never are

`queryText` and `dataSourceQuery` are admin-authored (only `requireAdmin()` users can write
them) and are therefore trusted as *structure*. End-user input is **always** bound as
parameters. `src/lib/report-sql.ts` parses `:paramName` tokens into positional placeholders
and executes via `$queryRawUnsafe(sql, ...params)` — never string concatenation of values.

Identifiers that do reach SQL (table names, `mappedColumn`, owner column) pass through
`assertSafeIdentifier()`.

`DATE_RANGE` components split into two bound params: `:CODE_FROM` and `:CODE_TO`.

### 4.3 User-owned records

Any table end users add/edit their own rows into **must** have `created_by`, `updated_by`,
`updated_on`, populated from the session on every write. The engine — not admin discipline —
enforces visibility: the FORM-mode list query is always wrapped

```sql
SELECT * FROM (<queryText>) w WHERE w.created_by = $1
```

so `queryText` must include `created_by` in its projection. Update and delete embed the same
check in the statement itself (`WHERE id = $1 AND created_by = $2`), not just in caller logic.

### 4.4 Show/Save and Reset are engine-rendered

They are never data-driven filter items. The engine always renders them ("Show" in REPORT
mode, "Save"/"Update" in FORM mode, plus "Reset") — a system guarantee beats something an
admin could forget to place.

### 4.5 Formatting and sorting follow declared types

Every report/list table formats and sorts by `ReportColumn.dataType`, never by sniffing the
value or comparing formatted text:

- `DATE` → `dd-Mmm-yyyy`, centred. `DATETIME` → `dd-Mmm-yyyy hh:mm`, centred.
- `NUMBER` → right-aligned; `decimalPlaces` forces precision. `TEXT` → left-aligned.
- Sorting a date compares the underlying `Date`. (Sorting `"26-Jul-2026"` as text sorts by
  month *name* — the bug this rule exists to prevent.)

Use `formatCellByType()`, `alignmentForType()`, `compareByType()` from
`src/lib/report-format.ts`. Applies to every tabular view, not just the report engine.

### 4.6 Downloads

Every download is named `{username}_{timestamp}.{ext}` (e.g. `Admin001_20260726-143005.csv`),
timestamp `YYYYMMDD-HHMMSS`. Use `buildDownloadFilename()` from `src/lib/download.ts`.
Username comes from the session server-side and is passed down as a `currentUsername` prop.

### 4.7 Report drill-down

Any `ReportColumn` can drill into another report. Clicking a drillable cell either navigates
to the target report's page with a "← Back" link (`PAGE`, labelled **Normal**, the default)
or opens it in a sized popup (`MODAL`, labelled **Popup**).

- **Filter carry-over is automatic**, not configured: the parent's whole filter-value set is
  forwarded and the target ignores keys that aren't its own component codes. This is *why*
  a summary and its detail report should reuse the same `componentCode` for anything meant
  to carry over.
- **Target param** is normally one component code. If a column's meaning depends on another
  filter in the same report, store a JSON discriminator map instead:
  `{"__discriminator":"SALES_SUMMARY_TYPE","PRODUCT":"SALES_DETAIL_PRODUCT","REGION":"SALES_DETAIL_REGION"}`.
  A value not starting with `{` is always the plain-string case.
- The drilled-into report hides its own filter panel — `hideFilterPanel` is
  `!!backLink || !!isEmbeddedInModal`, **not** `!!autoShow`. See Trap 4.
- A drill target needs no menu entry if it's only ever reached by drilling.

### 4.8 Notifications

No recipient list is stored: `GET /api/notifications` resolves "does this apply to me" at
read time by matching the session's `hierarchyCode`/`userUid`. That's why per-user read state
needs its own `NotificationRead` join table.

**Scheduling needs no cron/worker** — `scheduledFor` is filtered at query time
(`scheduledFor IS NULL OR scheduledFor <= now()`). A future-dated message simply doesn't
match yet. Do not build a background job for this.

`deliveryPopup` and `deliveryBell` are two independent booleans, not a mode enum.

---

## 5. Feature specification

### 5.1 Authentication
- Login by username + password; bcrypt verify; JWT session cookie (httpOnly, 8h).
- IP restriction enforced against `UserIpMapping` (wildcards per octet).
- Password policy: ≥8 chars, ≥1 uppercase, ≥1 digit, ≥1 of `!@#$%^&*`, not equal to the
  username; reuse checked against `PasswordHistory`.
- "Forgot User ID" and "Reset Password" are **capture-only** — they record a request; no SMTP
  is wired. Keep it that way unless asked.
- Every attempt written to `LoginLog`.

### 5.2 App shell
- **TopBar**: company logo + name │ `Synapse` wordmark │ **active app name between vertical
  rules** │ menu search │ favourite (♡/❤) │ notification bell │ **app switcher (nine-dot
  launcher)** │ user chip.
  - The user chip opens a dropdown with **Profile / Settings / Logout**. Settings (theme,
    menu style, language, change password) lives *inside* it — there is no separate gear icon.
  - Search matches menu name **and** breadcrumb path, showing both in results.
- **Sidebar**: 3-level tree, collapsible to an icon rail with click-to-open flyouts.
  - Collapse toggle at the top, icon-only (`«`/`»`), with a **"New window"** switch beside it.
    When on, every menu link — and app selection — opens in a new tab.
  - **Accordion**: only the top-level group containing the active route stays open.
  - Open main-menu, open sub-menu and leaf rows each get a **distinct background shade**;
    main-menu rows show ▲/▼; the **active leaf shows a green dot** on the right.
- **Themes**: `day` / `night` / `hybrid`, plus vertical/horizontal menu orientation, persisted
  to `localStorage`. Palette lifted from the real SIHL public site; night/hybrid derived from
  its hero-gradient navies.
- **i18n**: 10 languages (en, hi, mr, gu, pa, bn, te, kn, ml, ta). **Only app chrome is
  translated** — menu names, report titles and other admin-authored content are shown as
  entered. Every new UI string must be added to all 10 dictionaries.

### 5.3 Administration (`/admin/*`)
Twelve entities, all `requireAdmin()`-gated: **Company, App, Hierarchy, Client Category,
User IP Mapping, Menu, Role, User, Filter Components, Filters, Reports, Notifications**.

All built on one generic **`AdminCrudTable`** with:
- a **search box** (client-side filter for non-paged tables; server-side `search` param for
  the paged User Master),
- an optional **"Filter by company"** dropdown (`companyFilterOptions`) — wired for Menu, Role
  and User, the three entities that have a `companyCode`,
- **icon-only Actions** (`compactActions`): ✏️ edit, 🗑️ delete, plus per-page extras
  (🔑 reset password, 🛡️ manage roles, 🧭 manage menus, 📑 manage items, 📋 manage columns,
  🎨 highlight rules),
- CSV export of the **currently filtered** rows,
- field-level red error highlighting driven by zod `fieldErrors`.

Nested editors open as modals: Role↔Menu and User↔Role checklists, filter items, report
columns, highlight rules. Every modal closes with a **text "Close" button**, never a tiny `×`.

**Conditional fields hide, rather than being explained away in the label.** `FieldConfig`
takes `showWhen?: { field, equals?, notEmpty? }` — a *serializable descriptor*, not a
predicate function, so it crosses the RSC boundary from a Server Component page (a function
would throw; see Trap 5). Used for Menu Master (`routePath`/`reportId`/`externalUrl` by
`menuType`), Notifications (hierarchy vs user), Filter Components (`staticOptionsJson` vs
`dataSourceQuery` by `dataSourceType`), Report Definitions (`targetTable` in FORM mode) and
Report Columns (drill fields once a target is chosen; popup size only when display = Popup).

A hidden field is submitted as **empty, not omitted** — omitting it would leave the previous
value untouched on update, so a record could keep data the form no longer shows and the admin
has no way to see or clear. Labels that merely *describe* optionality ("leave blank for
top-level") stay as labels; only genuinely irrelevant fields hide.

### 5.4 Report engine (REPORT mode)
- Filter fields laid out by `rowNo`/`positionNo`; cascading dropdowns refetch a child's
  options when its parent changes.
- **"Hide Parameters" / "Show Parameters"** sits on the **breadcrumb line, far right**, and
  collapses the *entire* filter card to give the table full height. Running "Show" also
  auto-collapses the filter panel and the left sidebar.
- Breadcrumb (e.g. `Utilities › Sample › Sales Report`) is always visible above the filters.
- Row count is checked against `maxRows` **before** fetching data; over the limit, the UI
  offers a CSV download instead of rendering.
- Results table: sortable typed columns, striping, frozen columns, per-column filter,
  totals row, footer note, paging, CSV export.
- On a successful Show, current filter values are synced into the URL via `router.replace`
  so browser Back from a drill-down restores the exact previous state.

### 5.5 Form engine (FORM mode)
Same filter definition reused as an add/edit/delete form. Each item's `mappedColumn` turns a
field into a column write. Below the form, the user's **own** records list with Edit
(repopulates the form) and Delete (confirm). Ownership enforced in SQL per §4.3.

### 5.6 Dashboard
Favourites strip (horizontally scrolling cards, **scoped to the active app**), stat tiles,
and a login-activity line chart (currently placeholder data).

---

## 6. Traps

Each of these cost real debugging time. They are not inferable from the requirements.

1. **Never run `prisma migrate dev` or `prisma db push`.** The database contains
   `sample_sales`, a hand-created table that is *not* a Prisma model; both commands plan to
   drop it. The safe loop is:
   ```
   # 1. edit schema.prisma
   # 2. write prisma/migrations/<timestamp>_<name>/migration.sql by hand
   npx prisma db execute --file prisma/migrations/<name>/migration.sql
   npx prisma migrate resolve --applied <name>
   npx prisma generate
   ```
   (`prisma db execute` takes no `--schema` flag — it reads `prisma.config.ts`.)

2. **A stale dev server keeps the old Prisma client in memory.** After `prisma generate`,
   kill the `next dev` process, delete `.next`, and restart — otherwise new models appear
   "missing" at runtime while the code type-checks fine.

3. **Empty-string foreign keys.** A blank `<select>` submits `""`, and Prisma writes that
   literal into the FK column, producing an opaque 500 instead of a validation error. Every
   optional FK field uses `optionalStringSchema` — `z.preprocess(v => v === "" ? null : v, …)`.

4. **`hideFilterPanel` must not key off `autoShow`.** `autoShow` is also true when a report
   restores its own last-shown state from the URL (§5.4) — that case must still show its
   filter panel. Key off `backLink` / an explicit `isEmbeddedInModal` flag instead.

5. **`ColumnConfig.render` cannot cross the RSC boundary.** Admin pages are Server
   Components; passing render callbacks into the client `AdminCrudTable` throws
   *"Functions cannot be passed directly to Client Components"*. Put the column config in a
   `"use client"` wrapper (see `admin/notifications/NotificationsClient.tsx`).

6. **Collapsed-sidebar flyouts render through a portal**, so they're outside the sidebar's
   DOM subtree. The outside-click `mousedown` handler must explicitly exclude
   `[data-sidebar-flyout]`, or clicking a flyout link unmounts the link before its click
   lands. (The portal is needed because `overflow-y: auto` forces the cross-axis to `auto`
   too, clipping anything absolutely positioned outside the rail.)

7. **`router.refresh()` does not remount client components.** Server layout data updates, but
   a `"use client"` page's `useEffect(…, [])` will not re-run. Key the container on whatever
   changed (§4.1).

8. **Tailwind v4 has no `tailwind.config.ts`** — tokens are declared in `globals.css` under
   `@theme inline`. Only tokens defined there exist; `bg-accent` and friends silently do
   nothing if you invent them.

9. **`src/lib/report-sql.ts` and `session.ts` import `server-only`** and cannot be imported
   by a plain `tsx` script. Verification scripts must talk to the DB directly.

---

## 7. Build order

1. Scaffold Next.js 16 + Tailwind v4 + Prisma 7 (driver adapter, client → `generated/prisma`).
2. Schema: identity/access models. Migrate, seed a company, hierarchies, admin user + role.
3. `src/lib`: `password-policy`, `ip-match`, `session`, `db`, `auth` (`requireAdmin`).
4. Auth API + login page (branding panel, help modal).
5. App shell: layout, TopBar, Sidebar, menu resolution, dashboard placeholder.
6. `AdminCrudTable` + `admin-crud` helpers + zod schemas; the twelve admin pages and their
   CRUD routes; Role↔Menu and User↔Role mapping modals.
7. Theme system, SIHL palette, Montserrat, login redesign.
8. Report engine schema; `report-sql`; REPORT-mode routes; `ReportRunner`,
   `DynamicFilterField`, `ResultsTable`; admin pages for components/filters/reports.
9. FORM mode + ownership enforcement.
10. `report-format` helpers; results-table redesign (sorting, freeze, totals, export).
11. Navbar search, favourites, i18n, notifications (bell + login popup).
12. Drill-down (`PAGE`/`MODAL`, discriminator map, back-state restore).
13. Multi-app: `AppMaster`, `menu.appCode`, `lastAppCode`, `lib/apps.ts`, `AppSwitcher`,
    app-scoped menu/search/favourites.
14. Seed a worked example end-to-end (below) and verify in a browser.

## 8. Worked example to seed

Prove the engine with a real vertical slice, not toy data:

- `sample_sales` — hand-created table (`id, company_code, sale_date, product_name, region,
  quantity, amount, created_by, updated_by, updated_on`), ~30 rows across 6 months.
- **Sales Report** (REPORT) — Company + Date Range filter; typed columns; total on Amount.
- **Sales Summary** (REPORT) — mandatory Productwise/Regionwise; its `group_value` column
  drills into Sales Detail using the **JSON discriminator map**.
- **Sales Detail** (REPORT) — drill target, deliberately with **no menu entry**.
- **Sales Entry** (FORM) — same engine as an add/edit/delete form over `sample_sales`; every
  item carries a `mappedColumn`; `isIdentifier` on `id`. Demonstrates ownership isolation.
- Menus: `Utilities › Sample › {Sales Report, Sales Summary, Sales Entry}` in the **Broking**
  app; a second **Back Office** app with its own small tree; Administration left global.

Verify: cascading dropdowns, mandatory validation, `maxRows` overflow → download path,
drill-down both modes, Back restoring state, FORM ownership isolation across two users,
app switching swapping menu + search + favourites, and the choice surviving re-login.
