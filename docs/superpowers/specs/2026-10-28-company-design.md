# ניהול פלוגה — design

Date: 2026-10-28 · Module id: `company` · Status: approved 2026-10-28

## Sources

- **The registry entry:** `packages/core/src/modules.ts` already lists `company` ("ניהול פלוגה", `status: "planned"`, roles `admin` / `user`, description "שגרת קו, משמרות וניהול פלוגה"). Its roles and description change — see "Users and roles". `/company/[unit]` in `apps/web/src/app/(shell)/(hub)/company/` is a `<ComingSoon>` placeholder that mentions platoon-web; there is no platoon-web code in `references/`.
- **Data it reads, owned by other modules:** `people` and `app_users` (`packages/db/src/schema/core.ts`), logistics assignments and אפסון (`schema/logistics.ts`), kesher holders (`schema/kesher.ts`, `kesher_holders.signer_person_id` / `holder_person_id`), דוח 1 members, days and status flags (`schema/doch1.ts`).
- **Patterns to copy:** module layout and `<AppShell>` per `docs/ADDING_A_MODULE.md`; department roles and `<DepartmentRoles>` from kesher / דוח 1; push from `apps/web/src/lib/doch1/push.ts` (subscriptions are already shared between modules, see the kesher spec); sign-in linking in `app.link_auth_user()` (`packages/db/migrations/0001_security.sql`).

## Intent

Everything about a company is spread across departments: who holds which צ׳ is in לוגיסטיקה and מחלקת קשר, who is where is in דוח 1, and a soldier can see none of it about themselves. ניהול פלוגה gathers it per company in one place, and is the first module that **every soldier** signs into — not only commanders and department staff.

A soldier opens the app and sees **אני**: the gear signed on them, their דוח 1 status and how many days they've done, and their details, which they can fix. Inside the company, a commander records who has a piece of gear right now (החתמה פנימית) — typically a platoon borrowing gear from another platoon for a day — so the company always knows where it is. Commanders get the company's roster, the buttons for the reports each department expects from the company, and a settings tab for permissions.

## Goals

1. Any soldier in the battalion can get in with their Google account without an admin typing their email first, and only after a commander confirms it's really them.
2. On **אני** a soldier sees, on their phone: every item signed on them (logistics, kesher, company-internal), today's and the coming days' דוח 1 status, and their day counts for the current round.
3. A soldier fixes their own phone number at once; a name or תפקיד change waits for a commander.
4. The company knows where its gear is when it moves inside the company: a register of who has it now, from whom and since when — for kesher gear on the company and for the company's own items.
5. A commander finds every report their company owes (per department) in one tab, shown only if they hold the right role in that department.
6. A company admin manages who in the company holds which role — in this module and the company-level roles of דוח 1, לוגיסטיקה and קשר — from inside the module.

## Non-goals

- Replacing the departments' own screens. Department work (signing from the battalion warehouse, דוח 1 entry, imports) stays in the department's module; ניהול פלוגה links into it or shows it read-only.
- Creating or deactivating soldiers. דוח 1 owns `people`; this module only edits the fields named in "Self-edit", and only through the flows below.
- A second copy of department data. Kesher holders, logistics assignments and דוח 1 days are read from — and, where stated, written to — the department's own tables.
- Changing department records. החתמה פנימית is the company's own register: kesher holders, kesher events and logistics assignments are never written by it, and the departments don't see it.
- Moving logistics gear between soldiers. Logistics signs to the soldier directly; a transfer is done in לוגיסטיקה, where the signature and form live.
- Sending reports. A report button opens the department's existing flow for the company; it doesn't post to WhatsApp or email.
- שגרת קו / משמרות. Dropped from this module (answered); the registry description changes to "החתמות פנימיות, מצבה וכוח אדם בפלוגה".
- Department admin roles. A company admin never grants `admin` or `master_admin` in any department.

## Anti-goals (would be a failure even if it works)

