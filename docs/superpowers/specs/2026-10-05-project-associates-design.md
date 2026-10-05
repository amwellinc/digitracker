# Project Associates — Design

**Date:** 2026-10-05
**Status:** Approved in conversation; awaiting written-spec review
**Builds on:** [2026-09-21-projects-feature-design.md](2026-09-21-projects-feature-design.md)

## Goal

Let Super-Admins and Admins bring outside collaborators ("associates") into a
Project by email. An associate is not a member of any workspace (sub-account),
can sign in to DIGITRACKER, sees **only** the projects they've been added to,
and receives an in-app notification **and** an email whenever something
relevant happens in those projects.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What can an associate do in a project? | View tasks/comments/members, comment and attach files on any task, change the **status** of tasks assigned to them. Cannot create, delete, or assign tasks, or manage members. |
| Which events notify them? | Added to project; task assigned to them; new comment on a task assigned to them; any new task or task status change in the project. |
| Where are associates managed? | Inside each project's member panel only. No separate associates page. |
| Architecture | New `Associate` role with a database-level restrictive lock (Approach A). |

Assumptions confirmed by not being corrected:
- An associate can belong to several projects.
- An Admin can invite associates only to projects the Admin is a member of; a Super-Admin can invite to any project. Managers and Staff cannot invite.
- One email = one account. An email that already belongs to a workspace user cannot be made an associate.

## 1. Accounts and security

### 1.1 Data model

- `users.role` check constraint gains `'Associate'`.
- Associates have `users.sub_account = 'ASSOCIATE'` — a sentinel that matches no
  real sub-account (`users.sub_account` has no foreign key, so this is valid).
  `ASSOCIATE` is reserved: sub-account creation must reject it as a code.
- Workspace-only columns (leave balances, reporting times, manager, department,
  payroll) keep their defaults and are never shown for associates.
- New helper `public.is_associate()` — `security definer stable`, true when the
  caller's active `users` row has role `Associate`.

### 1.2 Restrictive lock on every non-project table

For every table in `public` **except** `projects`, `project_members`,
`project_tasks`, `project_task_assignees`, `project_task_comments`,
`notifications`, and `users`, add:

```sql
create policy "<table>_deny_associates" on public.<table>
  as restrictive for all to authenticated
  using (not public.is_associate())
  with check (not public.is_associate());
```

Restrictive policies are AND-ed with all permissive policies, so no existing or
future permissive policy can grant an associate access to these tables.

Tables that associates touch get targeted rules instead of a blanket deny:

- `users` — restrictive select policy: an associate may read only their own row
  and rows of users who share a project with them (needed for names/avatars).
  Restrictive deny on insert/update/delete for associates — they cannot edit
  any `users` row, including their own (profile editing is out of scope).
- `notifications` — existing own-row select/update policies already suffice;
  the existing "Admin/Manager/Super-Admin can read all" branch does not apply
  to associates.
- Storage: the `task-attachments` bucket stays as-is (associates need it for
  comment attachments); every other bucket gets a restrictive associate deny on
  `storage.objects` scoped by `bucket_id`.

A migration test (SQL, run in CI after `db push`) queries `pg_tables` and
`pg_policies` and fails if any `public` table outside the allow-list lacks a
`*_deny_associates` policy, so a future table can't silently skip the lock.

### 1.3 What associates can do inside projects

| Action | Rule |
|---|---|
| Read project, tasks, assignees, comments | Unchanged — existing `is_project_member` policies. |
| Insert comment / attachment | Unchanged — existing comment insert policy. |
| Update a task | New restrictive update policy: associates may update only tasks where they are in `project_task_assignees`. A `before update` trigger raises if an associate changes any column other than `status`. |
| Insert / delete tasks | Restrictive deny for associates. |
| Write `project_task_assignees` | Restrictive deny for associates. |
| Add/remove members | `add_project_member` / `remove_project_member` already reject non-Admin/Manager/Super-Admin callers. |

### 1.4 Limits

- `sub_account_seat_count` excludes role `Associate` (they never hit `ASSOCIATE`
  anyway, but the explicit exclusion documents intent).
- `add_project_member`'s 3-workspace cap counts `distinct sub_account` **excluding**
  `'ASSOCIATE'`; the "same-workspace only" rule for Admin/Manager callers is
  bypassed for associate targets (they have no workspace).

### 1.5 Removal

`remove_project_member`: if the removed user is an associate and now belongs to
zero projects, set `users.status = 'suspended'`. The existing suspension
machinery (auth helpers resolve to NULL, login shows "suspended") then blocks
sign-in. Re-inviting them reactivates the account.

## 2. Inviting and the associate experience

### 2.1 Invite UI

- **Super-Admin:** `ProjectDetailPanel` (Platform Admin → Projects) gets an
  "Invite associate" form: email + name.
- **Admin who is a project member:** same form on `ProjectPage`, shown only for
  role `Admin` (not Manager/Staff).
- Associates are shown with an **Associate** badge in member lists.

