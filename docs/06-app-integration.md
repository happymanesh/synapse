# SIHL Synapse — App Integration Guide

**Applies to:** any application that should appear in Synapse's Apps menu and rely on Synapse
for identity and access.
**Audience:** teams building a new internal application, and whoever registers it in Synapse.
**Repository:** `https://github.com/happymanesh/synapse` (private)
**Last updated:** 28-Oct-2026

---

## 1. What this gets you

Synapse is the access platform. An application integrated with it inherits, without building
any of it:

- **Sign-in** — users, passwords, password policy, IP allowlisting, failed-attempt lockout
- **Access control** — who may open which screen, administered on one screen, by role
- **Immediate deactivation** — a leaver loses access on their next request, everywhere
- **An audit trail** — administrative changes recorded with actor, timestamp and fields changed
- **A place to be found** — the Apps switcher and the menu

The application supplies its own screens and its own data. It does not supply identity.

---

## 2. Getting the session across to your app

**Settle this before you deploy, not after.** Where an app is deployed decides whether it can
see a Synapse session at all, and the cheapest option (§2.1) constrains the host.

Synapse's session cookie is currently **host-only**:

```ts
// src/lib/session.ts
cookieStore.set(SESSION_COOKIE, session, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  // no `domain` — so the browser sends this cookie to Synapse's host and nowhere else
});
```

Without a `domain`, the browser sends this cookie to **Synapse's host and nowhere else**.

Three ways forward, cheapest first.

### 2.1 Same host, different port — no change at all

**Cookies ignore port numbers** (RFC 6265). A host-only cookie set by Synapse on
`10.0.0.5:3010` is sent to `10.0.0.5:3447` as well — same host, different app, same cookie.

So if an app is deployed on the **same host** as Synapse, session sharing already works:
no `domain` change, no handoff, no Synapse code. Both must use the same scheme, because the
cookie is `secure` in production and an `https` cookie is not sent to an `http` origin.

This is the fastest route to a working UAT, and it is how Synapse and workPulse share a
session on a developer machine today (`localhost:3010` and `localhost:3200`).

Its limit is that it does not scale: every app on one host, one certificate, one blast
radius. Use it to get UAT working, then move to §2.2 for production.

> **An IP address cannot carry a cookie `domain`.** Browsers reject a `Domain` attribute on
> an IP host, so §2.2 is unavailable to an app deployed at `https://192.168.x.x:port`. An
> app on an IP must either sit on Synapse's own host (§2.1) or be given a hostname under the
> parent domain before §2.2 can work. Decide the hostname **before** you deploy.

### 2.2 Shared parent domain — preferred for production

Deploy every app under one registrable domain and set the cookie domain to the parent:

```
synapse.sihl.internal      → Synapse
workpulse.sihl.internal    → workPulse
<newapp>.sihl.internal     → the next one
```

One line added to `createSession()`. Clicking an Apps entry then becomes an ordinary link —
no redirect, no token exchange, no handshake to get wrong.

**Cost:** changing the cookie invalidates every existing session on deploy. Everyone signs in
once more. Do it during a quiet window, not alongside a release people are watching.

### 2.3 Signed handoff — only if 2.1 and 2.2 are both impossible

Synapse mints a short-lived (60s), single-use handoff token which the app exchanges for its
own session. More moving parts, a replay surface to defend, and **every app has to implement
it**. Avoid unless the domains genuinely cannot be aligned.

> **Open decision.** Whether all apps can share a parent domain is tracked as **S-02** in
> `SIHL_workPulse/docs/synapse-integration.md` and is still unanswered. Settle it with Infra
> before any team builds against this guide — it changes section 4 for everyone.

---

## 3. What the application must do

Give this section to the team building the app.

### 3.1 Do not implement identity

No login screen. No password storage. No user table treated as the source of truth. Users are
authenticated by Synapse before they reach the application.

### 3.2 Read the session, and verify it

The cookie is `synapse_session`, an **HS256 JWT** signed with a `SESSION_SECRET` shared with
Synapse. Payload:

| Claim | Type | Meaning |
|---|---|---|
| `userUid` | number | Synapse's primary key for the user. Use this as the join key. |
| `username` | string | Login name, e.g. `SIHL-0720`. Unique, but **may be changed** — do not key on it. |
| `fullName` | string | Display name. |
| `companyCode` | string | The user's company. |
| `hierarchyCode` | string | The user's hierarchy — this is what access grants are matched against. |
| `hierarchyName` | string | Display form of the above. |
| `roles` | string[] | **Always empty. Do not use.** See the warning below. |

> **`roles` is always an empty array.** The claim exists in `SessionPayload` and is written
> as `[]` at sign-in (`src/app/api/auth/login/route.ts`). Nothing in Synapse reads it, and
> nothing populates it. An authorisation check against `roles` would therefore test an empty
> array and silently pass or fail for the wrong reason. Use the menu grant (§4) instead — it
> is the only mechanism that works, and the only one Synapse itself uses.

**Verify the signature. Never decode unverified.** A JWT is readable by anyone holding it; only
verification makes it trustworthy.

### 3.2.1 What sharing `SESSION_SECRET` means

The secret is not a read credential. **Any application holding it can mint a valid Synapse
session for any user**, because the same key that verifies a token also signs one. Share it
only with applications trusted at that level, rotate it across all of them together, and
never place it anywhere it could be read by a browser.

If the number of integrated apps grows beyond a handful, move to the signed-handoff model
(§2.3) where each app holds its own secret, rather than widening the blast radius of one key.

---

### 3.3 Re-check that the user is still active

The token stays cryptographically valid for its full **8 hours**. Synapse re-checks
`UserDetails.isActive` on *every* request, inside `getSession()`, so a deactivated user is
refused on their next action. An integrated app must do the same when it establishes a session.

A leaver retaining access for the rest of the working day is not acceptable in a BFSI control
environment, and "the token was still valid" is not a defence anyone will accept.

### 3.4 Fail closed

No route is reachable without a verified session. If verification fails, if the secret is
missing, if Synapse is unreachable — refuse. Never fall back to an anonymous or default user.

### 3.5 Do not build a second permissions system

Access in Synapse is derived, not stored per user:

```
user → active roles → role_menu_map (company + hierarchy) → menu → menu.appCode
```

There is no separate permissions table and apps must not introduce one. If the application has
internal roles of its own, **map** them from the `roles` claim; do not create a second place
where access is granted, because the two will drift and nobody will know which is authoritative.

---

## 4. Two rules that catch everyone

### 4.1 A grant only applies to a matching hierarchy

`role_menu_map` is keyed on **(roleCode, menuCode, companyCode, hierarchyCode)**, and
`getAccessibleMenuCodes()` filters by the **user's own** hierarchy. A grant created for one
hierarchy does nothing for a user in another. **One grant row per hierarchy that should have
access.**

This is the single most common integration failure here — an app registered correctly,
granted correctly, and invisible to everyone it was meant for.

Hierarchies: `0000` Management · `0100` CSO · `0200` Employee · `0300` Branch ·
`0400` Franchisee · `0500` SubBroker · `0600` Remisior · `0700` Family · `0800` Client ·
`9999` Admin.

### 4.2 A menu grant controls visibility, not access

Removing a menu hides it from the sidebar. It does **not** stop anyone who knows or guesses the
URL. Every screen and every endpoint must enforce access server-side as well.

In Synapse's own code that means `requireMenu(menuCode)` for pages and
`hasMenuAccess(userUid, menuCode)` returning **403 JSON** for API routes — never a redirect
from an API route, which hands `fetch()` an HTML login page and surfaces as a parse error
instead of a clear denial. An integrated app must apply the equivalent check against the
roles in its verified token.

---

## 5. What the app team supplies for registration

| Item | Notes |
|---|---|
| `appCode` | Short, stable, **uppercase**. Never changes — menus and grants key on it. Existing codes are inconsistent (`BROKING`, `SUPPORT`, but also `WorkPulse`); do not add to that. |
| App name | As it should read in the Apps switcher. |
| Icon or logo | An emoji works; a logo URL is better. |
| Base URL per environment | dev / UAT / production, separately. |
| Menu entries | Name, display order, and the path or URL each opens. |
| Hierarchies | Which should have access, with the business reason. |