- A soldier sees another soldier's gear, status, phone or personal number.
- The join screen tells a stranger whether a personal number exists.
- A soldier's account is linked to a soldier without a commander approving it.
- A name change breaks matching in the kesher / logistics imports or the דוח 1 sheet without anyone noticing.
- A department's records change because of an internal signing (the department's signer and holder stay responsible).
- The register says a piece of gear is in two places at once.
- A push notification that contains a soldier's name or an item's צ׳.

## Users and roles

Two kinds of access:

- **Soldier (implicit)** — any signed-in user whose `app_users.person_id` is set and approved. No membership row; access covers only "me", including register entries that put gear on them. A soldier who also has memberships sees both.
- **Members** (memberships on the `company` module). The registry's `user` role is replaced by `platoon_commander`:

| Role | Scope | Can |
|---|---|---|
| `admin` — מנהל פלוגה (מ״פ / סמ״פ / רס״פ) | a company, or battalion | Everything below for the whole company, plus: approve join requests, the company's items, the settings tab (roles in this module and the department roles in "Granting department roles") |
| `platoon_commander` — מפקד מחלקה (מ״מ) | a platoon | The roster of their platoon; **record and close** internal signings where the gear is now in their platoon or goes to a soldier of it (the borrowing מ״מ records the loan); **approve** the platoon's name/תפקיד change requests. Join requests stay with the company admin. |

A company `admin` membership is given in `/admin` (core admins), like every membership today; from there the company admin hands out the rest.

The **דוחות** tab needs no new role: each report button shows when the user holds the matching role in that department, using `can()` as each department already does.

### Granting department roles (answered)

In הגדרות a company admin can grant and revoke these roles, **only on their own company or its platoons**, and only to users whose linked soldier is in that company:

| Department | Roles a company admin may grant | Scope |
|---|---|---|
| דוח 1 | `company_user`, `platoon_commander`, `viewer` | company; `platoon_commander` on a platoon |
| לוגיסטיקה | `company_user` | company |
| קשר | `user` | company only (a platoon-level kesher membership sees no kesher rows — kesher spec) |

Never `admin` or `master_admin`. Memberships given by a department's master admin or in `/admin` show in the tab read-only. Writes go through `app.company_grant_role(user_id, module, role, unit_id)` / `app.company_revoke_role(membership_id)` (`security definer`), which check the whitelist above and the caller's `admin` role on that company; the `memberships` policies themselves are not widened.

## Decisions (answered 2026-10-28)

1. **Getting in: self-signup with approval.** The soldier signs in with Google, enters their personal number and the last 4 digits of their phone. If it matches an active soldier, a join request goes to that soldier's company admins; approval sets `app_users.person_id`. Not by per-email invite, and not auto-linked.
2. **Self-edit: phone direct; name and תפקיד need approval.** Phone saves at once (audited). Name and תפקיד are change requests a company admin approves; approval writes `people`.
3. **החתמה פנימית is the company's own register** (clarified 2026-10-28) — for knowing where gear is, e.g. a platoon that needs another platoon's gear for a day signs one of its soldiers on it. It covers kesher צ׳ on the company and the company's own catalog (tents, generators, cooking gear …). It writes nothing to the departments. Logistics gear is shown on אני but not in the register.
4. **Day count: current round, split by type.** Days in the active דוח 1 round, counted by the status flags, up to today.
5. **Roles:** מ״פ / סמ״פ / רס״פ = company `admin`; מ״מ = `platoon_commander`, who records their platoon's internal signings and approves its detail changes. Join requests stay with the company admin.
6. **Reports tab:** דוח 1 של היום, שבצ״ק וכוננות, דוח צ׳ (קשר).
7. **הגדרות also grants department roles** — company-level, non-admin roles only (see "Granting department roles").
8. **שגרת קו / משמרות is dropped** from this module.
9. **Kesher gear in the register stays in the company.** `kesher_holders` and `kesher_events` are untouched; the kesher department doesn't see internal signings.
10. **Logistics gear is show-only.** Moving it between soldiers stays a logistics transfer.
11. **An approved name change updates `people` and flags the departments** (see "Name changes").
12. **No confirmation.** A commander records an internal signing and it's in the register at once; the receiver doesn't accept.
13. **No return date.** An entry is open until a commander marks it returned or signs the gear on to someone else.