### 2.2 `invite-associate` edge function

Request: `{ projectId, email, name }`. Steps:

1. Verify the caller's session; load caller's active `users` row.
2. Authorize: Super-Admin, or Admin who is a member of `projectId`. Otherwise 403.
3. Validate email format and non-empty name.
4. Look up `users` by email (case-insensitive):
   - **None:** insert `users` row (`role='Associate'`, `sub_account='ASSOCIATE'`,
     `status='active'`), then send a sign-in invite via
     `admin.auth.admin.generateLink({ type: 'magiclink' })` delivered through
     platform SMTP (falling back to `inviteUserByEmail`, as in
     `provision-subscription`).
   - **Existing associate:** set `status='active'` if suspended.
   - **Existing workspace user:** return 409 "This email belongs to a workspace
     user — add them as a normal member instead."
5. Insert `project_members` row (service role, bypassing the RPC's caller-role
   checks after step 2 has authorized). Insert the `project_added` notification
   (same text as `add_project_member`). Already a member → no-op, 200.
6. Return `{ status: 'invited' | 'added' | 'already_member', emailSent, error? }`.

The "added to project" email is sent by the notification email pipeline (§3),
not separately here, to avoid duplicates.

### 2.3 Associate experience

- `AuthContext` exposes `isAssociate`.
- `Layout`: for associates, `NAV` = project entries only; clock widget, status
  badge, and any time-tracking side effects (screen capture, idle tracking,
  clock auto-recovery) are not mounted.
- `Router`: an `AssociateGuard` wraps every non-project route; associates are
  redirected to `/projects/<first project id>`, or to `/no-projects` if they
  have none.
- `/no-projects` page: "You haven't been added to a project yet. Contact the
  person who invited you."
- A notifications bell (reusing the Dashboard's list rendering, extracted into
  a shared `NotificationsList` component) is shown in the header for associates.

## 3. Notifications

### 3.1 Events

| Event | Trigger | Recipients | Type |
|---|---|---|---|
| Added to project | `add_project_member` / `invite-associate` | The added user (existing behaviour, all roles) | `project_added` |
| Task assigned | `after insert` on `project_task_assignees` | That user, if an associate | `project_task_assigned` |
| New comment | `after insert` on `project_task_comments` | Associates assigned to the task | `project_task_comment` |
| New task | `after insert` on `project_tasks` | All associates in the project | `project_task_created` |
| Status change | `after update of status` on `project_tasks` (status actually changed) | All associates in the project | `project_task_status` |

The actor (`auth_user_app_id()`) is never notified about their own action. Each
recipient gets at most one notification per triggering row.

### 3.2 Email delivery

- `after insert` trigger on `notifications`: when `type = 'project_added'`
  (any recipient role), or when `type` starts with `project_` and the
  recipient is an associate, call `net.http_post` (pg_net) to the new
  `send-notification-email` edge function with `{ notificationId }` and a
  shared secret header.
- The secret lives in Supabase Vault (`vault.decrypted_secrets`) for the
  trigger and as an edge function secret for verification; the function is
  deployed `--no-verify-jwt` and rejects any request without the secret.
- `send-notification-email` loads the notification + recipient + project,
  sends one email via `getPlatformSmtp`, with a link to
  `https://digitracker-app.digi5y.co/#/projects/<id>`.
- Failures are logged (`console.error`) and never affect the in-app
  notification. No retries in this iteration.
- Because this trigger now emails every `project_added` notification, the
  client-side `notifyProjectMember` calls (added 2026-10-05) and the
  `notify-project-member` edge function are removed in the same change, so
  nobody gets the "added to project" email twice. The Add panel's
  "email could not be sent" message goes away with it (delivery is now
  asynchronous; failures are visible in the edge function logs).

### 3.3 UI

`Notification['type']` gains the four new types; `notifIcon` maps them
(✅ assigned, 💬 comment, 🆕 created, 🔄 status).

## 4. Testing

- **Vitest:** associate nav filtering in `Layout`; `AssociateGuard` redirects
  (with projects → first project, none → `/no-projects`); invite form states
  (success new, success existing, 409 workspace user, error); form hidden for
  Manager/Staff; new notification icons.
- **SQL verification after deploy** (run as a temporary test associate via
  the Supabase API with that user's session):
  - cannot select from `time_logs`, `leave_requests`, `tasks`, `documents`,
    other users outside shared projects;
  - can select own project; cannot select a project they're not in;
  - can update `status` on own assigned task; update of `title` raises;
    update of an unassigned task affects 0 rows;
  - insert/delete on `project_tasks` denied.
- **Live check:** invite a real test mailbox, confirm invite + `project_added`
  emails arrive and a status change triggers an email; then remove the test
  associate and confirm the account is suspended.

## Out of scope

- A global associates management page.
- Daily digest emails / notification preferences.
- Email notifications for regular (non-associate) members beyond the existing
  `project_added` email.
- Retrying failed emails.