### Registering it

Three rows, created through Administration in Synapse — **no code change, no deploy**:

1. **Administration › App** — the `AppMaster` row
2. **Administration › Menu** — one row per entry. `menuType` is `EXTERNAL` with an
   `externalUrl` for a separately deployed app; `ROUTE` for a page inside Synapse itself.
   Set `appCode`, or the menu is treated as global and appears under every app.
3. **Administration › Role** — the grants, one per hierarchy (see §4.1)

Add the same rows to `prisma/seed.ts` as well, following the existing upsert patterns. The seed
runs on every deploy, so a seeded app appears in each environment automatically instead of
being re-entered by hand — which is how an app ends up present in one environment and missing
in another.

---

## 6. What Synapse will not do

- Pass user credentials to an application
- Grant write access to the Synapse database
- Grant access to a hierarchy that has not been approved
- Accept an application that implements its own login

---

## 7. Reading Synapse's own data

Apps commonly need one fact from Synapse — usually "is this user still active?" (§3.3). How
that is served matters, because the obvious answer is the wrong one.

**A read-only login on the Synapse database is broader than it sounds.** `user_details`
carries `password_hash`, and the database also holds the full audit log. A blanket
`SELECT`-everywhere role hands an application every password hash on the platform to answer
a boolean question.

### 7.1 Available today — a column-restricted read-only role

This is what to build against. A read-only Postgres login on the Synapse database, granted
**specific columns**, not whole tables:

```sql
CREATE ROLE clientbiz_reader LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE sihl_synapse TO clientbiz_reader;
GRANT USAGE ON SCHEMA public TO clientbiz_reader;

-- Only the columns an active-user check needs. password_hash is deliberately absent.
GRANT SELECT (uid, username, full_name, email, employee_code, is_active, is_suspended)
  ON user_details TO clientbiz_reader;
GRANT SELECT (user_uid, role_code, is_active) ON user_role_map TO clientbiz_reader;
GRANT SELECT (role_code, menu_code, company_code, hierarchy_code, is_active)
  ON role_menu_map TO clientbiz_reader;
GRANT SELECT (menu_code, app_code, is_active) ON menu_master TO clientbiz_reader;
```

Column-level grants matter because the exposure is the grant, not the query. A role with
blanket `SELECT` can read every password hash on the platform regardless of what the
application's own SQL happens to ask for.

`SynapseDirectoryService` in workPulse (`apps/api/src/modules/auth/synapse-directory.service.ts`)
is a working implementation of exactly this: parameterised SELECTs, fails closed when the
user is missing, inactive, suspended or the directory is unreachable, and reads role codes
fresh rather than trusting the token. Copy it.

### 7.2 Proposed, NOT BUILT — a service endpoint

> **This does not exist.** There is no `/api/identity` route in Synapse today. It is
> recorded here as a design direction, not an available service. Do not build against it,
> and do not ask for its base URL — there isn't one.

A narrower alternative would be a single endpoint answering the real question in one call:

```
GET /api/identity/authorize?userUid=<n>&menuCode=<CODE>
  → { "active": true, "authorized": true }
```

Minimum disclosure, no database credentials handed out, and the calls can be logged and
rate-limited. Worth building once there are several integrated apps; until it exists, use
§7.1.

### 7.3 Never

A blanket read-only role — `GRANT SELECT ON ALL TABLES` — for an application outside
Synapse.

`prismaReadOnly` is sometimes cited as the precedent here. It is not: that is a second
connection *inside* Synapse used to execute report SQL, not an external access contract.

---

## 8. Worked example

**workPulse** is the reference implementation: a separately deployed Next.js + NestJS
application, registered as `WorkPulse` in `AppMaster` with a single `EXTERNAL` menu entry, and
holding no passwords of its own. Its side of the design is documented in
`SIHL_workPulse/docs/synapse-integration.md`, including the role-mapping decisions.

Its registration in `prisma/seed.ts` — app, menu and per-hierarchy grants — is the pattern to
copy for the next app.