## Concepts

- **Linked soldier** — an `app_users` row with `person_id` set by an approved join request. `app.my_person_id()` returns it (null when unlinked or the soldier is inactive).
- **Join request** — pending link between a signed-in Google account and a soldier, decided by that soldier's company admin.
- **Change request** — a proposed new `full_name` or `role_title` for one soldier, decided by a company admin.
- **Company item** — a thing the company owns: with a צ׳ (one unit) or a quantity. Lives on the company until signed internally.
- **Internal signing** — a register entry: this kesher צ׳ on the company, or this company item (or a quantity of it), is now with this soldier, since now, recorded by this commander. Open until a commander marks it returned or records the next entry for the same צ׳ (which closes it).
- **Where a piece of gear is** — the receiver of its open entry; with no open entry, its usual place: the kesher holder (or signer) for a kesher צ׳, the company for a company item.

## Internal signing (the company register)

Example: מחלקה 2 needs מחלקה 1's מגן מכלול for tomorrow's activity. מ״מ 2 opens החתמות → חדש, picks the צ׳ (shown with where it is now: "אצל <name>, מחלקה 1"), picks the soldier in מחלקה 2 who takes it, saves. The entry is open at once; the soldier gets a push and sees it on אני under "חתום עליי בפלוגה". When the device goes back, מ״מ 1 or 2 (or the company admin) taps **הוחזר**, and the צ׳ is back at its usual place.

- **What can be signed:** any kesher צ׳ whose `kesher_holders.unit_id` is the company, and any active company item. A quantity item can have several open entries as long as their total doesn't exceed `quantity`.
- **Who records and closes:** the company admin for anything in the company; a platoon commander when the gear is now with a soldier of their platoon (lending) or goes to one (borrowing).
- **From:** filled automatically from "where it is now" — never typed.
- **Passing it on:** a new entry for a צ׳ that already has an open one closes the old one (same transaction), so the register never shows it in two places.
- **The usual holder** sees the item on their אני with "נמצא אצל <name>" while it's lent out.
- **Departments** never see any of this; the kesher company page keeps showing kesher's own holder.

## Name changes

When a company admin or platoon commander approves a `full_name` change:

1. `people.full_name` is updated; the request row keeps the old name.
2. A push goes to the דוח 1 and kesher users who see that company ("שם של חייל עודכן בפלוגה" — no names in the push), so they fix their sheets.
3. The kesher and logistics import matchers also try the **previous names** of each soldier (the approved `company_profile_requests` rows for `full_name`). A row matched that way is shown in the preview as "לפי שם קודם", so the department sees it where it matters.

תפקיד changes need none of this: no import matches by it.

## Day counts

From the active round's `doch1_days` for the soldier, days up to and including today:

| Shown as | Counts days whose status has |
|---|---|
| נוכח | `counts_as_present` |
| בית | `home_day` |
| התארגנות | `org_day` |
| אחר | none of the above |

Planned future days are shown separately ("מתוכנן") and never added to the totals. A day with no row isn't counted. Statuses are versioned (`replaces_id`), so a past day keeps the flags it had.

## Data (proposed)

New tables, all with `.enableRLS()`, grants, `app.audit` and `app.touch_updated_at` triggers, and RLS tests:

| Table | Holds |
|---|---|
| `company_join_requests` | `auth_user_id`, `email`, `person_id` (matched soldier), `unit_id` (copied from the soldier by trigger, for RLS), `status` pending / approved / rejected, `decided_by`, `decided_at`. One open request per account. |
| `company_profile_requests` | `person_id`, `unit_id` (by trigger), `field` full_name / role_title, `old_value`, `new_value`, `status`, `requested_by`, `decided_by`, `decided_at`. One open request per soldier and field. |
| `company_items` | `unit_id`, `name`, `category`, `serial` (null = quantity item), `quantity`, `notes`, `active`. Serial unique within the company. |
| `company_signings` | `unit_id`, either `company_item_id` + `quantity` or `kesher_serial_id`, `from_person_id` (null = from the company), `to_person_id`, `signed_at`, `signed_by`, `returned_at`, `returned_by`. Open = `returned_at` is null. A partial unique index keeps one open entry per kesher צ׳ and per serial company item. |

