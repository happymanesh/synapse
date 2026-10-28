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

## 2. The one change Synapse needs first

**This is a prerequisite, not a per-app step.** It is done once, and then every subsequent app
integrates with no Synapse code change at all.

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

Without a `domain`, no separate application can see a Synapse session, whatever else it does
correctly. Two ways forward:

### 2.1 Shared parent domain — preferred

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

### 2.2 Signed handoff — only if 2.1 is impossible

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
| `roles` | string[] | Role codes. |

**Verify the signature. Never decode unverified.** A JWT is readable by anyone holding it; only
verification makes it trustworthy.

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
| `appCode` | Short, stable, uppercase. Never changes — menus and grants key on it. |
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
- Grant write access to the Synapse database. Read access, where genuinely needed, is a
  **read-only database role** mirroring the existing `prismaReadOnly` pattern
- Grant access to a hierarchy that has not been approved
- Accept an application that implements its own login

---

## 7. Worked example

**workPulse** is the reference implementation: a separately deployed Next.js + NestJS
application, registered as `WorkPulse` in `AppMaster` with a single `EXTERNAL` menu entry, and
holding no passwords of its own. Its side of the design is documented in
`SIHL_workPulse/docs/synapse-integration.md`, including the role-mapping decisions.

Its registration in `prisma/seed.ts` — app, menu and per-hierarchy grants — is the pattern to
copy for the next app.