`people.phone` and `people.full_name` / `role_title` are written only through the functions below. `app_users` gets nothing new: `person_id` already exists. No kesher or logistics table is written by this module.

## Security: functions and policies

- **`app.my_person_id()`** — `security definer`, returns the current user's linked, active soldier.
- **Reads for אני go through `security definer` functions**, not new policies on department tables: `app.my_gear()` (open logistics assignments and אפסון, kesher rows where I'm signer or holder, my open company signings) and `app.my_days()` (the active round's days and counts). Each returns only `my_person_id()`'s rows. This leaves every department's policies untouched — see "Calls I made".
- **`app.request_join(personal_number, phone_last4)`** — `security definer`, callable by a signed-in Google account with a verified email that has no linked soldier. Creates the `app_users` row if needed (inactive for everything but this flow), matches the soldier, and inserts a request. **Always returns the same answer** whether or not anything matched. Limited to a few attempts per account per day.
- **`app.approve_join(request_id)`** — company `admin` on the soldier's unit: sets `app_users.person_id`, closes the request. Rejecting closes it only.
- **`app.update_my_phone(phone)`** — writes `people.phone` for `my_person_id()` only, validated format.
- **`app.request_profile_change(field, value)` / `app.decide_profile_change(id, approve)`** — the second writes `people` on approve: company `admin`, or `platoon_commander` on the soldier's platoon.
- **`company_items`** — ordinary RLS: company `admin` writes; company members read.
- **`company_signings`** — read by company members of the unit and by a soldier who is its giver or receiver. Written only through `app.company_sign(item, to_person, quantity)` and `app.company_return(signing_id)` (`security definer`): they fill `from_person_id` from where the gear is now, close the previous open entry, check the quantity, and check the caller's role as in "Who records and closes".
- **What a commander may sign:** `app.company_register_items(unit_id)` lists the company's kesher צ׳ (item, צ׳, where it is now) and company items for a company member, so a platoon commander with no kesher membership can pick a kesher צ׳ without being given kesher read access.
- **The soldier picker** for the receiver: `app.company_soldier_names(unit_id)` returns id, full name and platoon of the company's active soldiers, for company members — no personal number, no phone.

## Screens

The module becomes its own app at `/company` with `<AppShell>` (tabs on the phone). A user whose only access is "linked soldier" lands on `/company/me` from the hub.

- **אני** (`/company/me`) — three cards: הציוד שלי (by source: לוגיסטיקה / קשר / חתום עליי בפלוגה; my own gear that's lent out shows "נמצא אצל <name>"), דוח 1 (today, the next days, the counts), הפרטים שלי (phone editable; name and תפקיד show "ממתין לאישור" while a request is open).
- **הפלוגה** (`/company/[unit]`) — the roster for the user's scope: each soldier's status today, gear count, phone. Clicking a soldier shows their אני view (read-only for the commander).
- **החתמות** (`/company/[unit]/signings`) — the register: open entries (filter by platoon; "של המחלקה שלי" first for a platoon commander) with a **הוחזר** button, and history. **חדש**: pick the gear (shows where it is now), the receiver and, for a quantity item, how many; save.
- **פריטי פלוגה** (`/company/[unit]/items`, admin) — the company's catalog.
- **דוחות** (`/company/[unit]/reports`) — three buttons, each shown only to a user who may file it, linking into the department's flow scoped to this company: **דוח 1 של היום** (`/doch1/today`), **שבצ״ק וכוננות** (`/doch1/standby`), **דוח צ׳** (`/kesher/check`). Each shows whether today's report is done, read from the department's own data.
- **הגדרות** (`/company/[unit]/settings`, admin) — join requests, change requests (the company's; a platoon commander sees their platoon's on הפלוגה), and roles: this module's and the department roles in "Granting department roles".
- **Join** (`/join`, replaces "אין לך עדיין גישה" for unlinked accounts) — personal number + last 4 phone digits → "הבקשה נשלחה למפקד".

## Notifications

Push (shared subscriptions): a company admin gets "בקשת הצטרפות חדשה"; the approver (company admin or the platoon commander) gets "בקשת עדכון פרטים"; דוח 1 and kesher users of the company get "שם של חייל עודכן בפלוגה"; a soldier gets "נרשם עליך ציוד בהחתמה פנימית" and "הבקשה שלך אושרה". No names or צ׳ in the text.

## Phases

1. **Join + אני (read-only) + self-edit** — the RLS groundwork (`my_person_id`, `my_gear`, `my_days`, join and profile functions) and the first thing every soldier uses.
2. **החתמה פנימית** — company items, the register, push.
3. **דוחות + הגדרות** — the three report buttons, roles inside the module, granting department roles, and the previous-name matching in the imports.

## Security and privacy

- **ביטחון מידע must approve before phase 1 ships**: it opens the platform to every soldier, and אני shows personal data.
- Personal numbers are typed by the soldier on the join screen and never shown back. The picker shows names only.
- Every write is audited (`app.audit`), including approvals and phone edits.

## Calls I made (check these)

1. **Reads for אני go through `security definer` functions**, not "me" clauses added to each department table's policies. Fewer policies to touch, one place to test; the cost is that אני can't reuse department queries as they are.
2. **No membership for soldiers.** Linking the account is the access; deactivating the soldier in דוח 1 ends it.
3. **A join with no match leaves no row.** The soldier sees the same "sent" screen; their commander, not seeing a request, tells them to check the number. A company admin can also link an account by hand from the roster.
4. **Only commanders record or close internal signings** — with no confirmation step, a soldier's own entry would be unchecked. Soldiers only see entries about them.
5. **The usual holder sees who has their gear** ("נמצא אצל <name>", a name only) — they're still the one the department holds responsible.
6. **"Last 4 phone digits"** as the second check on joining — it assumes `people.phone` is filled for most soldiers.
7. **Department roles go only to soldiers of the company** (users linked to a soldier in it), so a company admin can't hand access to someone outside it. Someone without a linked soldier (e.g. a battalion staffer) still gets roles from the department or `/admin`.
8. **Report buttons open the flow; nothing is sent.** Each button also shows whether today's report is done.
9. **The company `admin` role itself is given in `/admin`**, not by another company admin — one company admin can't create more of their own level.
10. **Name changes reach the sheets by hand.** The app flags them and the imports match the previous name; nobody writes to a Google Sheet.

### Made while building (phase 1)

11. **The `app_users` row is created on approval, not on request.** `app.request_join` writes only the request (on a match) and an attempt row; `app.approve_join` creates the account (or links an existing, active, unlinked one). A stranger who never matches leaves no account, and there's no "inactive but pending" state to confuse with an account a core admin disabled. A disabled account gets the same silent answer and is never approved (`GD106`).
12. **One active account per soldier.** Approving a second account for a soldier who already has one is refused ("פנו למנהל המערכת"); approving one cancels the soldier's other open requests. A changed Google account goes through a core admin.
13. **Nobody approves their own request** (join or change), except a super admin. A commander who is also a soldier gets their change approved by another commander.
14. **Rate limit:** 5 join attempts per Google account in 24 hours, counted in `company_join_attempts` (no grants; written only by `request_join`), whether or not they match. Personal numbers are compared as digits without leading zeros; the phone's last 4 digits after stripping everything but digits.
15. **Phones are stored as digits** starting with 0 (`+972` → `0`), 9–10 digits; shown as `050-1234567`.
16. **A commander's view of a soldier** uses the same functions as אני, which take a soldier id (`app.person_gear` / `person_days` / `person_details`) and answer only for the caller themselves or a soldier in the caller's `company` scope. `app.my_gear()` / `my_days()` are those for `my_person_id()`. The roster is `app.company_roster(unit)`.
17. **Linking by hand (call 3)** is an email: the company admin types the soldier's Google address on the soldier's page and it becomes an invite tied to the soldier (`app.company_link_account`), claimed by the usual `link_auth_user()` on sign-in.
18. **Push is sent by the cron job** (`/api/doch1/cron` → `lib/company/notify-job.ts`), like kesher's, never inside a request: each request row has `notified_at` / `decision_notified_at`, claimed by the job. A soldier can only subscribe once linked, so "הבקשה שלך אושרה" reaches them only on a device they subscribed later — in practice, approval is told in person.
19. **The old `user` memberships of `company` are deleted** by the migration (the module was a placeholder page, so they gave nothing); `platoon_commander` is given anew.
20. **The module's sections point at the user's first company**; a user covering several switches with the company pills on each page.

### Made while building (phase 2)

21. **Which kesher צ׳ can be signed:** a `kesher_serials` row with location `company` on that company (what kesher shows on the company page), with or without a holder row.
22. **A quantity item always comes "from the company".** Moving some of it from one soldier to another is הוחזר + a new entry; only one-piece gear (a kesher צ׳ or a company item with a צ׳) is passed on in one step.
23. **Every member of the company reads the whole register,** platoon commanders included (to see where a piece is before borrowing it). Names come through `app.company_register` / `company_register_items` / `company_soldier_names`, so a platoon commander gets other platoons' names without their `people` rows.
24. **If kesher moves a צ׳ off the company while it is lent internally,** the open entry stays (and can be closed with הוחזר); the צ׳ just stops being offered in חדש.
25. **Company items are deactivated, not deleted,** in the UI (a deleted item would drop its history; the FK refuses it once signed). Its quantity can't go below what is signed out.
26. **"הוחזר" asks for a second tap**, since there's no confirmation by the receiver.

### Made while building (phase 3)

27. **"Done today" on the report buttons:** דוח 1 — the listed soldiers of the company (or of the platoon, for a platoon commander) without a status today; שבצ״ק וכוננות — there is no daily שבצ״ק report to be done, so it shows the listed soldiers without a שבצ״ק location; דוח צ׳ — whether one was filed today (Israel date) and if everything was found. Each is read with the user's own department access.
28. **Who sees each button:** דוח 1 — a דוח 1 admin / company user / platoon commander covering the company or one of its platoons (a platoon commander's button opens their platoon); שבצ״ק — a דוח 1 admin or company user of the company; דוח צ׳ — any kesher role covering the company. Links: `/doch1/today?unit=`, `/doch1/standby?co=`, `/kesher/check?unit=`.
29. **Roles given in הגדרות are marked** (`memberships.via_company`), set only inside `app.company_grant_role` (a trigger keeps everyone else from setting it, and clears it when `/admin` or a master admin changes that membership's role or unit). Only marked roles can be revoked there; the rest show read-only.
30. **A company admin doesn't grant roles to their own account,** and gives this module's `platoon_commander` on a platoon only (the company `admin` role stays in `/admin`, call 9).
31. **Granting on a (module, unit) where the account already has a role:** a role given here is changed; one given in a department or `/admin` is left alone and the grant is refused (`GD117`).
32. **Previous names are readable by whoever sees the soldier** (an approved full_name change row, under the same unit rule as `people`), so the imports read them with the importer's own access. A previous name is tried only when no current name matches; a previous name shared by two soldiers is an error in logistics and falls through to the close-match pick in kesher. The דוח 1 sheet imports are unchanged (the spec names kesher and logistics).

## Answered (2026-10-28)

1. **Getting in** — self-signup with the personal number, approved by the company admin.
2. **Self-edit** — phone direct; name and תפקיד by approval.
3. **Internal signing** — the company's own register (where gear is, e.g. a loan between platoons) for kesher gear on the company and the company's own items; nothing written to the departments, no confirmation, no return date.
4. **Day count** — the active round, split by type.
5. **Roles** — מ״פ / סמ״פ / רס״פ admin; מ״מ records their platoon's internal signings and approves its detail changes.
6. **Reports** — דוח 1 של היום, שבצ״ק וכוננות, דוח צ׳.
7. **הגדרות** — also grants company-level, non-admin department roles.
8. **שגרת קו / משמרות** — dropped from this module.
9. **Kesher gear in the register** — stays in the company; kesher's records untouched.
10. **Logistics gear** — shown, not moved.
11. **Name changes** — update the app, flag to the departments, imports also try the previous name.

## Changes requested 2026-10-28 (after phase 3)

Answered with the user after using the first version; these replace the matching parts above (in particular the non-goals "Moving logistics gear" and "Sending reports … opens the department's existing flow", decision 10, and call 28's links).

1. **Searching gear in החתמות → חדש.** First pick the department — **לוגיסטיקה / קשר / פריטי פלוגה** — then one search box: free text on צ׳ or item name, with autocomplete as you type. Each suggestion shows the item, its צ׳ and where it is now. No long select lists.
2. **Logistics gear joins the register** (register only, like kesher): any open `logistics_assignments` row of a soldier of the company can be signed internally. "From" is that soldier (or the receiver of the open entry). Logistics' own records are never written; אפסון items are not offered (they aren't in hand). `company_register_items` and `company_signings` get the logistics source alongside kesher and company items.
3. **Reports are filled inside the company app** — no navigation to דוח 1 or קשר. `/company/[unit]/reports/…` pages for **דוח 1 של היום** (the company's soldiers, or the platoon's for a platoon commander), **שבצ״ק וכוננות** (only the company's own teams and vehicles, see 4) and **דוח צ׳** (the company's kesher צ׳). They write the same tables through the same rules as the department pages; build them from the department's components, extracted to be shared, not copied. Who may fill each is as in call 28, except שבצ״ק (4).
4. **Each company owns its כוננות / שבצ״ק — same data, no sync.** `doch1_vehicles` and `doch1_standby_teams` get a nullable `unit_id` (null = battalion). A company builds its teams (company-level type, location, a vehicle of its own, members from its own soldiers) in its app, and the דוח 1 standby page shows the same rows, grouped by company. Battalion teams stay with the דוח 1 admin.
   - A company team is edited by the company `admin` (this module) or a דוח 1 `admin` / `company_user` on that company. A trigger keeps its members to soldiers of that company and its vehicle to that company's vehicles.
   - Vehicles are assigned to a company by a דוח 1 admin in דוח 1's vehicle list; the company sees only its own.
   - Migration: an existing team whose members are all in one company gets that company; the rest, and all vehicles, stay battalion (null) until a דוח 1 admin assigns them.
5. **פעילות** — a one-time activity with who goes, in its own tab (`/company/[unit]/activities`). `company_activities` (`unit_id`, name, date, start/end time, place, commander, notes) with its participants (soldier, role text) and vehicles (the company's own). Created and edited by the company `admin` and platoon commanders. **The participant picker offers only soldiers of the company whose דוח 1 status that day is present and not home** (`counts_as_present` and not `home_day`; the planned status for a future day; no status = not offered). If a participant's status later changes to one that doesn't qualify, the activity flags them ("לא נוכח לפי דוח 1"). It writes nothing to דוח 1. Participants see upcoming activities on אני.
6. **Vehicles page** (`/company/[unit]/vehicles`) — each of the company's vehicles with the kesher צ׳ mounted on it, its ציוד משלים, and the standby team that uses it. **The company `admin` edits the kesher gear** with the same rules and events as `/kesher/vehicles`: mount / unmount a צ׳ that is on the company; set ציוד משלים quantities, where an increase comes out of the kesher warehouse (needs that many תקינים there) and a decrease returns to it. Writes go through `security definer` functions that check the vehicle and the צ׳ belong to the company; every change is a kesher `serial_edit` / `vehicle_stock` event with who made it, so kesher sees it in its יומן.
7. **A "חזרה" button** in the shell header on every page reached from somewhere else in the app (a soldier from the roster, a report from the reports tab, a link from the hub): it returns to the page the user came from, or to the module's home when there is none.
8. **Platoon names on the company page are too crowded.** Rework how the roster shows platoons (e.g. a header per platoon instead of a name on every row, or a platoon filter) — check it on a phone width.

### Calls I made (check these)

33. **Fill rights for דוח 1 של היום and דוח צ׳ inside the company app stay with the department roles.** A company admin who lacks one can grant it (only to others — call 30), or a department admin can.
34. **Only the company `admin` edits kesher gear on vehicles,** not platoon commanders. This lets a company draw ציוד משלים from the battalion warehouse without a kesher admin — the user chose it knowingly; kesher sees every change in its יומן.
35. **Unmounting a צ׳ from a company vehicle leaves it on the company** (its location doesn't change), as on `/kesher/vehicles`.
36. **A platoon commander adds only their own platoon's soldiers** to a פעילות; the company admin adds anyone in the company.

### Made while building (after phase 3)

37. **Logistics gear in the register is "in the company" by its holder:** the company of the soldier with the open logistics assignment owns the entry (`company_logistics_serials`). If logistics returns or transfers the צ׳ while it is lent internally, the open entry stays and can be closed with הוחזר, as with kesher (call 24).
38. **חדש searches the receiver too** (by name, the commander's own platoon first), not only the gear — the same "no long select lists" reason.
39. **"חזרה" is in the shared app shell, so every module gets it:** it goes back when the app has a page before this one in this tab (client navigations, the hub included), otherwise to the module's first section; it is hidden on that first section when there is nothing to go back to. On the phone it's in the top bar, on the desktop above the page.
40. **The roster is one card per platoon** (a header with the count and how many have no דוח 1 today; company-level soldiers first, as "מפקדה"), rows show name, תפקיד and gear count, today's status and a call button; platoon filter as pills with counts.

41. **Company teams and holders (answered 2026-10-28):** `unit_id` is the team's owner and its only holder (a trigger keeps the holder in step). Teams held by several companies stay battalion, and their companies' דוח 1 company users keep editing them as before; a team the battalion admin wants shared is "גדודי" in the team editor.
42. **Migration (answered):** a team whose members are all of one company *and that no other company holds* becomes that company's; its vehicle moves with it when only that company's teams use it; a team whose vehicle can't move stays battalion.
43. **New vehicles (answered):** a vehicle a company adds from its own team (in its app or in דוח 1) is that company's; a דוח 1 admin moves vehicles between companies (the vehicles list in דוח 1 now has a company select for the admin).
44. **A team a company user opens in דוח 1 is now the company's own team;** the דוח 1 admin may open a shared (battalion) one instead.
45. **What a company admin without a דוח 1 role reads:** the round, its statuses, value lists, locations and standby types, and their company's soldiers' round rows and days — what the standby screen needs. Read only: filling דוח 1 stays with the דוח 1 roles (call 33). A platoon commander of the module gets none of this.
46. **The דוח 1 standby page groups teams by owner** (גדודיים, then each company's); the company's screen shows only its own teams and vehicles. Soldiers' שבצ״ק locations are shown on the company's screen too, editable with the דוח 1 roles as before.
47. **Shared screens:** `TodayScreen` (doch1/today/today-screen.tsx), `StandbyScreen` / `TeamScreen` (doch1/standby/…) and `CheckScreen` (kesher/check/check-screen.tsx) are the department pages' bodies with a path and a company limit; the department pages render them too. A soldier in the company's דוח 1 opens in the company app.

48. **The פעילות rule is checked in the database too,** not only by the picker: adding a soldier who isn't present-and-not-home that day is refused (`GD118`). Changing an activity's date removes nobody; the list flags who no longer qualifies.
49. **Who edits a פעילות:** any commander of the company (its admin or one of its platoon commanders) edits the details and vehicles; adding and removing soldiers follows call 36 (a platoon commander only their platoon's soldiers).
50. **The commander of a פעילות is a soldier of the company** (picked by name); the company's own vehicles are now readable by every member of the company (platoon commanders put them on activities).
51. **A soldier sees an activity they take part in** (name, day, times, place, their role, the commander) on אני, but not the list of the other participants.

## Left to the builder

Exact column types and indexes, the rate-limit mechanism on `request_join`, phone format validation, component breakdown, how the roster paginates, and the wording of individual messages (Hebrew, specific, says what to fix).
