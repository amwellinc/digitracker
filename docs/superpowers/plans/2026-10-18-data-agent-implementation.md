# Data Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Data Agent" feature to DigiTracker — a per-sub-account, Super-Admin-entitled tool that migrates a client's CSV export into their own GHL whitelabel CRM (Contacts or a Custom Object) with a deterministic-rules-first, Claude-assisted-second mapping engine, explicit human confirmation of anything uncertain, replace-semantics writes, post-write accuracy sampling, and user-triggered rollback — and let a sub-account Super-Admin designates as a **service provider** (e.g. AM333) run this same workflow on behalf of other sub-accounts (e.g. JOY Consultancy) it's authorized to service, while each sub-account keeps its own independent login and owns its own GHL connection.

**Architecture:** Eleven new `data_agent_*` tables gated by a single SECURITY DEFINER helper `is_data_agent_member(sub_account)` (mirroring `is_project_member()`). A zero-import pure TS module owns the deterministic rules-tier matching logic so it gets real Vitest coverage despite living under `supabase/functions/_shared/`. Upload, Claude-tier mapping, the prompt feature, and the write/QA/rollback pipeline are separate edge functions; the pipeline itself is a cron-polled worker (status-table-driven, not chained invocations) that advances `data_agent_migrations` through `uploaded → mapping → awaiting_confirmation → migrating → verifying → completed`, with `undoing → undone` as a parallel user-triggered branch. GHL's PIT lives only in Supabase Vault; the Anthropic key is an edge-function-only secret.

**Tech Stack:** Supabase Postgres (RLS, plpgsql, pg_cron, pg_net, Vault), Deno edge functions, React 18 + TS + react-router-dom 6 (HashRouter), Tailwind, Vitest + Testing Library, `corepack pnpm`.

**Spec:** [docs/superpowers/specs/2026-10-18-data-agent-design.md](../specs/2026-10-18-data-agent-design.md)

**Repo:** `/Users/arunkemer/DIGI5Y/digitracker`, branch `feat/data-agent`.

## Global Constraints

- New migrations are timestamp-named after `20261010000000`: use `20261018000000_data_agent_entitlements_connections.sql`, `20261018000100_data_agent_migration_pipeline.sql`, `20261018000200_data_agent_cron_worker.sql`. Never edit an applied migration.
- **Never silently guess.** A column mapping that isn't deterministically certain (yellow/uncertain or red/unmapped) can never let its migration leave `mapping` for `awaiting_confirmation`, and nothing is written to GHL from an unconfirmed guess (spec §1, §6.4).
- **Claude is never green.** Any Claude-sourced mapping proposal is `status: uncertain` (yellow) regardless of its reported confidence — never auto-promoted (spec §6.4).
- **One target object per upload, never inferred.** The user explicitly picks Contacts or one specific Custom Object key at upload time; a file is never split or combined across object types (spec §5).
- **Replace, not merge.** When an upload row matches an existing GHL record, every field the upload maps overwrites the existing value wholesale — no "only fill blanks," no preserving old values in mapped fields (spec §7.3).
- **Secrets stay server-side.** The GHL PIT is Supabase Vault only, never returned to the browser, read only inside an edge function at the moment of an API call. The Anthropic key is an edge-function secret only — no client-side Claude calls (spec §13, §3).
- **No live third-party fetches.** Source-system knowledge is the curated `data_agent_source_profiles` table only, built ahead of time — no runtime fetch to any CRM's docs/support site (spec §13, §6.2).
- **429 ≠ failure.** A GHL `429` triggers backoff and retry on a later worker tick; other rows in the same batch continue regardless of one row's outcome (spec §7.4).
- **Every edge function invoked from the browser (`supabase.functions.invoke`) returns HTTP 200 for every business outcome, never a 4xx/5xx.** Confirmed by reading the installed `@supabase/functions-js` source: a non-2xx response makes the client throw `FunctionsHttpError`, whose `.message` is always the fixed string `"Edge Function returned a non-2xx status code"` — never the function's own `error` text, which only reaches `error.context` (unread by this plan's UI code). Business failures are communicated via `{ ok: false, error: '...' }` (or `{ error: '...' }` with no success field) in a 200 response body; the calling UI reads `data.error`, not `error.message`. Only true protocol-level cases (CORS preflight, wrong HTTP method) keep a real status code. This does not apply to `data-agent-worker`, which `pg_cron`'s `net.http_post` calls directly, not the browser SDK.
- **Real typecheck for `supabase/functions/_shared/*.ts` pure modules is `node_modules/.bin/tsc --noEmit -p supabase/functions/tsconfig.json`** (created in Task 6), not the root `tsc --noEmit` — the root config's `include: ["src"]` never sees anything under `supabase/functions/`, so running it against that directory is a silent no-op, not a real check. Still run the root `tsc --noEmit` too, to confirm no frontend regression — just don't mistake its silence for having checked the edge-function code.
- **Never forward an unverified third-party API's raw response text to the browser.** GHL's Custom Objects surface is explicitly flagged elsewhere in this plan as newer/less-documented; an error body from it could echo back some form of a submitted credential. Log the full upstream error server-side (`console.error`) and return a generic client-facing message for any catch block that wraps a GHL call.
- **Every SECURITY DEFINER boolean helper in this feature must return `true`/`false`, never `null`** — wrap the body in `coalesce(..., false)`. `auth_user_role()`/`auth_user_sub_account()`/`auth_user_app_id()` all resolve to `null` for a suspended or deleted-but-still-logged-in caller, which is harmless in an RLS `USING`/`WITH CHECK` clause (`null` excludes a row exactly like `false`) but silently skips the exception in any PL/pgSQL `if not <helper>(...) then raise exception` — confirmed as a real, repeated bug class in this plan (Task 1's `save_data_agent_connection`, Task 7's discovery that `is_data_agent_member()` itself needed this). Every imperative call site also wraps the check in `coalesce(..., false) is not true` as defense in depth, never relying solely on the helper's own contract.
- **Only Super-Admin grants a service-provider relationship.** A sub-account gains the right to operate Data Agent for another sub-account only via a `data_agent_provider_clients` row Super-Admin created — never self-granted by either sub-account's own Admin (spec §2.1). The client sub-account must independently be entitled; the grant only extends *who* may act once it is.
- **A provider never touches a client's connection.** `data_agent_connections` stays scoped to, and owned by, the sub-account whose CRM it is — a provider's Settings page never shows or accepts a client's PIT (spec §2.1, §13).
- **Associates are categorically excluded.** Every new table gets its own `<table>_deny_associates` restrictive policy in the same migration that creates it (enforced by the existing generic test in `src/__tests__/associateLock.test.ts`: *"every table created after the lock migration gets its own \*_deny_associates policy"*) — Data Agent is not part of the Associate's allowed scope. No new RPC name is added to `associate_request_guard()`'s allow-list, and no bucket is added to `storage_associate_scope`'s allow-list.
- Commands: `corepack pnpm vitest run [path]`, `corepack pnpm tsc --noEmit`. Commits: conventional, ending `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## Review Focus

1. **A CSV column with entirely blank sample values** (an optional field nobody filled in) must not crash the matching engine or the upload UI — it must resolve to a defined status (pinned by a unit test in Task 6, and an upload-function integration test in Task 8).
2. **A genuine GHL validation error vs. a 429** must be told apart: the former records `write_status: failed` with the error visible and does not retry; the latter backs off and retries on a later tick without marking the row failed (Task 15).
3. **Two source rows in one upload matching the same existing GHL record** (duplicate emails in the file) — the second row's `pre_replace_snapshot` must capture the state right before *that* row's write (i.e., already reflecting the first row's change), not the original pre-upload state, so rollback of the second row doesn't resurrect data the first row legitimately overwrote (Task 15).
4. **A migration abandoned mid-`mapping`** (never confirmed) must not read as the Dashboard's "most recent migration" success signal, and must not skew the aggregate accuracy-rating average — only `completed` migrations count toward that average (Task 19).
5. **Undo requested after the sub-account's GHL connection has since changed** (PIT or location swapped) — rollback must use whatever connection is current at undo time, the same as any other write, and must surface a clear per-record error rather than silently no-op if that now points at a different location than the data was originally written to (Task 18).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261018000000_data_agent_entitlements_connections.sql` | `data_agent_entitlements`, `data_agent_members`, `data_agent_connections`, `data_agent_ghl_schema_cache`; `is_data_agent_member()`; `save_data_agent_connection()`; RLS + `_deny_associates` |
| `supabase/migrations/20261018000100_data_agent_migration_pipeline.sql` | `data_agent_migrations`, `data_agent_column_mappings`, `data_agent_migration_records`, `data_agent_qa_samples`, `data_agent_source_profiles` (+seed), `data_agent_chat_messages`, `data_agent_prompts`; `confirm_data_agent_migration()`; storage bucket `data-agent-uploads`; RLS + `_deny_associates` |
| `supabase/migrations/20261018000200_data_agent_cron_worker.sql` | `pg_cron` job polling `net.http_post` into `data-agent-worker` every minute |
| `src/types/dataAgent.ts` | Shared frontend types mirroring the schema |
| `src/hooks/useDataAgentAccess.ts` | Nav/route gating hook (mirrors `useReportsAccess`) |
| `src/app/Layout.tsx`, `src/app/Router.tsx` | Nav entry + route registration |
| `src/features/data-agent/entitlements/DataAgentEntitlementsTab.tsx`, `SuperAdminPage.tsx` | Super-Admin per-sub-account toggle |
| `src/features/data-agent/settings/DataAgentSettingsTab.tsx`, `SettingsPage.tsx` | Connection form + team-access list |
| `supabase/functions/_shared/dataAgentGhlClient.ts` | GHL API wrapper (schema fetch, contact upsert, object CRUD) |
| `supabase/functions/data-agent-test-connection/index.ts` | Validates PIT/location, populates schema cache |
| `supabase/functions/_shared/dataAgentMatching.ts` | Zero-import pure rules-tier matching logic |
| `supabase/functions/_shared/parseCsv.ts` | Zero-import pure CSV parser |
| `supabase/functions/data-agent-upload/index.ts` | Parses CSV, creates migration + column mappings, runs rules tier (+Claude tier after Task 12) |
| `src/features/data-agent/DataAgentPage.tsx`, `upload/NewMigrationModal.tsx` | Entry point, target-object + source-system + file picker |
| `src/features/data-agent/mapping-review/MappingReviewPage.tsx` | Green/yellow/red review, manual remap, prompt box, confirm gate |
| `supabase/functions/_shared/dataAgentClaude.ts` | Claude-tier mapping proposals for uncertain columns — imported directly by `data-agent-upload` (Task 12), not a separate network hop |
| `supabase/functions/data-agent-prompt/index.ts` | Free-text per-column prompt feature |
| `supabase/functions/data-agent-worker/index.ts` | Cron-polled: migrating / verifying / undoing phases |
| `src/features/data-agent/dashboard/DataAgentDashboard.tsx` | Aggregate stats, latest migration, accuracy, members |
| `src/features/data-agent/chat/DataAgentChat.tsx` | Realtime sub-account-wide chat panel |
| `supabase/migrations/20261018000400_data_agent_provider_clients.sql` | Service-provider grants; redefines `is_data_agent_member()` to recognize them |
| `src/features/data-agent/entitlements/ProviderClientsPanel.tsx` | Super-Admin UI to grant/revoke which sub-account services which |
| `src/features/data-agent/workspace/DataAgentWorkspaceSwitcher.tsx` | Lets a provider's user pick which workspace (own, or a client's) to operate in |

---

### Task 1: Entitlements, connection, schema cache

**Files:**
- Create: `supabase/migrations/20261018000000_data_agent_entitlements_connections.sql`

**Interfaces:**
- Produces: tables `data_agent_entitlements(sub_account text pk, enabled boolean, enabled_by uuid, enabled_at timestamptz)`, `data_agent_members(sub_account text, user_id uuid, added_by uuid, added_at timestamptz, pk(sub_account,user_id))`, `data_agent_connections(sub_account text pk, ghl_location_id text, secret_name text, connected_by uuid, connected_at timestamptz, last_verified_at timestamptz)`, `data_agent_ghl_schema_cache(id uuid pk, sub_account text, object_type text, fields jsonb, fetched_at timestamptz, unique(sub_account,object_type))`; SQL `public.is_data_agent_member(p_sub_account text) returns boolean`; RPC `public.save_data_agent_connection(p_sub_account text, p_ghl_location_id text, p_pit text) returns void`.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 20261018000000: Data Agent — entitlements, membership, GHL
-- connection, and schema cache (spec 2026-10-18-data-agent-design.md §2-3).
--
-- Any table created after 20261006000100_associates_lock.sql must add its
-- own "<table>_deny_associates" policy (enforced by the generic test in
-- src/__tests__/associateLock.test.ts) — Data Agent is not part of the
-- Associate's allowed scope.

create table public.data_agent_entitlements (
  sub_account text primary key references public.sub_accounts(code) on delete cascade,
  enabled     boolean not null default true,
  enabled_by  uuid references public.users(id) on delete set null,
  enabled_at  timestamptz not null default now()
);

create table public.data_agent_members (
  sub_account text not null references public.sub_accounts(code) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  added_by    uuid references public.users(id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (sub_account, user_id)
);

create table public.data_agent_connections (
  sub_account       text primary key references public.sub_accounts(code) on delete cascade,
  ghl_location_id   text not null check (length(trim(ghl_location_id)) > 0),
  secret_name       text not null,
  connected_by      uuid references public.users(id) on delete set null,
  connected_at      timestamptz not null default now(),
  last_verified_at  timestamptz
);

create table public.data_agent_ghl_schema_cache (
  id          uuid primary key default gen_random_uuid(),
  sub_account text not null references public.sub_accounts(code) on delete cascade,
  object_type text not null,
  fields      jsonb not null default '[]'::jsonb,
  fetched_at  timestamptz not null default now(),
  unique (sub_account, object_type)
);

-- ── Access gate ─────────────────────────────────────────────────────────────
-- Mirrors is_project_member(): one helper, every policy in this feature
-- uses it. Entitled AND (Super-Admin OR that sub-account's Admin OR a
-- data_agent_members row for that sub-account).
--
-- NOTE on execution history: this task was already implemented and
-- committed before Task 7's review found that the version below (without
-- the coalesce wrap) fails open for a suspended/deleted caller. Rather
-- than edit Task 1's already-applied migration, the fix landed as a
-- `create or replace` inside Task 7's own migration file, immediately
-- before `confirm_data_agent_migration` — see that task. The text below
-- is corrected so a fresh implementation from this plan gets the safe
-- version on the first pass; it is not what Task 1's commit literally
-- contains if you're diffing against this plan's execution history.
-- coalesce(..., false) at the top level is required, not optional style:
-- auth_user_role()/auth_user_sub_account()/auth_user_app_id() all resolve
-- to NULL for a suspended or deleted-but-still-logged-in caller (migration
-- 027), which would otherwise make this whole expression evaluate to NULL
-- instead of false. That's harmless everywhere this function is used
-- inside an RLS USING/WITH CHECK clause (NULL and false both exclude the
-- row) — but a PL/pgSQL caller doing `if not is_data_agent_member(...)
-- then raise exception` is not RLS: `if NULL then` never executes the
-- branch, so a NULL return here would silently skip the exception. This
-- function's contract must be "true or false, never null" for every
-- caller, imperative or declarative, to be safe.
create or replace function public.is_data_agent_member(p_sub_account text)
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select coalesce(
    exists (select 1 from public.data_agent_entitlements e where e.sub_account = p_sub_account and e.enabled)
    and (
      public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_sub_account() = p_sub_account
        and (
          public.auth_user_role() = 'Admin'
          or exists (select 1 from public.data_agent_members m where m.sub_account = p_sub_account and m.user_id = public.auth_user_app_id())
        )
      )
    ),
    false
  )
$$;
revoke execute on function public.is_data_agent_member(text) from public, anon;
grant execute on function public.is_data_agent_member(text) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.data_agent_entitlements enable row level security;
alter table public.data_agent_members enable row level security;
alter table public.data_agent_connections enable row level security;
alter table public.data_agent_ghl_schema_cache enable row level security;

create policy data_agent_entitlements_select on public.data_agent_entitlements
  for select using (public.is_data_agent_member(sub_account));
create policy data_agent_entitlements_write on public.data_agent_entitlements
  for all using (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');

create policy data_agent_members_select on public.data_agent_members
  for select using (public.is_data_agent_member(sub_account));
create policy data_agent_members_write on public.data_agent_members
  for all using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = sub_account)
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = sub_account)
  );

-- Connections: readable by members; no insert/update/delete policy at all
-- (default-deny) — the only write path is save_data_agent_connection()
-- below (SECURITY DEFINER) or the service role, so the PIT never has a
-- client-reachable write route into this table.
create policy data_agent_connections_select on public.data_agent_connections
  for select using (public.is_data_agent_member(sub_account));

create policy data_agent_ghl_schema_cache_select on public.data_agent_ghl_schema_cache
  for select using (public.is_data_agent_member(sub_account));

-- ── Associate lock ───────────────────────────────────────────────────────────
create policy data_agent_entitlements_deny_associates on public.data_agent_entitlements
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_members_deny_associates on public.data_agent_members
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_connections_deny_associates on public.data_agent_connections
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_ghl_schema_cache_deny_associates on public.data_agent_ghl_schema_cache
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));

-- ── Connection write path ────────────────────────────────────────────────────
-- The PIT is passed in once, from an authenticated Admin/Super-Admin
-- session, straight into Vault — it is never stored in a plain column and
-- never read back by this function. "Test Connection" (Task 5) reads it
-- back later, server-side only, via vault.decrypted_secrets.
create or replace function public.save_data_agent_connection(p_sub_account text, p_ghl_location_id text, p_pit text)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_secret_name text := 'data_agent_pit_' || p_sub_account;
  v_existing_id uuid;
begin
  -- coalesce(..., false) is required here, not optional style: a caller
  -- whose role/sub_account resolve to NULL (unrecognized or suspended —
  -- auth_user_role()/auth_user_sub_account() are NULL for both, per
  -- migration 027) would otherwise make this whole condition evaluate to
  -- NULL, and `if NULL then` never raises in PL/pgSQL — silently falling
  -- through to write a Vault secret for an arbitrary entitled sub-account.
  if not coalesce(
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = p_sub_account),
    false
  ) then
    raise exception 'Not authorized to connect this sub-account';
  end if;
  if not exists (select 1 from public.data_agent_entitlements where sub_account = p_sub_account and enabled) then
    raise exception 'Data Agent is not enabled for this sub-account';
  end if;
  if length(trim(coalesce(p_ghl_location_id, ''))) = 0 then
    raise exception 'A GHL location id is required';
  end if;
  if length(trim(coalesce(p_pit, ''))) = 0 then
    raise exception 'A Private Integration Token is required';
  end if;

  select id into v_existing_id from vault.secrets where name = v_secret_name;
  if v_existing_id is null then
    perform vault.create_secret(p_pit, v_secret_name, 'Data Agent GHL PIT for ' || p_sub_account);
  else
    perform vault.update_secret(v_existing_id, p_pit);
  end if;

  insert into public.data_agent_connections (sub_account, ghl_location_id, secret_name, connected_by, connected_at)
  values (p_sub_account, trim(p_ghl_location_id), v_secret_name, public.auth_user_app_id(), now())
  on conflict (sub_account) do update set
    ghl_location_id = excluded.ghl_location_id,
    secret_name     = excluded.secret_name,
    connected_by    = excluded.connected_by,
    connected_at    = excluded.connected_at;
end;
$$;
revoke execute on function public.save_data_agent_connection(text, text, text) from public, anon;
grant execute on function public.save_data_agent_connection(text, text, text) to authenticated;
```

- [ ] **Step 2: Run the existing associate-lock regression test (should already pass)**

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts`
Expected: PASS — the generic test *"every table created after the lock migration gets its own \*_deny_associates policy"* scans every migration after `20261006000100_associates_lock.sql` and would fail if any of the four new tables were missing its policy. No changes to that test file are needed; it already discovers new tables automatically via regex.

- [ ] **Step 3: Verify live via the Supabase Management API**

After deploying this migration, confirm the helper and tables exist and behave:

```sql
select proname from pg_proc where proname = 'is_data_agent_member';
select tablename, policyname from pg_policies where tablename like 'data_agent_%' order by tablename, policyname;
-- Expect: entitlements/members/connections/schema_cache each show a
-- *_select and *_deny_associates policy; entitlements/members also show a
-- *_write policy; connections/schema_cache show no insert/update/delete
-- policy at all (default-deny).
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261018000000_data_agent_entitlements_connections.sql
git commit -m "feat: add Data Agent entitlements, membership, and GHL connection tables"
```

---

### Task 2: Frontend types, access hook, nav + route scaffolding

**Files:**
- Create: `src/types/dataAgent.ts`
- Create: `src/hooks/useDataAgentAccess.ts`
- Create: `src/hooks/__tests__/useDataAgentAccess.test.ts`
- Create: `src/features/data-agent/DataAgentPage.tsx` (placeholder shell; filled out in Task 9)
- Modify: `src/app/Layout.tsx`
- Modify: `src/app/Router.tsx`

**Interfaces:**
- Produces: `useDataAgentAccess(): { hasAccess: boolean; entitled: boolean }`; route `/data-agent`; types `DataAgentMigrationStatus`, `DataAgentMappingStatus`, `DataAgentMappedBy`, `DataAgentTargetType`, `DataAgentWriteStatus`, `DataAgentSourceSystem`, `DataAgentMigration`, `DataAgentColumnMapping`, `DataAgentMigrationRecord`.

- [ ] **Step 1: Write the shared types**

```ts
// src/types/dataAgent.ts
export type DataAgentSourceSystem = 'salesforce' | 'hubspot' | null

export type DataAgentMigrationStatus =
  | 'uploaded' | 'mapping' | 'awaiting_confirmation' | 'migrating' | 'verifying'
  | 'completed' | 'failed' | 'cancelled' | 'undoing' | 'undone'

export type DataAgentMappingStatus = 'mapped' | 'uncertain' | 'unmapped'
export type DataAgentMappedBy = 'rule' | 'source_profile' | 'claude' | 'user'
export type DataAgentTargetType = 'standard_field' | 'custom_field' | 'tag' | 'ignored'
export type DataAgentWriteStatus = 'pending' | 'created' | 'replaced' | 'failed' | 'skipped'
export type DataAgentPhoneEmailSubtype = 'mobile' | 'home' | 'work' | 'fax' | 'other'
export type DataAgentDndChannel = 'call' | 'email' | 'sms'
export type DataAgentCountryCodePresence = 'present' | 'absent' | 'mixed'

export interface DataAgentColumnMappingMetadata {
  subtype?: DataAgentPhoneEmailSubtype
  dnd_channel?: DataAgentDndChannel
  country_code_presence?: DataAgentCountryCodePresence
  is_primary_candidate?: boolean
}

export interface DataAgentMigration {
  id: string
  sub_account: string
  created_by: string
  target_object_type: string
  source_system: DataAgentSourceSystem
  original_filename: string
  storage_path: string
  row_count: number
  match_key_column: string | null
  default_country_code: string | null
  status: DataAgentMigrationStatus
  accuracy_rating: number | null
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  created_at: string
}

export interface DataAgentColumnMapping {
  id: string
  migration_id: string
  source_column_name: string
  sample_values: string[]
  target_type: DataAgentTargetType
  target_field_key: string | null
  status: DataAgentMappingStatus
  confidence: number | null
  reasoning: string | null
  mapped_by: DataAgentMappedBy | null
  confirmed_by_user: boolean
  metadata: DataAgentColumnMappingMetadata
}

export interface DataAgentMigrationRecord {
  id: string
  migration_id: string
  row_number: number
  source_row_data: Record<string, string>
  ghl_record_id: string | null
  pre_replace_snapshot: Record<string, unknown> | null
  write_status: DataAgentWriteStatus
  error_message: string | null
  written_at: string | null
}

export interface DataAgentQaSample {
  id: string
  migration_record_id: string
  fetched_ghl_data: Record<string, unknown>
  field_comparisons: { field: string; expected: unknown; actual: unknown; match: boolean }[]
  match_pct: number
  created_at: string
}

export interface DataAgentChatMessage {
  id: string
  sub_account: string
  user_id: string
  message: string
  created_at: string
}
```

- [ ] **Step 2: Write the failing test for the access hook**

```ts
// src/hooks/__tests__/useDataAgentAccess.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const maybeSingleMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => maybeSingleMock() }) }),
    })),
  },
}))

const authState: { user: { role: string; sub_account: string } | null } = { user: null }
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authState.user }) }))

import { useDataAgentAccess } from '../useDataAgentAccess'

describe('useDataAgentAccess', () => {
  beforeEach(() => { maybeSingleMock.mockReset() })

  it('has no access when the sub-account is not entitled', async () => {
    authState.user = { role: 'Admin', sub_account: 'AM333' }
    maybeSingleMock.mockResolvedValue({ data: null })
    const { result } = renderHook(() => useDataAgentAccess())
    await waitFor(() => expect(result.current.entitled).toBe(false))
    expect(result.current.hasAccess).toBe(false)
  })

  it('gives an Admin access once entitled, with no membership row needed', async () => {
    authState.user = { role: 'Admin', sub_account: 'AM333' }
    maybeSingleMock.mockResolvedValue({ data: { enabled: true } })
    const { result } = renderHook(() => useDataAgentAccess())
    await waitFor(() => expect(result.current.hasAccess).toBe(true))
  })

  it('denies a plain Staff user even when entitled, with no membership row', async () => {
    authState.user = { role: 'Staff', sub_account: 'AM333' }
    maybeSingleMock.mockResolvedValue({ data: { enabled: true } })
    const { result } = renderHook(() => useDataAgentAccess())
    await waitFor(() => expect(result.current.entitled).toBe(true))
    expect(result.current.hasAccess).toBe(false)
  })
})
```

Run: `corepack pnpm vitest run src/hooks/__tests__/useDataAgentAccess.test.ts`
Expected: FAIL (`useDataAgentAccess` not defined).

- [ ] **Step 3: Implement the hook**

Server-side RLS (`is_data_agent_member`) is the real gate for every row of actual Data Agent data; this hook only decides whether to *show the nav entry and allow the route* — it checks entitlement itself and, for non-Admin/non-Super-Admin roles, checks membership via a direct `data_agent_members` row lookup (which RLS already scopes to the caller's own sub-account).

```ts
// src/hooks/useDataAgentAccess.ts
import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { supabase } from '@/lib/supabase'

export function useDataAgentAccess(): { hasAccess: boolean; entitled: boolean } {
  const { user } = useAuth()
  const [entitled, setEntitled] = useState(false)
  const [isMember, setIsMember] = useState(false)

  useEffect(() => {
    if (!user?.sub_account) { setEntitled(false); setIsMember(false); return }
    let cancelled = false

    void supabase
      .from('data_agent_entitlements')
      .select('enabled')
      .eq('sub_account', user.sub_account)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setEntitled(Boolean((data as { enabled?: boolean } | null)?.enabled))
      })

    // Branches into if/else rather than an early `return` on the
    // Admin/Super-Admin path — a `return` there would exit the whole
    // effect callback before the `return () => { cancelled = true }`
    // cleanup below is ever registered for that run. This app has a live
    // "View As" / "visit sub-account" impersonation feature
    // (AuthContext.tsx) that swaps `user.sub_account`/`role`/`id` while
    // this component stays mounted, re-running this effect — an
    // unregistered cleanup would let a stale in-flight query from a prior
    // run overwrite `entitled`/`isMember` with the wrong sub-account's data.
    if (user.role === 'Admin' || user.role === 'Super-Admin') {
      setIsMember(true)
    } else {
      // No .eq('sub_account', ...) filter here — RLS (Task 1's
      // data_agent_members_select policy) already scopes rows to the
      // caller's own sub_account, and this hook only gates nav/route
      // visibility, never actual data access (that's independently
      // enforced server-side by is_data_agent_member()), so a single
      // .eq('user_id', ...) is both sufficient and simpler to mock in tests.
      void supabase
        .from('data_agent_members')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => { if (!cancelled) setIsMember(Boolean((data as { user_id?: string } | null)?.user_id)) })
    }

    return () => { cancelled = true }
  }, [user?.sub_account, user?.role, user?.id])

  return { hasAccess: entitled && isMember, entitled }
}
```

- [ ] **Step 4: Run the test**

Run: `corepack pnpm vitest run src/hooks/__tests__/useDataAgentAccess.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Placeholder page, nav entry, and route**

```tsx
// src/features/data-agent/DataAgentPage.tsx
// Filled out in Task 9 (upload entry point) and Task 19/20 (dashboard/chat).
export function DataAgentPage() {
  return <div className="text-sm text-gray-500">Data Agent — coming online.</div>
}
```

In `src/app/Router.tsx`: add the lazy import and route, gated the same way `ReportsRoute` gates `/reports`.

```tsx
const DataAgentPage = lazy(() =>
  import('@/features/data-agent/DataAgentPage').then(m => ({ default: m.DataAgentPage }))
)
```

```tsx
function DataAgentRoute() {
  const { hasAccess } = useDataAgentAccess()
  if (!hasAccess) return <Navigate to="/" replace />
  return (
    <Suspense fallback={<Spinner />}>
      <DataAgentPage />
    </Suspense>
  )
}
```

Add `import { useDataAgentAccess } from '@/hooks/useDataAgentAccess'` alongside the existing `useReportsAccess` import, and register the route next to `reports`:

```tsx
<Route path="data-agent" element={<DataAgentRoute />} />
```

In `src/app/Layout.tsx`: add the gating hook and append a nav entry the same way `PROJECT_NAV_ITEMS` is appended.

```tsx
import { useDataAgentAccess } from '@/hooks/useDataAgentAccess'
```

```tsx
  const { hasAccess: hasDataAgentAccess } = useDataAgentAccess()
  const DATA_AGENT_NAV_ITEM = hasDataAgentAccess
    ? [{ to: '/data-agent', end: false, label: 'Data Agent', icon: '🧭', children: [] as { to: string; label: string; icon: string }[] }]
    : []
  const NAV = isSuperAdminView
    ? SUPER_ADMIN_NAV
    : [...(canViewReports ? [...STAFF_NAV, REPORTS_NAV_ITEM] : STAFF_NAV), ...PROJECT_NAV_ITEMS, ...DATA_AGENT_NAV_ITEM]
```

- [ ] **Step 6: Typecheck and commit**

Run: `corepack pnpm tsc --noEmit`
Expected: no errors.

```bash
git add src/types/dataAgent.ts src/hooks/useDataAgentAccess.ts src/hooks/__tests__/useDataAgentAccess.test.ts src/features/data-agent/DataAgentPage.tsx src/app/Layout.tsx src/app/Router.tsx
git commit -m "feat: scaffold Data Agent types, access gating, nav entry, and route"
```

---

### Task 3: Super-Admin entitlement toggle

**Files:**
- Create: `src/features/data-agent/entitlements/DataAgentEntitlementsTab.tsx`
- Create: `src/features/data-agent/entitlements/__tests__/DataAgentEntitlementsTab.test.tsx`
- Modify: `src/features/super-admin/SuperAdminPage.tsx`

**Interfaces:**
- Consumes: table `sub_accounts(code, company_name)` (existing); table `data_agent_entitlements` (Task 1).
- Produces: component `DataAgentEntitlementsTab`, registered as the `'data-agent'` tab in `SuperAdminPage`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/data-agent/entitlements/__tests__/DataAgentEntitlementsTab.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const subAccountsData = [{ code: 'AM333', company_name: 'AM333 Wellness' }, { code: 'DERMITAGE', company_name: 'Dermitage' }]
const entitlementsData = [{ sub_account: 'AM333', enabled: true }]
const upsertMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: () => ({
        order: () => Promise.resolve(table === 'sub_accounts' ? { data: subAccountsData } : { data: entitlementsData }),
      }),
      upsert: (...args: unknown[]) => upsertMock(table, ...args),
    })),
  },
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'super-1', role: 'Super-Admin' } }) }))

import { DataAgentEntitlementsTab } from '../DataAgentEntitlementsTab'

describe('DataAgentEntitlementsTab', () => {
  beforeEach(() => { upsertMock.mockReset().mockResolvedValue({ error: null }) })

  it('lists every sub-account with its current entitlement state', async () => {
    render(<DataAgentEntitlementsTab />)
    expect(await screen.findByText('AM333 Wellness')).toBeInTheDocument()
    expect(screen.getByText('Dermitage')).toBeInTheDocument()
    const toggles = screen.getAllByRole('checkbox')
    expect(toggles[0]).toBeChecked()
    expect(toggles[1]).not.toBeChecked()
  })

  it('enabling a sub-account upserts data_agent_entitlements', async () => {
    render(<DataAgentEntitlementsTab />)
    await screen.findByText('Dermitage')
    const toggles = screen.getAllByRole('checkbox')
    await userEvent.click(toggles[1])
    await waitFor(() => expect(upsertMock).toHaveBeenCalledWith(
      'data_agent_entitlements',
      expect.objectContaining({ sub_account: 'DERMITAGE', enabled: true }),
    ))
  })

  it('surfaces an upsert error without flipping the checkbox', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'permission denied' } })
    render(<DataAgentEntitlementsTab />)
    await screen.findByText('Dermitage')
    const toggles = screen.getAllByRole('checkbox')
    await userEvent.click(toggles[1])
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i)
    expect(toggles[1]).not.toBeChecked()
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/entitlements/__tests__/DataAgentEntitlementsTab.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```tsx
// src/features/data-agent/entitlements/DataAgentEntitlementsTab.tsx
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

interface SubAccountRow { code: string; company_name: string }
interface EntitlementRow { sub_account: string; enabled: boolean }

export function DataAgentEntitlementsTab() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<SubAccountRow[]>([])
  const [entitled, setEntitled] = useState<Record<string, boolean>>({})
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: accs }, { data: ents }] = await Promise.all([
      supabase.from('sub_accounts').select('code, company_name').order('company_name'),
      supabase.from('data_agent_entitlements').select('sub_account, enabled').order('sub_account'),
    ])
    setAccounts((accs ?? []) as SubAccountRow[])
    const map: Record<string, boolean> = {}
    for (const e of (ents ?? []) as EntitlementRow[]) map[e.sub_account] = e.enabled
    setEntitled(map)
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggle(code: string, next: boolean) {
    setBusyCode(code)
    setErrorMsg(null)
    const { error } = await supabase.from('data_agent_entitlements').upsert({
      sub_account: code, enabled: next, enabled_by: user?.id, enabled_at: new Date().toISOString(),
    })
    setBusyCode(null)
    if (error) { setErrorMsg(`Could not update ${code}: ${error.message}`); return }
    setEntitled(prev => ({ ...prev, [code]: next }))
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">
        Toggle Data Agent access per sub-account. This is a manual grant, independent of their subscription plan.
      </p>
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
        {accounts.map(a => (
          <label key={a.code} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{a.company_name} <span className="text-gray-400 font-mono text-xs">{a.code}</span></span>
            <input
              type="checkbox"
              checked={Boolean(entitled[a.code])}
              disabled={busyCode === a.code}
              onChange={e => void toggle(a.code, e.target.checked)}
              className="w-4 h-4 accent-violet-600"
            />
          </label>
        ))}
      </div>
      {errorMsg && <p role="alert" className="text-sm text-red-600">{errorMsg}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Wire into SuperAdminPage**

In `src/features/super-admin/SuperAdminPage.tsx`:

```tsx
import { DataAgentEntitlementsTab } from '@/features/data-agent/entitlements/DataAgentEntitlementsTab'
```

Add `'data-agent'` to `TabId`, add `{ id: 'data-agent', label: 'Data Agent', icon: '🧭' }` to `tabs`, and add `{activeTab === 'data-agent' && <DataAgentEntitlementsTab />}` beside the other tab renders.

- [ ] **Step 4: Run tests and commit**

Run: `corepack pnpm vitest run src/features/data-agent/entitlements/__tests__/DataAgentEntitlementsTab.test.tsx`
Expected: PASS (2 tests).

```bash
git add src/features/data-agent/entitlements/DataAgentEntitlementsTab.tsx src/features/data-agent/entitlements/__tests__/DataAgentEntitlementsTab.test.tsx src/features/super-admin/SuperAdminPage.tsx
git commit -m "feat: let Super-Admin grant Data Agent access per sub-account"
```

---

### Task 4: Sub-account Settings — connection + team access

**Files:**
- Create: `src/features/data-agent/settings/DataAgentSettingsTab.tsx`
- Create: `src/features/data-agent/settings/__tests__/DataAgentSettingsTab.test.tsx`
- Modify: `src/features/settings/SettingsPage.tsx`

**Interfaces:**
- Consumes: RPC `save_data_agent_connection(p_sub_account, p_ghl_location_id, p_pit)` (Task 1); table `data_agent_connections` (read-only, Task 1); table `data_agent_members` (Task 1); table `users` (existing, for the team-access picker, same query shape as `AddProjectMemberForm`).
- Produces: component `DataAgentSettingsTab`, registered as the `'data-agent'` tab in `SettingsPage`, visible only when `useDataAgentAccess().entitled`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/data-agent/settings/__tests__/DataAgentSettingsTab.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const connectionSingle = vi.fn()
const membersData = vi.fn()
const insertMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'data_agent_connections') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => connectionSingle() }) }) }
      }
      if (table === 'data_agent_members') {
        return {
          select: () => ({ eq: () => membersData() }),
          insert: (...args: unknown[]) => insertMock(...args),
        }
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ ilike: () => Promise.resolve({ data: [] }) }) }) }) }
    }),
  },
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1', sub_account: 'AM333', role: 'Admin' } }) }))

import { DataAgentSettingsTab } from '../DataAgentSettingsTab'

describe('DataAgentSettingsTab', () => {
  beforeEach(() => {
    rpcMock.mockReset().mockResolvedValue({ error: null })
    connectionSingle.mockReset().mockResolvedValue({ data: null })
    membersData.mockReset().mockResolvedValue({ data: [] })
    insertMock.mockReset().mockResolvedValue({ error: null })
  })

  it('saves the connection via save_data_agent_connection, never storing the PIT in a plain field', async () => {
    render(<DataAgentSettingsTab />)
    await userEvent.type(await screen.findByLabelText(/GHL Location ID/i), 'loc_123')
    await userEvent.type(screen.getByLabelText(/Private Integration Token/i), 'pit_abc')
    await userEvent.click(screen.getByRole('button', { name: /save connection/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('save_data_agent_connection', {
      p_sub_account: 'AM333', p_ghl_location_id: 'loc_123', p_pit: 'pit_abc',
    }))
  })

  it('shows an existing connection without ever displaying the PIT', async () => {
    connectionSingle.mockResolvedValue({ data: { ghl_location_id: 'loc_999', last_verified_at: null } })
    render(<DataAgentSettingsTab />)
    expect(await screen.findByDisplayValue('loc_999')).toBeInTheDocument()
    expect(screen.queryByText(/pit_/)).not.toBeInTheDocument()
  })

  it('enables Test Connection immediately after a successful first-time save, with no reload needed', async () => {
    render(<DataAgentSettingsTab />)
    await userEvent.type(await screen.findByLabelText(/GHL Location ID/i), 'loc_123')
    await userEvent.type(screen.getByLabelText(/Private Integration Token/i), 'pit_abc')
    const testBtn = screen.getByRole('button', { name: /test connection/i })
    expect(testBtn).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /save connection/i }))
    await waitFor(() => expect(testBtn).toBeEnabled())
  })

  it('shows named candidates for explicit selection rather than auto-granting a partial-name match', async () => {
    const ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }, { id: 'u2', name: 'Jo Lee' }] })
    vi.mocked(await import('@/lib/supabase')).supabase.from = vi.fn((table: string) => {
      if (table === 'data_agent_connections') return { select: () => ({ eq: () => ({ maybeSingle: () => connectionSingle() }) }) }
      if (table === 'data_agent_members') return { select: () => ({ eq: () => membersData() }), insert: (...args: unknown[]) => insertMock(...args) }
      return { select: () => ({ eq: () => ({ eq: () => ({ ilike: () => ilikeMock() }) }) }) }
    }) as never

    render(<DataAgentSettingsTab />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))

    expect(await screen.findByRole('button', { name: /jo smith/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /jo lee/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /jo lee/i }))
    await waitFor(() => expect(insertMock).toHaveBeenCalledWith({ sub_account: 'AM333', user_id: 'u2', added_by: 'admin-1' }))
  })

  it('surfaces a grant error instead of claiming success', async () => {
    const ilikeMock = vi.fn().mockResolvedValue({ data: [{ id: 'u1', name: 'Jo Smith' }] })
    vi.mocked(await import('@/lib/supabase')).supabase.from = vi.fn((table: string) => {
      if (table === 'data_agent_connections') return { select: () => ({ eq: () => ({ maybeSingle: () => connectionSingle() }) }) }
      if (table === 'data_agent_members') return { select: () => ({ eq: () => membersData() }), insert: (...args: unknown[]) => insertMock(...args) }
      return { select: () => ({ eq: () => ({ eq: () => ({ ilike: () => ilikeMock() }) }) }) }
    }) as never
    insertMock.mockResolvedValue({ error: { message: 'duplicate key' } })

    render(<DataAgentSettingsTab />)
    await userEvent.type(await screen.findByLabelText(/search your team/i), 'jo')
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /jo smith/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/duplicate key/i)
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/settings/__tests__/DataAgentSettingsTab.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```tsx
// src/features/data-agent/settings/DataAgentSettingsTab.tsx
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

interface ConnectionRow { ghl_location_id: string; last_verified_at: string | null }
interface MemberRow { user_id: string; users: { name: string } | null }

export function DataAgentSettingsTab() {
  const { user } = useAuth()
  const subAccount = user?.sub_account ?? ''
  const [locationId, setLocationId] = useState('')
  const [pit, setPit] = useState('')
  const [connection, setConnection] = useState<ConnectionRow | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!subAccount) return
    void supabase.from('data_agent_connections').select('ghl_location_id, last_verified_at')
      .eq('sub_account', subAccount).maybeSingle()
      .then(({ data }) => {
        const row = data as ConnectionRow | null
        if (row) { setConnection(row); setLocationId(row.ghl_location_id) }
      })
  }, [subAccount])

  async function saveConnection() {
    setSaving(true); setSaveMsg(null)
    const { error } = await supabase.rpc('save_data_agent_connection', {
      p_sub_account: subAccount, p_ghl_location_id: locationId.trim(), p_pit: pit.trim(),
    })
    setSaving(false)
    if (error) { setSaveMsg(error.message); return }
    // Update local state immediately rather than waiting for a reload —
    // otherwise "Test Connection" (disabled while `!connection`) stays
    // disabled after a brand-new sub-account's very first save, breaking
    // the save-then-test happy path in one sitting.
    setConnection({ ghl_location_id: locationId.trim(), last_verified_at: null })
    setSaveMsg('Connection saved.')
    setPit('')
  }

  async function testConnection() {
    setTesting(true); setTestMsg(null)
    const { data, error } = await supabase.functions.invoke('data-agent-test-connection', { body: { subAccount } })
    setTesting(false)
    if (error) { setTestMsg(`Connection test failed: ${error.message}`); return }
    const body = data as { ok: boolean; error?: string }
    setTestMsg(body.ok ? 'Connection verified — schema refreshed.' : `Connection test failed: ${body.error}`)
  }

  return (
    <div className="space-y-6 max-w-lg">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">GHL Connection</h3>
        <div>
          <label htmlFor="da-location" className="block text-xs font-medium text-gray-600 mb-1">GHL Location ID</label>
          <input id="da-location" value={locationId} onChange={e => setLocationId(e.target.value)} className="input w-full" />
        </div>
        <div>
          <label htmlFor="da-pit" className="block text-xs font-medium text-gray-600 mb-1">Private Integration Token</label>
          <input id="da-pit" type="password" autoComplete="off" value={pit} onChange={e => setPit(e.target.value)} className="input w-full"
            placeholder={connection ? 'Enter a new token to replace the saved one' : ''} />
        </div>
        <div className="flex gap-2">
          <button onClick={() => void saveConnection()} disabled={saving || !locationId.trim() || !pit.trim()}
            className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
            {saving ? 'Saving…' : 'Save Connection'}
          </button>
          <button onClick={() => void testConnection()} disabled={testing || !connection}
            className="text-sm font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 rounded-md px-4 py-2">
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
        {saveMsg && <p className="text-sm text-gray-600">{saveMsg}</p>}
        {testMsg && <p className="text-sm text-gray-600">{testMsg}</p>}
        {connection?.last_verified_at && (
          <p className="text-xs text-gray-400">Last verified {new Date(connection.last_verified_at).toLocaleString()}</p>
        )}
      </section>
      <DataAgentTeamAccess subAccount={subAccount} />
    </div>
  )
}

interface CandidateRow { id: string; name: string }

// Deliberately mirrors AddProjectMemberForm's search-then-explicit-grant
// pattern (src/features/projects/AddProjectMemberForm.tsx) rather than
// auto-granting the first name match — an access grant to the wrong
// person (e.g. two teammates both matching a partial "jo") must never
// happen silently.
function DataAgentTeamAccess({ subAccount }: { subAccount: string }) {
  const { user } = useAuth()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [grantingId, setGrantingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadMembers = useCallback(async () => {
    const { data } = await supabase.from('data_agent_members').select('user_id, users(name)').eq('sub_account', subAccount)
    setMembers((data ?? []) as unknown as MemberRow[])
  }, [subAccount])

  useEffect(() => { if (subAccount) void loadMembers() }, [subAccount, loadMembers])

  async function runSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!search.trim()) return
    setSearching(true); setMsg(null)
    const { data } = await supabase.from('users').select('id, name').eq('sub_account', subAccount)
      .eq('status', 'active').ilike('name', `%${search.trim()}%`)
    setSearching(false); setSearched(true)
    const known = new Set(members.map(m => m.user_id))
    setCandidates(((data ?? []) as CandidateRow[]).filter(c => !known.has(c.id)))
  }

  async function grant(candidate: CandidateRow) {
    setGrantingId(candidate.id); setMsg(null)
    const { error } = await supabase.from('data_agent_members').insert({
      sub_account: subAccount, user_id: candidate.id, added_by: user?.id,
    })
    setGrantingId(null)
    if (error) { setMsg({ type: 'error', text: `Could not grant ${candidate.name}: ${error.message}` }); return }
    setMsg({ type: 'success', text: `${candidate.name} now has Data Agent access.` })
    setSearch(''); setCandidates([]); setSearched(false)
    await loadMembers()
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Team Access</h3>
      <p className="text-xs text-gray-500">
        Admins always have access. Grant access to other team members here.
      </p>
      <ul className="space-y-1">
        {members.map(m => <li key={m.user_id} className="text-sm text-gray-700">{m.users?.name}</li>)}
      </ul>
      <form onSubmit={e => void runSearch(e)} className="flex gap-2">
        <input value={search} onChange={e => { setSearch(e.target.value); setSearched(false) }} placeholder="Search by name…"
          aria-label="Search your team to grant access" className="input flex-1" />
        <button type="submit" disabled={searching || !search.trim()}
          className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-3 py-2">
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {searched && candidates.length === 0 && (
        <p className="text-xs text-gray-400">No one in your workspace matched that name.</p>
      )}
      {candidates.length > 0 && (
        <div className="space-y-1">
          {candidates.map(c => (
            <button key={c.id} type="button" onClick={() => void grant(c)} disabled={grantingId === c.id}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-violet-300 text-left disabled:opacity-50">
              <span className="text-sm text-gray-700">{c.name}</span>
              <span className="text-xs font-semibold text-violet-600">{grantingId === c.id ? 'Granting…' : '+ Grant'}</span>
            </button>
          ))}
        </div>
      )}
      {msg && (
        <p role={msg.type === 'error' ? 'alert' : 'status'} className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Wire into SettingsPage, gated by entitlement**

In `src/features/settings/SettingsPage.tsx`:

```tsx
import { DataAgentSettingsTab } from '@/features/data-agent/settings/DataAgentSettingsTab'
import { useDataAgentAccess } from '@/hooks/useDataAgentAccess'
```

Add `'data-agent'` to `TabId`. Inside `SettingsPage`, call `const { entitled } = useDataAgentAccess()`. `businessTabs` is declared as `const businessTabs: { id: TabId; label: string }[] = [...]` — do not mutate it with `.push()`; append the new entry immutably instead:

```tsx
const businessTabs: { id: TabId; label: string }[] = [
  { id: 'account',      label: 'Account' },
  { id: 'users',        label: 'Users & Roles' },
  { id: 'departments',  label: 'Departments' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'ghl',          label: '🔗 DIGI5Y-CRM Integration' },
  ...(isAdmin && entitled ? [{ id: 'data-agent' as const, label: '🧭 Data Agent' }] : []),
  { id: 'archive',      label: '🗄 Archive' },
]
```

Add `{activeTab === 'data-agent' && <DataAgentSettingsTab />}` beside the other tab renders.

- [ ] **Step 4: Run tests and commit**

Run: `corepack pnpm vitest run src/features/data-agent/settings/__tests__/DataAgentSettingsTab.test.tsx`
Expected: PASS (2 tests).

```bash
git add src/features/data-agent/settings/DataAgentSettingsTab.tsx src/features/data-agent/settings/__tests__/DataAgentSettingsTab.test.tsx src/features/settings/SettingsPage.tsx
git commit -m "feat: add Data Agent connection form and team access to Settings"
```

---

### Task 5: GHL client module + schema-cache refresher + Test Connection edge function

**Files:**
- Create: `supabase/functions/_shared/dataAgentGhlClient.ts`
- Create: `supabase/functions/_shared/dataAgentSchemaCache.ts`
- Create: `supabase/functions/data-agent-test-connection/index.ts`

**Interfaces:**
- Consumes: table `data_agent_connections`, SQL `is_data_agent_member` (Task 1); `vault.decrypted_secrets`.
- Produces: `GhlClientConfig`, `GhlRateLimitError`, `fetchContactCustomFields()`, `fetchCustomObjects()`, `upsertContact()`, `searchObjectRecord()`, `createObjectRecord()`, `updateObjectRecord()`, `deleteObjectRecord()`, `getContact()`, `deleteContact()` — all consumed again by Task 15's worker. `ensureSchemaCacheFresh(serviceClient, subAccount, config, { force }): Promise<boolean>` (returns whether a refresh actually ran) — consumed again by Task 8, so an upload is never matched against a schema snapshot older than 24h, per spec §4 ("auto-refreshed at the start of a new migration if the cache is older than a set threshold"). Edge function `data-agent-test-connection` (POST `{ subAccount: string }` → `{ ok: boolean; error?: string }`).

GHL's Custom Objects API (the `fetchCustomObjects`/`*ObjectRecord` family below) is a newer, less-documented surface than Contacts. The endpoint shapes here follow GHL's published v2 Objects API as of this plan's writing. **Before this task is considered done, run Step 5 (manual verification against a real sandbox GHL location) and fix any endpoint/field-name mismatch it finds** — this mirrors the spec's own §14 requirement and is not optional.

- [ ] **Step 1: Write the GHL client module**

```ts
// supabase/functions/_shared/dataAgentGhlClient.ts
const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
const GHL_API_VERSION = '2021-07-28'

export interface GhlClientConfig { pit: string; locationId: string }

export class GhlRateLimitError extends Error {}

async function ghlFetch(config: GhlClientConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GHL_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${config.pit}`,
      Version: GHL_API_VERSION,
      'Content-Type': 'application/json',
    },
  })
}

async function assertOk(res: Response, label: string): Promise<void> {
  if (res.status === 429) throw new GhlRateLimitError(`${label}: rate limited`)
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${await res.text()}`)
}

export interface GhlCustomField { id: string; fieldKey: string; name: string; dataType: string }

export async function fetchContactCustomFields(config: GhlClientConfig): Promise<GhlCustomField[]> {
  const res = await ghlFetch(config, `/locations/${config.locationId}/customFields?model=contact`)
  await assertOk(res, 'GHL customFields fetch')
  const body = await res.json() as { customFields?: GhlCustomField[] }
  return body.customFields ?? []
}

export interface GhlObjectSchema { key: string; labels: { singular: string; plural: string }; fields: GhlCustomField[] }

export async function fetchCustomObjects(config: GhlClientConfig): Promise<GhlObjectSchema[]> {
  const listRes = await ghlFetch(config, `/objects/?locationId=${config.locationId}`)
  await assertOk(listRes, 'GHL objects list')
  const listBody = await listRes.json() as { objects?: { key: string; labels: { singular: string; plural: string } }[] }
  const schemas: GhlObjectSchema[] = []
  for (const obj of listBody.objects ?? []) {
    const detailRes = await ghlFetch(config, `/objects/${obj.key}?locationId=${config.locationId}`)
    await assertOk(detailRes, `GHL object detail (${obj.key})`)
    const detail = await detailRes.json() as { object?: { fields?: GhlCustomField[] } }
    schemas.push({ key: obj.key, labels: obj.labels, fields: detail.object?.fields ?? [] })
  }
  return schemas
}

export interface GhlUpsertContactPayload {
  locationId: string
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  tags?: string[]
  customFields?: { id: string; value: string }[]
}
export interface GhlUpsertContactResult { contact: { id: string }; new: boolean }

export async function upsertContact(config: GhlClientConfig, payload: GhlUpsertContactPayload): Promise<GhlUpsertContactResult> {
  const res = await ghlFetch(config, '/contacts/upsert', { method: 'POST', body: JSON.stringify(payload) })
  await assertOk(res, 'GHL contact upsert')
  return await res.json() as GhlUpsertContactResult
}

export async function getContact(config: GhlClientConfig, contactId: string): Promise<{ contact: Record<string, unknown> }> {
  const res = await ghlFetch(config, `/contacts/${contactId}`)
  await assertOk(res, 'GHL contact fetch')
  return await res.json()
}

export async function deleteContact(config: GhlClientConfig, contactId: string): Promise<void> {
  const res = await ghlFetch(config, `/contacts/${contactId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) await assertOk(res, 'GHL contact delete')
}

export interface GhlObjectRecord { id: string; properties: Record<string, unknown> }

export async function searchObjectRecord(config: GhlClientConfig, objectKey: string, matchField: string, matchValue: string): Promise<GhlObjectRecord | null> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records/search`, {
    method: 'POST',
    body: JSON.stringify({ locationId: config.locationId, page: 1, pageLimit: 1, searchFilter: `${matchField}:${matchValue}` }),
  })
  await assertOk(res, 'GHL object search')
  const body = await res.json() as { records?: GhlObjectRecord[] }
  return body.records?.[0] ?? null
}

export async function createObjectRecord(config: GhlClientConfig, objectKey: string, properties: Record<string, unknown>): Promise<GhlObjectRecord> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records`, { method: 'POST', body: JSON.stringify({ locationId: config.locationId, properties }) })
  await assertOk(res, 'GHL object create')
  const body = await res.json() as { record: GhlObjectRecord }
  return body.record
}

export async function updateObjectRecord(config: GhlClientConfig, objectKey: string, recordId: string, properties: Record<string, unknown>): Promise<GhlObjectRecord> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records/${recordId}`, { method: 'PUT', body: JSON.stringify({ properties }) })
  await assertOk(res, 'GHL object update')
  const body = await res.json() as { record: GhlObjectRecord }
  return body.record
}

export async function deleteObjectRecord(config: GhlClientConfig, objectKey: string, recordId: string): Promise<void> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records/${recordId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) await assertOk(res, 'GHL object delete')
}
```

- [ ] **Step 2: Write the shared schema-cache refresher**

Both this task's "Test Connection" action (an explicit, always-refresh user request) and Task 8's upload flow (a staleness-gated, implicit refresh — analysis must never run against a schema snapshot older than 24h) need the same "pull the real schema and upsert the cache" logic. Factored out once here so neither task reimplements it:

```ts
// supabase/functions/_shared/dataAgentSchemaCache.ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchContactCustomFields, fetchCustomObjects, type GhlClientConfig } from './dataAgentGhlClient.ts'

const STALE_AFTER_MS = 24 * 60 * 60 * 1000

// Returns true if a refresh actually ran (so callers can report it), false
// if the existing cache was still fresh and force was not set.
export async function ensureSchemaCacheFresh(
  serviceClient: SupabaseClient,
  subAccount: string,
  config: GhlClientConfig,
  options: { force: boolean },
): Promise<boolean> {
  if (!options.force) {
    const { data: existing } = await serviceClient.from('data_agent_ghl_schema_cache')
      .select('fetched_at').eq('sub_account', subAccount).order('fetched_at', { ascending: false }).limit(1).maybeSingle()
    const fetchedAt = (existing as { fetched_at?: string } | null)?.fetched_at
    const isFresh = fetchedAt && Date.now() - new Date(fetchedAt).getTime() < STALE_AFTER_MS
    if (isFresh) return false
  }

  const [customFields, objects] = await Promise.all([fetchContactCustomFields(config), fetchCustomObjects(config)])
  await serviceClient.from('data_agent_ghl_schema_cache').upsert([
    { sub_account: subAccount, object_type: 'contact', fields: customFields, fetched_at: new Date().toISOString() },
    ...objects.map(o => ({ sub_account: subAccount, object_type: o.key, fields: o.fields, fetched_at: new Date().toISOString() })),
  ], { onConflict: 'sub_account,object_type' })
  return true
}
```

- [ ] **Step 3: Write the Test Connection edge function**

```ts
// supabase/functions/data-agent-test-connection/index.ts
// Authorization: any Data Agent member of the given sub-account (checked
// via is_data_agent_member using the caller's own JWT — RLS does the real
// work). The PIT itself is read only here, server-side, from Vault, and
// never echoed back in the response.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureSchemaCacheFresh } from '../_shared/dataAgentSchemaCache.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

// IMPORTANT: every branch below returns HTTP 200. supabase-js's
// functions.invoke() throws a generic FunctionsHttpError — whose .message
// is ALWAYS the fixed string "Edge Function returned a non-2xx status
// code", never this function's own text — for any non-2xx response; the
// real body only reaches the caller via `error.context`, which none of
// this plan's UI callers read. Returning 200 with `{ ok, error }` for
// every business outcome is what actually lets `data.error` reach the UI
// as written (verified against the installed @supabase/functions-js
// source). Only true protocol-level cases (CORS preflight, wrong method)
// stay as real HTTP status codes, since the UI only ever sends POST and
// never has to parse those.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ ok: false, error: 'Missing authorization header' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ ok: false, error: 'Invalid session' })

  let body: { subAccount?: unknown }
  try { body = await req.json() } catch { return json({ ok: false, error: 'Invalid JSON body' }) }
  const subAccount = typeof body.subAccount === 'string' ? body.subAccount : ''
  if (!subAccount) return json({ ok: false, error: 'subAccount is required' })

  const { data: isMember } = await callerClient.rpc('is_data_agent_member', { p_sub_account: subAccount })
  if (!isMember) return json({ ok: false, error: 'Not authorized for this sub-account' })

  const serviceClient = createClient(supabaseUrl, serviceKey)
  const { data: connection } = await serviceClient.from('data_agent_connections')
    .select('ghl_location_id, secret_name').eq('sub_account', subAccount).maybeSingle()
  if (!connection) return json({ ok: false, error: 'No connection saved for this sub-account yet' })

  const { data: secretRow } = await serviceClient
    .schema('vault').from('decrypted_secrets').select('decrypted_secret')
    .eq('name', (connection as { secret_name: string }).secret_name).maybeSingle()
  const pit = (secretRow as { decrypted_secret?: string } | null)?.decrypted_secret
  if (!pit) return json({ ok: false, error: 'Saved token could not be read from Vault' })

  const config = { pit, locationId: (connection as { ghl_location_id: string }).ghl_location_id }

  try {
    await ensureSchemaCacheFresh(serviceClient, subAccount, config, { force: true })
    await serviceClient.from('data_agent_connections').update({ last_verified_at: new Date().toISOString() }).eq('sub_account', subAccount)
    return json({ ok: true })
  } catch (err) {
    // GHL's own response text (surfaced via assertOk() in dataAgentGhlClient.ts)
    // is logged in full server-side only, never forwarded to the browser —
    // an unverified third-party API (flagged in Task 5's own Step 4-5 notes)
    // echoing back any form of the submitted token in an error body is a
    // real secret-leak vector this function must not relay to the client.
    console.error('data-agent-test-connection: GHL call failed', err)
    return json({ ok: false, error: 'Could not verify the connection — check the Location ID and token, then try again.' })
  }
})
```

- [ ] **Step 4: Typecheck**

Run: `corepack pnpm tsc --noEmit`
Expected: no errors (edge functions are outside the `tsconfig` `include` in this project, matching the existing convention that edge functions aren't type-checked by the frontend `tsc` run — confirm by checking that no new path shows up in the output).

- [ ] **Step 5: Manual verification (required before this task is done)**

Using a real sandbox GHL location and a real PIT:
1. Call `save_data_agent_connection` for a test sub-account with that location's id and PIT.
2. Invoke `data-agent-test-connection` and confirm `{ ok: true }`.
3. Query `data_agent_ghl_schema_cache` and confirm it has a `contact` row and one row per Custom Object actually configured on that location, each with a non-empty `fields` array.
4. If the real response shapes differ from this task's assumptions (field names, nesting), fix `dataAgentGhlClient.ts` now, before any later task builds on it.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/dataAgentGhlClient.ts supabase/functions/_shared/dataAgentSchemaCache.ts supabase/functions/data-agent-test-connection/index.ts
git commit -m "feat: add GHL client module, schema-cache refresher, and Data Agent connection test"
```

---

### Task 6: Pure rules-tier matching module (centerpiece — thorough unit coverage)

**Files:**
- Create: `supabase/functions/_shared/dataAgentMatching.ts`
- Create: `supabase/functions/_shared/__tests__/dataAgentMatching.test.ts`
- Create: `supabase/functions/tsconfig.json`

**Interfaces:**
- Produces (all pure functions, zero imports in the module itself — this is deliberate: the identical file runs under Deno, imported by `data-agent-upload` in Task 8, and under Node/Vitest, imported directly by its own tests, with no shim): `normalizeColumnName`, `detectCountryCodePresence`, `detectDndChannel`, `detectPhoneEmailSubtype`, `resolveSubtypeTargetField`, `matchTargetSchema`, `matchSourceProfile`, `pickPrimaryPhoneEmailColumn`, `classifyColumn`, plus types `TargetField`, `SourceProfileEntry`, `ColumnClassification`, `ClassifyColumnInput`.
- Consumes (by Task 8): `classifyColumn(input: ClassifyColumnInput): ColumnClassification`.

**Design note on ordering (binding for this task and reviewers):** within `classifyColumn`, a source-profile match is checked before an exact schema match, which is checked before generic pattern detection, which is checked before falling through to `unmapped`. This is deliberate — curated per-source knowledge (profile) and an exact name hit (schema) are both maximally confident, and checking profile first only matters when a source system was explicitly selected; generic pattern detection is the least specific signal and runs last, right before giving up.

- [ ] **Step 1: Write the module's types and pure helpers**

```ts
// supabase/functions/_shared/dataAgentMatching.ts
//
// Zero-import, runtime-agnostic (spec §14: "the rules tier is pure,
// deterministic logic... this is the highest-value test surface given the
// accuracy-first requirement"). Never add an import statement to this file
// — doing so breaks the Vitest-under-Node / Deno-edge-function dual use
// this module exists for.

export type TargetFieldType = 'standard' | 'custom'
export interface TargetField {
  key: string    // e.g. 'phone', or a GHL custom field's id/fieldKey
  label: string   // e.g. 'Phone', 'Mobile Phone'
  type: TargetFieldType
}

export type PhoneEmailSubtype = 'mobile' | 'home' | 'work' | 'fax' | 'other'
export type DndChannel = 'call' | 'email' | 'sms'
export type CountryCodePresence = 'present' | 'absent' | 'mixed'

export interface SourceProfileEntry {
  source_system: 'salesforce' | 'hubspot'
  pattern: string                        // exact source export column name (case-sensitive)
  target_field_hint: string               // target field key to map to
  subtype_hint: PhoneEmailSubtype | null
}

export interface ColumnClassificationMetadata {
  subtype?: PhoneEmailSubtype
  dnd_channel?: DndChannel
  country_code_presence?: CountryCodePresence
  is_primary_candidate?: boolean // set by the caller (Task 8's planner), never by classifyColumn itself
}

export interface ColumnClassification {
  status: 'mapped' | 'uncertain' | 'unmapped'
  mapped_by: 'rule' | 'source_profile' | 'claude' | null // 'claude' is set only by Task 12's planWithClaude, never by classifyColumn itself — included here since PlannedColumnMapping (Task 8) extends this interface and Task 12 needs the literal
  target_field_key: string | null
  target_type: 'standard_field' | 'custom_field' | 'tag' | 'ignored'
  confidence: number | null
  metadata: ColumnClassificationMetadata
}

export function normalizeColumnName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function hasAnyKeyword(normalized: string, keywords: string[]): boolean {
  return keywords.some(k => normalized.includes(k))
}

const COUNTRY_CODE_RE = /^\s*\+\d/

export function detectCountryCodePresence(sampleValues: string[]): CountryCodePresence {
  const nonEmpty = sampleValues.filter(v => v != null && v.trim().length > 0)
  if (nonEmpty.length === 0) return 'absent'
  const withCode = nonEmpty.filter(v => COUNTRY_CODE_RE.test(v))
  if (withCode.length === nonEmpty.length) return 'present'
  if (withCode.length === 0) return 'absent'
  return 'mixed'
}

const DND_CHANNEL_KEYWORDS: Array<[DndChannel, string[]]> = [
  ['email', ['emailoptout', 'emaildnd', 'donotemail', 'unsubscribe']],
  ['call', ['donotcall', 'calldnd', 'nocall']],
  ['sms', ['smsoptout', 'smsdnd', 'donottext', 'textoptout']],
]

// An unambiguous channel-specific keyword is itself a confident rule match
// (spec §6.1: "A column like 'Email Opt-Out' maps to the email channel
// specifically"). A generic "do not contact" matches none of these and
// correctly falls through to the Claude tier instead ("is ambiguous across
// channels and is routed to the Claude tier rather than assumed to mean
// 'all channels'").
export function detectDndChannel(columnName: string): DndChannel | null {
  const normalized = normalizeColumnName(columnName)
  for (const [channel, keywords] of DND_CHANNEL_KEYWORDS) {
    if (hasAnyKeyword(normalized, keywords)) return channel
  }
  return null
}

const PHONE_BASE_KEYWORDS = ['phone', 'tel', 'fax']
const EMAIL_BASE_KEYWORDS = ['email', 'mail']
// Unambiguous on their own even with no base keyword present (a column
// just named "Mobile" or "Cell") — unlike "Home" or "Work" alone, which
// are equally plausible as address fields and require a base keyword too.
const UNAMBIGUOUS_PHONE_MODIFIERS = ['mobile', 'cell']

// 'fax' checked first: it's a wholly unambiguous substring (no other
// subtype's keywords contain "fax" and "fax" contains none of theirs), so
// checking it first costs nothing and resolves a real collision —
// "Office Fax" normalizes to "officefax", which contains both "office"
// (a 'work' keyword) and "fax"; checking 'work' first would wrongly
// classify it as a work-phone column before 'fax' is ever considered.
const SUBTYPE_KEYWORDS: Array<[PhoneEmailSubtype, string[]]> = [
  ['fax', ['fax']],
  ['mobile', ['mobile', 'cell']],
  ['work', ['work', 'office', 'business']],
  ['home', ['home']],
]

export interface PhoneEmailSubtypeResult { base: 'phone' | 'email'; subtype: PhoneEmailSubtype }

export function detectPhoneEmailSubtype(columnName: string): PhoneEmailSubtypeResult | null {
  const normalized = normalizeColumnName(columnName)
  const hasPhoneBase = hasAnyKeyword(normalized, PHONE_BASE_KEYWORDS)
  const hasEmailBase = hasAnyKeyword(normalized, EMAIL_BASE_KEYWORDS)
  const hasUnambiguousPhoneModifier = hasAnyKeyword(normalized, UNAMBIGUOUS_PHONE_MODIFIERS)
  if (!hasPhoneBase && !hasEmailBase && !hasUnambiguousPhoneModifier) return null

  for (const [subtype, keywords] of SUBTYPE_KEYWORDS) {
    if (!hasAnyKeyword(normalized, keywords)) continue
    if (hasEmailBase && !hasPhoneBase) return { base: 'email', subtype }
    return { base: 'phone', subtype }
  }
  return null
}

// Never invents a field: only resolves to a custom field that actually
// exists in the cached schema, by label. If nothing matches, the caller
// must leave the column unmapped rather than guess a field key.
export function resolveSubtypeTargetField(result: PhoneEmailSubtypeResult, targetFields: TargetField[]): TargetField | null {
  const subtypeKeywords = SUBTYPE_KEYWORDS.find(([s]) => s === result.subtype)![1]
  // "Fax" alone is already unambiguous — unlike mobile/home/work, which
  // need a phone/email base word on the target field's own label to avoid
  // matching an unrelated field, a field labeled just "Fax" is definitely
  // a fax field with no base word required.
  const wantedBaseWords = result.subtype === 'fax' ? [] : (result.base === 'phone' ? ['phone', 'tel'] : ['email', 'mail'])
  return targetFields.find(f => {
    const normalized = normalizeColumnName(f.label)
    const hasBase = wantedBaseWords.length === 0 || hasAnyKeyword(normalized, wantedBaseWords)
    return hasBase && hasAnyKeyword(normalized, subtypeKeywords)
  }) ?? null
}

export function matchTargetSchema(columnName: string, targetFields: TargetField[]): TargetField | null {
  const normalized = normalizeColumnName(columnName)
  return targetFields.find(f => normalizeColumnName(f.label) === normalized || normalizeColumnName(f.key) === normalized) ?? null
}

// Case-sensitive on purpose: a profile entry encodes specific prior
// knowledge of a source's exact export column spelling, not a fuzzy guess.
export function matchSourceProfile(columnName: string, sourceSystem: 'salesforce' | 'hubspot' | null, profiles: SourceProfileEntry[]): SourceProfileEntry | null {
  if (!sourceSystem) return null
  return profiles.find(p => p.source_system === sourceSystem && p.pattern === columnName) ?? null
}

export interface PhoneEmailColumn { columnName: string; subtype: PhoneEmailSubtype | null }
const SUBTYPE_PRIORITY: Record<PhoneEmailSubtype, number> = { mobile: 0, work: 1, home: 2, other: 3, fax: 4 }

// GHL's contact object has exactly one primary phone/email field. Given
// several phone- or email-like columns, picks which becomes primary
// (mobile > work > home > other > fax); the rest stay mapped as their own
// custom fields (spec §6.1 step 4).
export function pickPrimaryPhoneEmailColumn(columns: PhoneEmailColumn[]): string | null {
  if (columns.length === 0) return null
  const sorted = [...columns].sort((a, b) => {
    const pa = a.subtype ? SUBTYPE_PRIORITY[a.subtype] : 99
    const pb = b.subtype ? SUBTYPE_PRIORITY[b.subtype] : 99
    return pa - pb
  })
  return sorted[0].columnName
}

export interface ClassifyColumnInput {
  columnName: string
  sampleValues: string[]
  sourceSystem: 'salesforce' | 'hubspot' | null
  targetFields: TargetField[]
  sourceProfiles: SourceProfileEntry[]
}

export function classifyColumn(input: ClassifyColumnInput): ColumnClassification {
  const { columnName, sampleValues, sourceSystem, targetFields, sourceProfiles } = input

  // 1. Source-profile match (most specific prior knowledge).
  const profileMatch = matchSourceProfile(columnName, sourceSystem, sourceProfiles)
  if (profileMatch) {
    const metadata: ColumnClassificationMetadata = {}
    if (profileMatch.subtype_hint) {
      metadata.subtype = profileMatch.subtype_hint
      metadata.country_code_presence = detectCountryCodePresence(sampleValues)
    }
    return { status: 'mapped', mapped_by: 'source_profile', target_field_key: profileMatch.target_field_hint, target_type: 'custom_field', confidence: 1, metadata }
  }

  // 2. Exact/near-exact match against the target object's real schema.
  const schemaMatch = matchTargetSchema(columnName, targetFields)
  if (schemaMatch) {
    const metadata: ColumnClassificationMetadata = {}
    const subtype = detectPhoneEmailSubtype(columnName)
    if (subtype) metadata.subtype = subtype.subtype
    if (schemaMatch.key === 'phone' || schemaMatch.key === 'email' || subtype) {
      metadata.country_code_presence = detectCountryCodePresence(sampleValues)
    }
    return {
      status: 'mapped', mapped_by: 'rule', target_field_key: schemaMatch.key,
      target_type: schemaMatch.type === 'standard' ? 'standard_field' : 'custom_field',
      confidence: 1, metadata,
    }
  }

  // 3. Generic pattern detection — an unambiguous DND channel or
  // phone/email subtype keyword, even with no schema/profile hit.
  const dndChannel = detectDndChannel(columnName)
  if (dndChannel) {
    return { status: 'mapped', mapped_by: 'rule', target_field_key: `dnd_${dndChannel}`, target_type: 'tag', confidence: 1, metadata: { dnd_channel: dndChannel } }
  }

  const subtypeResult = detectPhoneEmailSubtype(columnName)
  if (subtypeResult) {
    const metadata: ColumnClassificationMetadata = { subtype: subtypeResult.subtype }
    if (subtypeResult.base === 'phone') metadata.country_code_presence = detectCountryCodePresence(sampleValues)
    const resolvedField = resolveSubtypeTargetField(subtypeResult, targetFields)
    if (resolvedField) {
      return { status: 'mapped', mapped_by: 'rule', target_field_key: resolvedField.key, target_type: 'custom_field', confidence: 1, metadata }
    }
    // Detected a subtype but no matching field exists in the real schema —
    // never invent one. Falls through to unmapped/Claude tier with the
    // detected metadata preserved for that tier's context.
    return { status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata }
  }

  // Neither tier found a plausible match — the caller (Task 8's upload
  // function) routes this to the Claude tier (Task 11/12) before it can
  // ever surface to the user as unmapped/red.
  return { status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata: {} }
}
```

- [ ] **Step 2: Write the test file (RED first — delete the module content mentally; these must fail against an empty/missing module)**

```ts
// supabase/functions/_shared/__tests__/dataAgentMatching.test.ts
import { describe, it, expect } from 'vitest'
import {
  normalizeColumnName, detectCountryCodePresence, detectDndChannel, detectPhoneEmailSubtype,
  resolveSubtypeTargetField, matchTargetSchema, matchSourceProfile, pickPrimaryPhoneEmailColumn,
  classifyColumn, type TargetField, type SourceProfileEntry,
} from '../dataAgentMatching'

const GHL_CONTACT_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', type: 'standard' },
  { key: 'lastName', label: 'Last Name', type: 'standard' },
  { key: 'email', label: 'Email', type: 'standard' },
  { key: 'phone', label: 'Phone', type: 'standard' },
  { key: 'custom_mobile_phone', label: 'Mobile Phone', type: 'custom' },
  { key: 'custom_work_phone', label: 'Work Phone', type: 'custom' },
  { key: 'custom_fax', label: 'Fax', type: 'custom' },
]

const SALESFORCE_PROFILES: SourceProfileEntry[] = [
  { source_system: 'salesforce', pattern: 'MobilePhone', target_field_hint: 'custom_mobile_phone', subtype_hint: 'mobile' },
  { source_system: 'salesforce', pattern: 'HasOptedOutOfEmail', target_field_hint: 'dnd_email', subtype_hint: null },
]

describe('normalizeColumnName', () => {
  it('lowercases, trims, and strips punctuation/whitespace', () => {
    expect(normalizeColumnName('  Mobile Phone  ')).toBe('mobilephone')
    expect(normalizeColumnName('E-Mail_Address')).toBe('emailaddress')
  })
})

describe('detectCountryCodePresence', () => {
  it('is present when every non-empty value has a leading +', () => {
    expect(detectCountryCodePresence(['+14155551234', '+6591234567'])).toBe('present')
  })
  it('is absent when no value has one', () => {
    expect(detectCountryCodePresence(['4155551234', '91234567'])).toBe('absent')
  })
  it('is mixed when some do and some do not', () => {
    expect(detectCountryCodePresence(['+14155551234', '91234567'])).toBe('mixed')
  })
  it('ignores blank values and treats an all-blank column as absent', () => {
    expect(detectCountryCodePresence(['', '  ', ''])).toBe('absent')
  })
})

describe('detectDndChannel', () => {
  it('maps "Email Opt-Out" to the email channel', () => {
    expect(detectDndChannel('Email Opt-Out')).toBe('email')
  })
  it('maps "Do Not Call" to the call channel', () => {
    expect(detectDndChannel('Do Not Call')).toBe('call')
  })
  it('maps "SMS Opt Out" to the sms channel', () => {
    expect(detectDndChannel('SMS Opt Out')).toBe('sms')
  })
  it('returns null for an ambiguous generic "Do Not Contact"', () => {
    expect(detectDndChannel('Do Not Contact')).toBeNull()
  })
})

describe('detectPhoneEmailSubtype', () => {
  it('detects "HomePhone" as phone/home', () => {
    expect(detectPhoneEmailSubtype('HomePhone')).toEqual({ base: 'phone', subtype: 'home' })
  })
  it('detects "Work Email" as email/work', () => {
    expect(detectPhoneEmailSubtype('Work Email')).toEqual({ base: 'email', subtype: 'work' })
  })
  it('detects the unambiguous modifier "Mobile" alone as phone/mobile', () => {
    expect(detectPhoneEmailSubtype('Mobile')).toEqual({ base: 'phone', subtype: 'mobile' })
  })
  it('detects "Cell" alone as phone/mobile', () => {
    expect(detectPhoneEmailSubtype('Cell')).toEqual({ base: 'phone', subtype: 'mobile' })
  })
  it('detects "Fax" as phone/fax', () => {
    expect(detectPhoneEmailSubtype('Fax')).toEqual({ base: 'phone', subtype: 'fax' })
  })
  it('does not treat ambiguous "Home" alone (no base keyword) as a phone subtype', () => {
    expect(detectPhoneEmailSubtype('Home')).toBeNull()
  })
  it('does not treat ambiguous "Work" alone as a phone or email subtype', () => {
    expect(detectPhoneEmailSubtype('Work')).toBeNull()
  })
  it('returns null for a column name with no phone/email signal at all', () => {
    expect(detectPhoneEmailSubtype('Company Name')).toBeNull()
  })
})

describe('resolveSubtypeTargetField', () => {
  it('finds an existing "Mobile Phone" custom field for a phone/mobile subtype', () => {
    const field = resolveSubtypeTargetField({ base: 'phone', subtype: 'mobile' }, GHL_CONTACT_FIELDS)
    expect(field?.key).toBe('custom_mobile_phone')
  })
  it('returns null rather than inventing a field when none matches (phone/home has no custom field here)', () => {
    expect(resolveSubtypeTargetField({ base: 'phone', subtype: 'home' }, GHL_CONTACT_FIELDS)).toBeNull()
  })
  it('resolves a fax-subtype column to a field labeled just "Fax", with no phone/tel base word required on the field label', () => {
    const field = resolveSubtypeTargetField({ base: 'phone', subtype: 'fax' }, GHL_CONTACT_FIELDS)
    expect(field?.key).toBe('custom_fax')
  })
})

describe('matchTargetSchema', () => {
  it('matches by label case/whitespace-insensitively', () => {
    expect(matchTargetSchema('  phone  ', GHL_CONTACT_FIELDS)?.key).toBe('phone')
  })
  it('matches by key when the label differs', () => {
    expect(matchTargetSchema('firstName', GHL_CONTACT_FIELDS)?.key).toBe('firstName')
  })
  it('returns null when nothing matches', () => {
    expect(matchTargetSchema('Favorite Color', GHL_CONTACT_FIELDS)).toBeNull()
  })
})

describe('matchSourceProfile', () => {
  it('matches a known Salesforce export column exactly', () => {
    expect(matchSourceProfile('MobilePhone', 'salesforce', SALESFORCE_PROFILES)?.target_field_hint).toBe('custom_mobile_phone')
  })
  it('is case-sensitive — "mobilephone" does not match "MobilePhone"', () => {
    expect(matchSourceProfile('mobilephone', 'salesforce', SALESFORCE_PROFILES)).toBeNull()
  })
  it('returns null when no source system was selected, even if the pattern would match', () => {
    expect(matchSourceProfile('MobilePhone', null, SALESFORCE_PROFILES)).toBeNull()
  })
})

describe('pickPrimaryPhoneEmailColumn', () => {
  it('prefers mobile over work over home over fax', () => {
    const cols = [
      { columnName: 'Home Phone', subtype: 'home' as const },
      { columnName: 'Fax', subtype: 'fax' as const },
      { columnName: 'Mobile', subtype: 'mobile' as const },
      { columnName: 'Work Phone', subtype: 'work' as const },
    ]
    expect(pickPrimaryPhoneEmailColumn(cols)).toBe('Mobile')
  })
  it('returns null for an empty list', () => {
    expect(pickPrimaryPhoneEmailColumn([])).toBeNull()
  })
})

describe('classifyColumn', () => {
  const base = { sampleValues: ['x', 'y'], sourceSystem: null as 'salesforce' | 'hubspot' | null, targetFields: GHL_CONTACT_FIELDS, sourceProfiles: [] as SourceProfileEntry[] }

  it('green-maps an exact standard field match', () => {
    const result = classifyColumn({ ...base, columnName: 'Email' })
    expect(result).toEqual({ status: 'mapped', mapped_by: 'rule', target_field_key: 'email', target_type: 'standard_field', confidence: 1, metadata: { country_code_presence: 'absent' } })
  })

  it('green-maps via a source profile when a source system is selected, even though the name would not fuzzy-match the schema', () => {
    const result = classifyColumn({ ...base, columnName: 'MobilePhone', sourceSystem: 'salesforce', sourceProfiles: SALESFORCE_PROFILES, sampleValues: ['+14155551234'] })
    expect(result.status).toBe('mapped')
    expect(result.mapped_by).toBe('source_profile')
    expect(result.target_field_key).toBe('custom_mobile_phone')
    expect(result.metadata.subtype).toBe('mobile')
  })

  it('green-maps an unambiguous DND channel column with no schema/profile hit', () => {
    const result = classifyColumn({ ...base, columnName: 'Email Opt-Out' })
    expect(result).toEqual({ status: 'mapped', mapped_by: 'rule', target_field_key: 'dnd_email', target_type: 'tag', confidence: 1, metadata: { dnd_channel: 'email' } })
  })

  it('green-maps a subtype column to an existing matching custom field', () => {
    const result = classifyColumn({ ...base, columnName: 'Mobile Number', sampleValues: ['+14155551234'] })
    expect(result.status).toBe('mapped')
    expect(result.target_field_key).toBe('custom_mobile_phone')
  })

  it('green-maps a non-exact fax-subtype column name (not the literal "Fax") to the existing fax custom field', () => {
    // "Office Fax" doesn't exact-match the schema's "Fax" label (step 2),
    // so this only passes through resolveSubtypeTargetField's fax-specific
    // base-word exemption (step 3) — a regression here would silently
    // reintroduce the under-mapping bug that exemption fixes.
    const result = classifyColumn({ ...base, columnName: 'Office Fax' })
    expect(result.status).toBe('mapped')
    expect(result.target_field_key).toBe('custom_fax')
  })

  it('routes an ambiguous "Do Not Contact" column to unmapped rather than guessing a channel', () => {
    const result = classifyColumn({ ...base, columnName: 'Do Not Contact' })
    expect(result.status).toBe('unmapped')
  })

  it('routes a detected-but-unresolvable subtype (no matching field exists) to unmapped, preserving metadata', () => {
    const result = classifyColumn({ ...base, columnName: 'Home Phone', sampleValues: ['4155551234'] })
    expect(result.status).toBe('unmapped')
    expect(result.metadata.subtype).toBe('home')
  })

  it('routes a column with no plausible match at all to unmapped', () => {
    const result = classifyColumn({ ...base, columnName: 'Favorite Color' })
    expect(result).toEqual({ status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata: {} })
  })

  it('does not throw and still returns a defined status for a column whose sample values are all blank', () => {
    const result = classifyColumn({ ...base, columnName: 'Middle Name', sampleValues: ['', '', ''] })
    expect(['mapped', 'uncertain', 'unmapped']).toContain(result.status)
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentMatching.test.ts`
Expected: PASS (35 tests — the `describe` blocks above nest several `it`s each; the actual count is 35, not a round number). This file is auto-discovered by the existing Vitest config (`src/test/setup.ts` sets `environment: 'jsdom', globals: true`; the config's `exclude` only drops `node_modules` and `.worktrees` — nothing excludes `supabase/functions`, so this test is picked up without any config change).

- [ ] **Step 4: Set up a real typecheck for the `_shared/` pure modules**

The root `tsconfig.json` has `"include": ["src"]` — running `tsc --noEmit` against it never includes any file under `supabase/functions/`, so "no errors" from that command is vacuous for this module (verified directly: `tsc --noEmit --listFiles` includes no file from `supabase/functions/_shared`). The Deno edge-function entry points (`index.ts` files) genuinely can't be checked by vanilla `tsc` anyway — they use `Deno.serve`/`Deno.env` globals and `https://esm.sh/...` URL imports with no local type resolution. But `dataAgentMatching.ts` (and every future zero/local-only-import module under `_shared/`, per this plan's design) has neither problem and deserves a real check. Create a dedicated config scoped to exactly that subset:

```json
// supabase/functions/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true
  },
  "include": ["_shared/**/*.ts"],
  "exclude": ["_shared/__tests__", "_shared/dataAgentSchemaCache.ts", "_shared/accountEmails.ts", "_shared/inviteEmail.ts", "_shared/projectEmails.ts", "_shared/smtp.ts"]
}
```

`dataAgentSchemaCache.ts` (Task 5) is excluded because it imports a type from `https://esm.sh/@supabase/supabase-js@2`, which this config's `moduleResolution` can't resolve — it stays in the already-documented "edge-function files aren't type-checked" bucket. The same reasoning applies to four pre-existing, unrelated files this `include` glob would otherwise also sweep in: `accountEmails.ts`, `inviteEmail.ts`, `projectEmails.ts`, `smtp.ts` (email-sending helpers for other features, predating this plan, each importing from `esm.sh` or `deno.land`) — also excluded, verified directly by reading their actual `import` lines rather than assumed. Every `_shared/*.ts` file this plan itself creates (Tasks 8, 11, 12, 13, 15, 16, 17 — `parseCsv.ts`, `dataAgentUploadPlanner.ts`, `dataAgentClaude.ts`, `dataAgentPrompt.ts`, `dataAgentWriter.ts`, `dataAgentQa.ts`) imports only local relative files with no `esm.sh`/`deno.land` specifiers, so this config's `include: ["_shared/**/*.ts"]` catches them automatically as they're added — no further edit to this file's `include` is needed later, only `exclude` if a future file breaks this pattern.

- [ ] **Step 5: Typecheck and commit**

Run: `node_modules/.bin/tsc --noEmit -p supabase/functions/tsconfig.json`
Expected: no errors — this is the real check for this module (not the root `tsc --noEmit`, which doesn't see it at all).

Run: `corepack pnpm tsc --noEmit`
Expected: no errors (confirms no regression to the frontend itself; this run still doesn't see `_shared/` files, by design — see Step 4).

```bash
git add supabase/functions/_shared/dataAgentMatching.ts supabase/functions/_shared/__tests__/dataAgentMatching.test.ts supabase/functions/tsconfig.json
git commit -m "feat: add Data Agent pure rules-tier matching engine with full unit coverage"
```

---

### Task 7: Migration-pipeline tables, storage bucket, and source-profile seed

**Files:**
- Create: `supabase/migrations/20261018000100_data_agent_migration_pipeline.sql`

**Interfaces:**
- Produces: tables `data_agent_migrations`, `data_agent_column_mappings`, `data_agent_migration_records`, `data_agent_qa_samples`, `data_agent_source_profiles` (seeded), `data_agent_chat_messages`, `data_agent_prompts`; storage bucket `data-agent-uploads`; RPC `public.confirm_data_agent_migration(p_migration_id uuid, p_default_country_code text default null) returns void`; redefines `public.is_data_agent_member()` (Task 1) to guarantee it never returns `null` — fixing every caller, including Task 17's later RPC and any RLS policy, without touching Task 1's already-applied migration.
- Consumes: `is_data_agent_member` (Task 1).

- [ ] **Step 1: Write the migration**

```sql
-- Migration 20261018000100: Data Agent — migration pipeline tables, CSV
-- storage bucket, and curated source-system profiles (spec §4-6, §9, §11).

create table public.data_agent_migrations (
  id                  uuid primary key default gen_random_uuid(),
  sub_account         text not null references public.sub_accounts(code) on delete cascade,
  created_by          uuid references public.users(id) on delete set null,
  target_object_type  text not null,
  source_system       text check (source_system in ('salesforce', 'hubspot')),
  original_filename   text not null,
  storage_path        text not null,
  row_count           integer not null default 0,
  match_key_column    text,
  default_country_code text, -- e.g. '+65'; required by the gate below whenever a mapped phone column's sample values are absent/mixed on country code (spec §6.1 step 3, §7 step 2)
  status              text not null default 'uploaded' check (status in (
                        'uploaded', 'mapping', 'awaiting_confirmation', 'migrating',
                        'verifying', 'completed', 'failed', 'cancelled', 'undoing', 'undone')),
  accuracy_rating     numeric,
  started_at          timestamptz,
  completed_at        timestamptz,
  error_message       text,
  created_at          timestamptz not null default now()
);
create index data_agent_migrations_sub_account_idx on public.data_agent_migrations (sub_account, created_at desc);

create table public.data_agent_column_mappings (
  id                  uuid primary key default gen_random_uuid(),
  migration_id        uuid not null references public.data_agent_migrations(id) on delete cascade,
  source_column_name  text not null,
  sample_values       jsonb not null default '[]'::jsonb,
  target_type         text not null default 'ignored' check (target_type in ('standard_field', 'custom_field', 'tag', 'ignored')),
  target_field_key    text,
  status              text not null default 'unmapped' check (status in ('mapped', 'uncertain', 'unmapped')),
  confidence           numeric,
  reasoning            text,
  mapped_by            text check (mapped_by in ('rule', 'source_profile', 'claude', 'user')),
  confirmed_by_user    boolean not null default false,
  metadata             jsonb not null default '{}'::jsonb
);
create index data_agent_column_mappings_migration_idx on public.data_agent_column_mappings (migration_id);

create table public.data_agent_migration_records (
  id                     uuid primary key default gen_random_uuid(),
  migration_id           uuid not null references public.data_agent_migrations(id) on delete cascade,
  row_number             integer not null,
  source_row_data        jsonb not null,
  ghl_record_id          text,
  pre_replace_snapshot   jsonb,
  write_status           text not null default 'pending' check (write_status in ('pending', 'created', 'replaced', 'failed', 'skipped')),
  error_message          text,
  written_at             timestamptz
);
create index data_agent_migration_records_migration_idx on public.data_agent_migration_records (migration_id, row_number);
create index data_agent_migration_records_status_idx on public.data_agent_migration_records (migration_id, write_status);

create table public.data_agent_qa_samples (
  id                   uuid primary key default gen_random_uuid(),
  migration_record_id uuid not null references public.data_agent_migration_records(id) on delete cascade,
  fetched_ghl_data     jsonb not null,
  field_comparisons    jsonb not null default '[]'::jsonb,
  match_pct            numeric not null,
  created_at           timestamptz not null default now()
);

create table public.data_agent_source_profiles (
  id                 uuid primary key default gen_random_uuid(),
  source_system      text not null check (source_system in ('salesforce', 'hubspot')),
  pattern            text not null,
  target_field_hint  text not null,
  subtype_hint       text check (subtype_hint in ('mobile', 'home', 'work', 'fax', 'other')),
  notes              text,
  unique (source_system, pattern)
);

create table public.data_agent_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  sub_account text not null references public.sub_accounts(code) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  message     text not null check (length(trim(message)) > 0),
  created_at  timestamptz not null default now()
);
create index data_agent_chat_messages_sub_account_idx on public.data_agent_chat_messages (sub_account, created_at);

create table public.data_agent_prompts (
  id                 uuid primary key default gen_random_uuid(),
  migration_id       uuid not null references public.data_agent_migrations(id) on delete cascade,
  column_mapping_id  uuid references public.data_agent_column_mappings(id) on delete cascade,
  user_id            uuid references public.users(id) on delete set null,
  prompt_text        text not null,
  response_text      text,
  action_taken       jsonb,
  created_at         timestamptz not null default now()
);
create index data_agent_prompts_migration_idx on public.data_agent_prompts (migration_id);

-- ── Seed: curated source-system profiles (spec §6.2) ────────────────────────
insert into public.data_agent_source_profiles (source_system, pattern, target_field_hint, subtype_hint, notes) values
  ('salesforce', 'FirstName', 'firstName', null, null),
  ('salesforce', 'LastName', 'lastName', null, null),
  ('salesforce', 'Email', 'email', null, null),
  ('salesforce', 'Phone', 'phone', null, 'Primary phone'),
  ('salesforce', 'MobilePhone', 'custom_mobile_phone', 'mobile', null),
  ('salesforce', 'HomePhone', 'custom_home_phone', 'home', null),
  ('salesforce', 'OtherPhone', 'custom_other_phone', 'other', null),
  ('salesforce', 'Fax', 'custom_fax', 'fax', 'Flagged, not auto-mapped to primary phone'),
  ('salesforce', 'MailingStreet', 'address1', null, null),
  ('salesforce', 'MailingCity', 'city', null, null),
  ('salesforce', 'MailingState', 'state', null, null),
  ('salesforce', 'MailingPostalCode', 'postalCode', null, null),
  ('salesforce', 'MailingCountry', 'country', null, null),
  ('salesforce', 'DoNotCall', 'dnd_call', null, null),
  ('salesforce', 'HasOptedOutOfEmail', 'dnd_email', null, null),
  ('salesforce', 'Title', 'custom_title', null, null),
  ('salesforce', 'Description', 'custom_description', null, null),
  ('salesforce', 'LeadSource', 'custom_lead_source', null, null),
  ('hubspot', 'firstname', 'firstName', null, null),
  ('hubspot', 'lastname', 'lastName', null, null),
  ('hubspot', 'email', 'email', null, null),
  ('hubspot', 'phone', 'phone', null, 'Primary phone'),
  ('hubspot', 'mobilephone', 'custom_mobile_phone', 'mobile', null),
  ('hubspot', 'company', 'companyName', null, null),
  ('hubspot', 'jobtitle', 'custom_title', null, null),
  ('hubspot', 'address', 'address1', null, null),
  ('hubspot', 'city', 'city', null, null),
  ('hubspot', 'state', 'state', null, null),
  ('hubspot', 'zip', 'postalCode', null, null),
  ('hubspot', 'country', 'country', null, null),
  ('hubspot', 'website', 'website', null, null),
  ('hubspot', 'hs_email_optout', 'dnd_email', null, null),
  ('hubspot', 'lifecyclestage', 'custom_lifecycle_stage', null, null),
  ('hubspot', 'hs_lead_status', 'custom_lead_status', null, null);
  -- Note: HubSpot has no universal standard "do-not-call" property across
  -- portals (spec §6.2) — deliberately no hubspot DND-call row here; such a
  -- column is routed to the Claude tier rather than guessed.

-- ── Fix: is_data_agent_member() must never return null ──────────────────────
-- Found during this task's own review: auth_user_role()/auth_user_sub_account()/
-- auth_user_app_id() all resolve to NULL for a suspended or deleted-but-
-- still-logged-in caller (migration 027), which made Task 1's original
-- definition of this function (below, unchanged otherwise) evaluate to
-- NULL instead of false in that case. Harmless in every RLS USING/WITH
-- CHECK usage (NULL excludes a row exactly like false does) — but
-- `confirm_data_agent_migration` just below calls this imperatively via
-- `if not ... then raise exception`, and PL/pgSQL's `if null then` never
-- executes the branch, so a NULL return silently skipped the
-- authorization check entirely. Redefining here (never edit Task 1's
-- already-applied migration) with a top-level coalesce fixes every
-- caller, RLS or imperative, present or future.
create or replace function public.is_data_agent_member(p_sub_account text)
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select coalesce(
    exists (select 1 from public.data_agent_entitlements e where e.sub_account = p_sub_account and e.enabled)
    and (
      public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_sub_account() = p_sub_account
        and (
          public.auth_user_role() = 'Admin'
          or exists (select 1 from public.data_agent_members m where m.sub_account = p_sub_account and m.user_id = public.auth_user_app_id())
        )
      )
    ),
    false
  )
$$;
revoke execute on function public.is_data_agent_member(text) from public, anon;
grant execute on function public.is_data_agent_member(text) to authenticated;

-- ── Gate enforcement: the one place a migration can leave `mapping` ──────────
-- Re-validates server-side, never trusting a client-only check, that every
-- column is green (confirmed rule/profile/user match) or explicitly
-- ignored before flipping status (spec §6.4's hard gate).
-- p_default_country_code: there is deliberately no client UPDATE policy
-- on data_agent_migrations (see this table's RLS comment below) — this
-- SECURITY DEFINER function is the only write path into that table from
-- the browser, so it accepts the value as a parameter here rather than
-- requiring a separate prior write the client has no privilege to make
-- (found during Task 10's review: a direct client-side
-- `.update({ default_country_code })` call is a guaranteed silent RLS
-- no-op — 0 rows matched, no exception).
create or replace function public.confirm_data_agent_migration(p_migration_id uuid, p_default_country_code text default null)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_sub_account text;
  v_blocking_count int;
  v_needs_country_code boolean;
  v_default_country_code text;
begin
  select sub_account, default_country_code into v_sub_account, v_default_country_code
    from public.data_agent_migrations where id = p_migration_id;
  if v_sub_account is null then
    raise exception 'Migration not found';
  end if;
  -- is_data_agent_member() always returns true/false, never null (see its
  -- own definition) — the explicit "is not true" here is defense in
  -- depth, not a workaround: this is the single authorization gate before
  -- a real CRM write, and must stay correct even if a future edit to that
  -- function's body ever reintroduced a NULL path.
  if coalesce(public.is_data_agent_member(v_sub_account), false) is not true then
    raise exception 'Not authorized for this migration';
  end if;

  if p_default_country_code is not null and trim(p_default_country_code) <> '' then
    v_default_country_code := trim(p_default_country_code);
  end if;

  -- Blocking is purely a function of status, never target_type: a column
  -- the user explicitly chose to ignore is written back as status =
  -- 'mapped', target_type = 'ignored' (Task 10) — "ignored" is itself a
  -- resolved decision. target_type = 'ignored' also appears on a genuinely
  -- unmapped column (classifyColumn's no-match default, Task 6), but that
  -- case keeps status = 'unmapped' and still blocks correctly.
  select count(*) into v_blocking_count
    from public.data_agent_column_mappings
    where migration_id = p_migration_id
      and status in ('uncertain', 'unmapped');
  if v_blocking_count > 0 then
    raise exception 'Cannot confirm: % column(s) are not yet mapped or explicitly ignored', v_blocking_count;
  end if;

  -- A mapped phone column with absent/mixed country codes on its sample
  -- values needs an explicit default before any write that needs one —
  -- never a silent assumption (spec §6.1 step 3).
  select exists (
    select 1 from public.data_agent_column_mappings
    where migration_id = p_migration_id
      and status = 'mapped'
      and metadata->>'country_code_presence' in ('absent', 'mixed')
  ) into v_needs_country_code;
  if v_needs_country_code and coalesce(trim(v_default_country_code), '') = '' then
    raise exception 'Cannot confirm: a default country code is required for at least one phone column';
  end if;

  -- Accepts either pre-migration status. 'awaiting_confirmation' is the
  -- lucky case: every column was already green at upload time, per Task
  -- 8's computeMigrationStatus. 'mapping' is the common case this page
  -- (Task 10) exists for: a migration that needed manual review and
  -- reaches this RPC only once every column is resolved HERE — nothing
  -- else ever transitions it to 'awaiting_confirmation' first (found
  -- during Task 10's review: requiring that status alone made this RPC
  -- unreachable for exactly the workflow it's built to serve). The
  -- blocking-count and country-code checks above are the real gate;
  -- requiring one specific status string on top of them was redundant.
  update public.data_agent_migrations
    set status = 'migrating', started_at = now(), default_country_code = v_default_country_code
    where id = p_migration_id and status in ('mapping', 'awaiting_confirmation');
  if not found then
    raise exception 'Migration is not awaiting confirmation';
  end if;
end;
$$;
revoke execute on function public.confirm_data_agent_migration(uuid, text) from public, anon;
grant execute on function public.confirm_data_agent_migration(uuid, text) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.data_agent_migrations enable row level security;
alter table public.data_agent_column_mappings enable row level security;
alter table public.data_agent_migration_records enable row level security;
alter table public.data_agent_qa_samples enable row level security;
alter table public.data_agent_source_profiles enable row level security;
alter table public.data_agent_chat_messages enable row level security;
alter table public.data_agent_prompts enable row level security;

create policy data_agent_migrations_select on public.data_agent_migrations
  for select using (public.is_data_agent_member(sub_account));
create policy data_agent_migrations_insert on public.data_agent_migrations
  for insert with check (public.is_data_agent_member(sub_account) and created_by = public.auth_user_app_id());
-- No client update/delete policy — status transitions and row edits only
-- ever happen via confirm_data_agent_migration(), the worker (service
-- role), or data-agent-upload (service role). Default-deny otherwise.

create policy data_agent_column_mappings_select on public.data_agent_column_mappings
  for select using (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account)));
create policy data_agent_column_mappings_update on public.data_agent_column_mappings
  for update using (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account) and m.status in ('mapping', 'awaiting_confirmation')))
  with check (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account) and m.status in ('mapping', 'awaiting_confirmation')));

create policy data_agent_migration_records_select on public.data_agent_migration_records
  for select using (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account)));

create policy data_agent_qa_samples_select on public.data_agent_qa_samples
  for select using (exists (
    select 1 from public.data_agent_migration_records r
    join public.data_agent_migrations m on m.id = r.migration_id
    where r.id = migration_record_id and public.is_data_agent_member(m.sub_account)));

-- Source profiles: non-sensitive curated reference data, readable by any
-- authenticated Data Agent member of some entitled sub-account; writable
-- only by Super-Admin (spec §4: "not user-editable through the UI in this
-- version").
create policy data_agent_source_profiles_select on public.data_agent_source_profiles
  for select to authenticated using (true);
create policy data_agent_source_profiles_write on public.data_agent_source_profiles
  for all using (public.auth_user_role() = 'Super-Admin') with check (public.auth_user_role() = 'Super-Admin');

create policy data_agent_chat_messages_select on public.data_agent_chat_messages
  for select using (public.is_data_agent_member(sub_account));
create policy data_agent_chat_messages_insert on public.data_agent_chat_messages
  for insert with check (public.is_data_agent_member(sub_account) and user_id = public.auth_user_app_id());

create policy data_agent_prompts_select on public.data_agent_prompts
  for select using (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account)));
create policy data_agent_prompts_insert on public.data_agent_prompts
  for insert with check (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account) and user_id = public.auth_user_app_id()));

-- ── Associate lock ───────────────────────────────────────────────────────────
create policy data_agent_migrations_deny_associates on public.data_agent_migrations
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_column_mappings_deny_associates on public.data_agent_column_mappings
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_migration_records_deny_associates on public.data_agent_migration_records
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_qa_samples_deny_associates on public.data_agent_qa_samples
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_source_profiles_deny_associates on public.data_agent_source_profiles
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_chat_messages_deny_associates on public.data_agent_chat_messages
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_prompts_deny_associates on public.data_agent_prompts
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));

-- ── Storage bucket for uploaded CSVs ────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('data-agent-uploads', 'data-agent-uploads', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Path convention: "<sub_account>/<migration_id>-<original filename>" — the
-- first folder segment is the sub_account code itself (text, not a uuid),
-- so is_data_agent_member can check it directly with no try_uuid cast.
drop policy if exists data_agent_uploads_obj_select on storage.objects;
create policy data_agent_uploads_obj_select on storage.objects
  for select to authenticated
  using (bucket_id = 'data-agent-uploads' and public.is_data_agent_member((storage.foldername(name))[1]));

drop policy if exists data_agent_uploads_obj_insert on storage.objects;
create policy data_agent_uploads_obj_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'data-agent-uploads' and public.is_data_agent_member((storage.foldername(name))[1]));
```

- [ ] **Step 2: Run the existing associate-lock regression test**

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts`
Expected: PASS — all seven new tables are covered by their own `_deny_associates` policy, picked up automatically by the generic scan.

- [ ] **Step 3: Verify live via the Supabase Management API**

```sql
select count(*) from public.data_agent_source_profiles; -- expect 34 (18 salesforce + 16 hubspot)
select proname from pg_proc where proname = 'confirm_data_agent_migration';
select id, public from storage.buckets where id = 'data-agent-uploads'; -- expect public = false
-- is_data_agent_member() must never return null — the whole point of this
-- task's redefinition. A sub_account that doesn't exist/isn't entitled
-- must come back false, never null:
select public.is_data_agent_member('a-sub-account-that-does-not-exist') is false as returns_false_not_null;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261018000100_data_agent_migration_pipeline.sql
git commit -m "feat: add Data Agent migration-pipeline tables, upload bucket, and source profiles"
```

---

### Task 8: CSV parser, upload planner, and the upload edge function

**Files:**
- Create: `supabase/functions/_shared/parseCsv.ts`
- Create: `supabase/functions/_shared/__tests__/parseCsv.test.ts`
- Create: `supabase/functions/_shared/dataAgentUploadPlanner.ts`
- Create: `supabase/functions/_shared/__tests__/dataAgentUploadPlanner.test.ts`
- Create: `supabase/functions/data-agent-upload/index.ts`

**Interfaces:**
- Consumes: `classifyColumn`, `pickPrimaryPhoneEmailColumn`, `TargetField`, `SourceProfileEntry`, `ColumnClassification` (Task 6); `ensureSchemaCacheFresh` (Task 5); tables `data_agent_ghl_schema_cache`, `data_agent_connections`, `data_agent_source_profiles`, `data_agent_migrations`, `data_agent_column_mappings` (Tasks 1, 7); `vault.decrypted_secrets`; bucket `data-agent-uploads` (Task 7).
- Produces: `parseCsvWithHeaders(text: string): { headers: string[]; rows: Record<string, string>[] }`; `planColumnMappings(...)`, `computeMigrationStatus(...)`, `buildTargetFields(objectType: string, cachedFields: CachedGhlField[]): TargetField[]` (all consumed again by Task 12). Edge function `data-agent-upload` (POST `{ subAccount, targetObjectType, sourceSystem, storagePath, originalFilename }` → `{ migrationId: string }`).

**Known, flagged, out-of-scope-for-this-task limitation:** `data_agent_source_profiles`' curated `target_field_hint` values for custom fields (e.g. `custom_mobile_phone`, `custom_fax`) are symbolic placeholder keys, not real GHL custom-field IDs — `buildTargetFields` only ever produces real IDs (from the live schema cache) as custom-field keys. A source-profile match today writes that symbolic string directly into `target_field_key`, which Task 15's write pipeline would send to GHL as a literal (and wrong) custom-field ID. This doesn't crash or corrupt data — GHL's API would simply reject that ID with a clear error at write time — but it means a source-profile match's green/"mapped" status is not yet backed by a field that's guaranteed to exist. Resolving this (fuzzy-matching the symbolic hint against the real cached custom fields, the same way `resolveSubtypeTargetField` does for pattern-detected subtypes) is flagged for whichever of Task 12 (Claude tier) or Task 15 (write pipeline) ends up owning it — not fixed here, to avoid rushing a design decision under this task's own fix round.

- [ ] **Step 1: Write the CSV parser test (RED), then the parser**

```ts
// supabase/functions/_shared/__tests__/parseCsv.test.ts
import { describe, it, expect } from 'vitest'
import { parseCsv, parseCsvWithHeaders } from '../parseCsv'

describe('parseCsv', () => {
  it('parses simple comma-separated rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('handles a quoted field containing a comma', () => {
    expect(parseCsv('name,note\n"Smith, John",hello\n')).toEqual([['name', 'note'], ['Smith, John', 'hello']])
  })
  it('handles an escaped double-quote inside a quoted field', () => {
    expect(parseCsv('note\n"she said ""hi"""\n')).toEqual([['note'], ['she said "hi"']])
  })
  it('handles a quoted field containing an embedded newline', () => {
    expect(parseCsv('note\n"line1\nline2"\n')).toEqual([['note'], ['line1\nline2']])
  })
  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })
})

describe('parseCsvWithHeaders', () => {
  it('maps each row to an object keyed by header, trimming cell whitespace', () => {
    const result = parseCsvWithHeaders('Name, Email\n Jane , jane@x.com \n')
    expect(result.headers).toEqual(['Name', 'Email'])
    expect(result.rows).toEqual([{ Name: 'Jane', Email: 'jane@x.com' }])
  })
  it('fills a missing trailing cell with an empty string rather than throwing', () => {
    const result = parseCsvWithHeaders('A,B,C\n1,2\n')
    expect(result.rows).toEqual([{ A: '1', B: '2', C: '' }])
  })
  it('returns empty headers and rows for an empty file', () => {
    expect(parseCsvWithHeaders('')).toEqual({ headers: [], rows: [] })
  })
})
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/parseCsv.test.ts`
Expected: FAIL (module not found).

```ts
// supabase/functions/_shared/parseCsv.ts
// Zero-import, zero-dependency RFC4180-ish CSV parser. No library in
// package.json does this, and pulling one in for a single parser was
// judged unnecessary (YAGNI) given this project's own exports are never
// more than a few thousand rows.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const len = text.length
  while (i < len) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i += 1; continue
      }
      field += char; i += 1; continue
    }
    if (char === '"') { inQuotes = true; i += 1; continue }
    if (char === ',') { row.push(field); field = ''; i += 1; continue }
    if (char === '\r') { i += 1; continue }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue }
    field += char; i += 1
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0] === ''))
}

export interface ParsedCsv { headers: string[]; rows: Record<string, string>[] }

export function parseCsvWithHeaders(text: string): ParsedCsv {
  const raw = parseCsv(text)
  if (raw.length === 0) return { headers: [], rows: [] }
  const headers = raw[0].map(h => h.trim())
  const rows = raw.slice(1).map(cols => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? '').trim() })
    return obj
  })
  return { headers, rows }
}
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/parseCsv.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 2: Write the upload planner test (RED), then the planner**

```ts
// supabase/functions/_shared/__tests__/dataAgentUploadPlanner.test.ts
import { describe, it, expect } from 'vitest'
import { planColumnMappings, computeMigrationStatus, buildTargetFields } from '../dataAgentUploadPlanner'
import type { TargetField } from '../dataAgentMatching'

const FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', type: 'standard' },
  { key: 'email', label: 'Email', type: 'standard' },
  { key: 'phone', label: 'Phone', type: 'standard' },
  { key: 'custom_mobile_phone', label: 'Mobile Phone', type: 'custom' },
]

describe('planColumnMappings', () => {
  it('classifies every header and samples up to the first 10 rows', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ Email: `user${i}@x.com`, Phone: '' }))
    const plan = planColumnMappings(['Email', 'Phone'], rows, null, FIELDS, [])
    expect(plan).toHaveLength(2)
    expect(plan.find(p => p.source_column_name === 'Email')?.sample_values).toHaveLength(10)
  })

  it('flags exactly one primary candidate among several green phone columns, without changing their status', () => {
    const rows = [{ Phone: '+14155550001', Mobile: '+14155550002' }]
    const plan = planColumnMappings(['Phone', 'Mobile'], rows, null, FIELDS, [])
    const phone = plan.find(p => p.source_column_name === 'Phone')!
    const mobile = plan.find(p => p.source_column_name === 'Mobile')!
    expect(mobile.metadata.is_primary_candidate).toBe(true)
    expect(phone.metadata.is_primary_candidate).toBeUndefined()
    expect(phone.status).toBe('mapped')
    expect(mobile.status).toBe('mapped')
  })

  it('does not flag a primary candidate when there is only one phone-like column', () => {
    const rows = [{ Phone: '+14155550001' }]
    const plan = planColumnMappings(['Phone'], rows, null, FIELDS, [])
    expect(plan[0].metadata.is_primary_candidate).toBeUndefined()
  })

  it('handles a column with no rows at all without throwing', () => {
    const plan = planColumnMappings(['Email'], [], null, FIELDS, [])
    expect(plan[0].sample_values).toEqual([])
    expect(plan[0].status).toBe('mapped')
  })

  it('does not mix an email-subtype column into the phone primary-candidate grouping', () => {
    // "Work Email" matches subtype 'work' same as "Work Phone" would —
    // metadata.subtype alone can't tell them apart; without re-deriving
    // base from the column name, this would wrongly flag the email
    // column as a phone primary candidate (or wrongly count 2 "phone"
    // columns when there's really only one).
    const fieldsWithWorkEmail: TargetField[] = [...FIELDS, { key: 'custom_work_email', label: 'Work Email', type: 'custom' }]
    const rows = [{ Phone: '+14155550001', 'Work Email': 'jane@x.com' }]
    const plan = planColumnMappings(['Phone', 'Work Email'], rows, null, fieldsWithWorkEmail, [])
    const phone = plan.find(p => p.source_column_name === 'Phone')!
    const workEmail = plan.find(p => p.source_column_name === 'Work Email')!
    expect(workEmail.target_field_key).toBe('custom_work_email')
    expect(workEmail.metadata.is_primary_candidate).toBeUndefined()
    // Only one real phone-like column exists, so no primary flag at all.
    expect(phone.metadata.is_primary_candidate).toBeUndefined()
  })
})

describe('buildTargetFields', () => {
  it('bridges the real cached custom-field shape ({id, fieldKey, name}) into TargetField ({key, label, type}), using the GHL field id as the key', () => {
    const fields = buildTargetFields('contact', [{ id: 'abc123', fieldKey: 'mobile_phone', name: 'Mobile Phone' }])
    expect(fields).toContainEqual({ key: 'abc123', label: 'Mobile Phone', type: 'custom' })
  })

  it('includes the hardcoded standard contact fields for object type "contact"', () => {
    const fields = buildTargetFields('contact', [])
    expect(fields.map(f => f.key)).toContain('email')
    expect(fields.map(f => f.key)).toContain('phone')
    expect(fields.find(f => f.key === 'email')?.type).toBe('standard')
  })

  it('excludes standard contact fields for a Custom Object target (they do not apply)', () => {
    const fields = buildTargetFields('orders', [{ id: 'xyz789', fieldKey: 'order_number', name: 'Order Number' }])
    expect(fields).toEqual([{ key: 'xyz789', label: 'Order Number', type: 'custom' }])
  })
})

describe('computeMigrationStatus', () => {
  it('is awaiting_confirmation when every column is mapped, including one the user explicitly chose to ignore', () => {
    // A user-ignored column is status: 'mapped', target_type: 'ignored' (Task
    // 10) — "ignored" is itself a resolved decision, not a pending one.
    expect(computeMigrationStatus([{ status: 'mapped' }, { status: 'mapped' }])).toBe('awaiting_confirmation')
  })
  it('is mapping when any column is still uncertain or unmapped', () => {
    expect(computeMigrationStatus([{ status: 'mapped' }, { status: 'uncertain' }])).toBe('mapping')
  })
  it('is mapping for a genuinely unmapped column even though its target_type also happens to be "ignored" (the no-match sentinel, not a user decision)', () => {
    expect(computeMigrationStatus([{ status: 'unmapped' }])).toBe('mapping')
  })
})
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentUploadPlanner.test.ts`
Expected: FAIL (module not found).

```ts
// supabase/functions/_shared/dataAgentUploadPlanner.ts
import { classifyColumn, pickPrimaryPhoneEmailColumn, detectPhoneEmailSubtype, type TargetField, type SourceProfileEntry, type ColumnClassification } from './dataAgentMatching.ts'

export interface PlannedColumnMapping extends ColumnClassification {
  source_column_name: string
  sample_values: string[]
  reasoning?: string // set by Task 12's Claude-tier pass; absent for a rules/profile match
}

// What's actually cached in data_agent_ghl_schema_cache.fields (Task 5's
// fetchContactCustomFields/fetchCustomObjects): GHL's raw custom-field
// shape, never GHL's standard fields (phone/email/name/etc. — GHL's
// customFields endpoint only ever returns custom fields, by definition).
export interface CachedGhlField { id: string; fieldKey: string; name: string }

// GHL's standard contact fields are never returned by any API call this
// app makes (there is no "list standard fields" endpoint — they're fixed,
// documented field names on the Contact object) — hardcoded here because
// that's the only way they can exist at all. Every key here must match
// what upsertContact()/the write pipeline (Task 15) actually sends.
const STANDARD_CONTACT_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', type: 'standard' },
  { key: 'lastName', label: 'Last Name', type: 'standard' },
  { key: 'email', label: 'Email', type: 'standard' },
  { key: 'phone', label: 'Phone', type: 'standard' },
  { key: 'companyName', label: 'Company Name', type: 'standard' },
  { key: 'address1', label: 'Address', type: 'standard' },
  { key: 'city', label: 'City', type: 'standard' },
  { key: 'state', label: 'State', type: 'standard' },
  { key: 'postalCode', label: 'Postal Code', type: 'standard' },
  { key: 'country', label: 'Country', type: 'standard' },
  { key: 'website', label: 'Website', type: 'standard' },
]

// Bridges the real cached data into the shape classifyColumn/matchTargetSchema
// actually expects ({key, label, type}) — the cache's raw {id, fieldKey,
// name} objects are NOT interchangeable with TargetField (different
// property names entirely), and GHL's standard fields need to be supplied
// from the hardcoded list above since nothing ever caches them. A custom
// field's TargetField.key is its GHL field `id` specifically (not
// `fieldKey` or `name`) because that's what the write pipeline's
// customFields payload (Task 15) needs to send back to GHL.
export function buildTargetFields(objectType: string, cachedFields: CachedGhlField[]): TargetField[] {
  const customFields: TargetField[] = cachedFields.map(f => ({ key: f.id, label: f.name, type: 'custom' }))
  return objectType === 'contact' ? [...STANDARD_CONTACT_FIELDS, ...customFields] : customFields
}

const SAMPLE_ROWS = 10

export function planColumnMappings(
  headers: string[],
  rows: Record<string, string>[],
  sourceSystem: 'salesforce' | 'hubspot' | null,
  targetFields: TargetField[],
  sourceProfiles: SourceProfileEntry[],
): PlannedColumnMapping[] {
  const sampleCount = Math.min(rows.length, SAMPLE_ROWS)
  const classifications: PlannedColumnMapping[] = headers.map(columnName => {
    const sampleValues = rows.slice(0, sampleCount).map(r => r[columnName] ?? '')
    const classification = classifyColumn({ columnName, sampleValues, sourceSystem, targetFields, sourceProfiles })
    return { ...classification, source_column_name: columnName, sample_values: sampleValues }
  })

  // Flag which of several green phone-mapped columns is the primary
  // candidate — informational only (spec §6.1 step 4); never changes
  // status. Re-derives the column's base (phone vs. email) directly from
  // its name via detectPhoneEmailSubtype rather than trusting
  // metadata.subtype alone — a subtype like 'work'/'home' applies
  // ambiguously to both bases, so metadata.subtype's mere presence can't
  // tell a "Work Email" column apart from a "Work Phone" column; mixing
  // them into one priority-ranked group could wrongly flag an email
  // column as the phone primary (or vice versa).
  const phoneColumns = classifications
    .filter(c => c.status === 'mapped' && (c.target_field_key === 'phone' || detectPhoneEmailSubtype(c.source_column_name)?.base === 'phone'))
    .map(c => ({ columnName: c.source_column_name, subtype: c.metadata.subtype ?? null }))
  if (phoneColumns.length > 1) {
    const primary = pickPrimaryPhoneEmailColumn(phoneColumns)
    const winner = classifications.find(c => c.source_column_name === primary)
    if (winner) winner.metadata = { ...winner.metadata, is_primary_candidate: true }
  }

  return classifications
}

// Blocking is purely a function of status, never target_type — see the
// comment on confirm_data_agent_migration (Task 7) for why target_type
// alone can't distinguish "nothing to map to" from "user chose to skip
// this column": both use target_type 'ignored', but only the latter sets
// status to 'mapped'.
export function computeMigrationStatus(mappings: { status: ColumnClassification['status'] }[]): 'mapping' | 'awaiting_confirmation' {
  const blocking = mappings.some(m => m.status !== 'mapped')
  return blocking ? 'mapping' : 'awaiting_confirmation'
}
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentUploadPlanner.test.ts`
Expected: PASS (11 tests — 5 under `planColumnMappings`, 3 under `computeMigrationStatus`, 3 under `buildTargetFields`).

- [ ] **Step 3: Write the upload edge function**

The client (Task 9) uploads the raw file to storage first, then calls this function with the resulting path — matching this codebase's existing `project-files` convention of client-direct-to-storage followed by a function/row that processes it, rather than passing file contents through the function payload.

```ts
// supabase/functions/data-agent-upload/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseCsvWithHeaders } from '../_shared/parseCsv.ts'
import { planColumnMappings, computeMigrationStatus, buildTargetFields, type CachedGhlField } from '../_shared/dataAgentUploadPlanner.ts'
import type { SourceProfileEntry } from '../_shared/dataAgentMatching.ts'
import { ensureSchemaCacheFresh } from '../_shared/dataAgentSchemaCache.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

// Every business-outcome branch below returns HTTP 200 (see Task 5's
// data-agent-test-connection for why: supabase-js's functions.invoke()
// throws a generic FunctionsHttpError for any non-2xx response, whose
// .message is always the fixed string "Edge Function returned a non-2xx
// status code" — never this function's own `error` text. Only true
// protocol-level cases (CORS preflight, wrong method) keep a real status
// code, since the UI never has to parse those.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' })

  let body: { subAccount?: unknown; targetObjectType?: unknown; sourceSystem?: unknown; storagePath?: unknown; originalFilename?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }) }
  const subAccount = typeof body.subAccount === 'string' ? body.subAccount : ''
  const targetObjectType = typeof body.targetObjectType === 'string' ? body.targetObjectType : ''
  const sourceSystem = body.sourceSystem === 'salesforce' || body.sourceSystem === 'hubspot' ? body.sourceSystem : null
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : ''
  const originalFilename = typeof body.originalFilename === 'string' ? body.originalFilename : ''
  if (!subAccount || !targetObjectType || !storagePath || !originalFilename) {
    return json({ error: 'subAccount, targetObjectType, storagePath, and originalFilename are required' })
  }
  // The storage bucket's own RLS (Task 7) already enforces this for a
  // direct client upload, but this function downloads via the
  // service-role client, which bypasses that RLS entirely — without this
  // check, an authorized member of subAccount A could pass a storagePath
  // belonging to subAccount B (protected only by the migration's path
  // being hard to guess, not by an actual authorization check) and have
  // B's file ingested under A.
  if (!storagePath.startsWith(`${subAccount}/`)) {
    return json({ error: 'storagePath does not belong to the given subAccount' })
  }

  const { data: isMember } = await callerClient.rpc('is_data_agent_member', { p_sub_account: subAccount })
  if (!isMember) return json({ error: 'Not authorized for this sub-account' })

  const { data: appUser } = await callerClient.from('users').select('id').eq('email', callerAuth.email).single()
  const createdBy = (appUser as { id: string } | null)?.id ?? null

  const serviceClient = createClient(supabaseUrl, serviceKey)

  const { data: fileBlob, error: downloadErr } = await serviceClient.storage.from('data-agent-uploads').download(storagePath)
  if (downloadErr || !fileBlob) return json({ error: `Could not read uploaded file: ${downloadErr?.message ?? 'not found'}` })
  const csvText = await fileBlob.text()
  const { headers, rows } = parseCsvWithHeaders(csvText)
  if (headers.length === 0) return json({ error: 'The uploaded file has no columns' })

  // Analysis must never run against a schema snapshot older than 24h (spec
  // §4) — refresh it now if stale, before any classification happens, so
  // the user's review (Task 10) reflects the CRM's real current structure.
  const { data: connection } = await serviceClient.from('data_agent_connections')
    .select('ghl_location_id, secret_name').eq('sub_account', subAccount).maybeSingle()
  if (!connection) return json({ error: 'No GHL connection configured for this sub-account yet' })
  const { data: secretRow } = await serviceClient.schema('vault').from('decrypted_secrets')
    .select('decrypted_secret').eq('name', (connection as { secret_name: string }).secret_name).maybeSingle()
  const pit = (secretRow as { decrypted_secret?: string } | null)?.decrypted_secret
  if (!pit) return json({ error: 'Could not read the saved connection token' })
  const ghlConfig = { pit, locationId: (connection as { ghl_location_id: string }).ghl_location_id }

  try {
    await ensureSchemaCacheFresh(serviceClient, subAccount, ghlConfig, { force: false })
  } catch (err) {
    return json({ error: `Could not refresh the CRM schema before analysis: ${err instanceof Error ? err.message : String(err)}` })
  }

  const { data: schemaCache } = await serviceClient.from('data_agent_ghl_schema_cache')
    .select('fields').eq('sub_account', subAccount).eq('object_type', targetObjectType).maybeSingle()
  if (!schemaCache) return json({ error: `No schema cached for target object "${targetObjectType}" — run Test Connection in Settings first` })
  // buildTargetFields bridges the cache's real shape ({id, fieldKey,
  // name} per Task 5's fetchContactCustomFields/fetchCustomObjects) into
  // what classifyColumn actually expects ({key, label, type}) — these
  // are NOT the same shape, and GHL's standard fields (phone/email/etc.)
  // are never cached at all, so casting the raw cache data directly as
  // TargetField[] (as an earlier version of this function did) either
  // silently fails to match any standard field or throws on the first
  // real custom field, since `.label` doesn't exist on the raw shape.
  const cachedFields = ((schemaCache as { fields: CachedGhlField[] } | null)?.fields ?? [])
  const targetFields = buildTargetFields(targetObjectType, cachedFields)

  const { data: profileRows } = sourceSystem
    ? await serviceClient.from('data_agent_source_profiles').select('source_system, pattern, target_field_hint, subtype_hint').eq('source_system', sourceSystem)
    : { data: [] as SourceProfileEntry[] }
  const sourceProfiles = (profileRows ?? []) as SourceProfileEntry[]

  const plan = planColumnMappings(headers, rows, sourceSystem, targetFields, sourceProfiles)
  const status = computeMigrationStatus(plan)

  const { data: migration, error: migrationErr } = await serviceClient.from('data_agent_migrations').insert({
    sub_account: subAccount, created_by: createdBy, target_object_type: targetObjectType,
    source_system: sourceSystem, original_filename: originalFilename, storage_path: storagePath,
    row_count: rows.length, status,
  }).select('id').single()
  if (migrationErr || !migration) return json({ error: `Could not create migration: ${migrationErr?.message}` })
  const migrationId = (migration as { id: string }).id

  const { error: mappingsErr } = await serviceClient.from('data_agent_column_mappings').insert(
    plan.map(p => ({
      migration_id: migrationId, source_column_name: p.source_column_name, sample_values: p.sample_values,
      target_type: p.target_type, target_field_key: p.target_field_key, status: p.status,
      confidence: p.confidence, mapped_by: p.mapped_by, metadata: p.metadata,
    }))
  )
  // A failure here leaves the migration row with zero column_mappings —
  // confirm_data_agent_migration's blocking check (Task 7) counts rows
  // with status in ('uncertain','unmapped'), which is vacuously 0 against
  // an empty set, so an unmarked migration could later pass that gate
  // despite having nothing actually confirmed. Mark it failed explicitly
  // rather than leaving it stuck in 'mapping'/'awaiting_confirmation'
  // looking like a normal in-progress upload.
  if (mappingsErr) {
    await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: mappingsErr.message }).eq('id', migrationId)
    return json({ error: `Could not create column mappings: ${mappingsErr.message}` })
  }

  const { error: recordsErr } = await serviceClient.from('data_agent_migration_records').insert(
    rows.map((row, idx) => ({ migration_id: migrationId, row_number: idx + 1, source_row_data: row }))
  )
  if (recordsErr) {
    await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: recordsErr.message }).eq('id', migrationId)
    return json({ error: `Could not store source rows: ${recordsErr.message}` })
  }

  return json({ migrationId })
})
```

- [ ] **Step 4: Typecheck, manual verification, and commit**

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/`
Expected: PASS (all matching/parser/planner tests green together).

Run: `node_modules/.bin/tsc --noEmit -p supabase/functions/tsconfig.json` (the real check for `parseCsv.ts`/`dataAgentUploadPlanner.ts` — see Task 6's Global Constraint on why the root `tsc --noEmit` below doesn't see these files at all).
Expected: no errors.

Run: `corepack pnpm tsc --noEmit`
Expected: no errors (confirms no frontend regression only).

Against the same sandbox GHL location used in Task 5's verification: upload a small CSV, then confirm (a) `data_agent_migrations`/`data_agent_column_mappings` rows were created with no corresponding write to GHL itself (the sandbox location's contact/object counts are unchanged), and (b) if `data_agent_ghl_schema_cache.fetched_at` for that sub-account is forced older than 24h first (e.g. by backdating it in a test query), this upload refreshes it before classifying — confirm `fetched_at` moves forward.

```bash
git add supabase/functions/_shared/parseCsv.ts supabase/functions/_shared/__tests__/parseCsv.test.ts supabase/functions/_shared/dataAgentUploadPlanner.ts supabase/functions/_shared/__tests__/dataAgentUploadPlanner.test.ts supabase/functions/data-agent-upload/index.ts
git commit -m "feat: add CSV parsing and the Data Agent upload pipeline"
```

---

### Task 9: New Migration modal and Data Agent page shell

**Files:**
- Create: `src/features/data-agent/upload/NewMigrationModal.tsx`
- Create: `src/features/data-agent/upload/__tests__/NewMigrationModal.test.tsx`
- Modify: `src/features/data-agent/DataAgentPage.tsx` (replace Task 2's placeholder)
- Modify: `src/app/Router.tsx` (add the mapping-review route)

**Interfaces:**
- Consumes: edge function `data-agent-upload` (Task 8); table `data_agent_ghl_schema_cache` (for the target-object picker, Task 1/5); storage bucket `data-agent-uploads` (Task 7).
- Produces: component `NewMigrationModal` (`{ subAccount: string; onCreated: (migrationId: string) => void; onClose: () => void }`); route `/data-agent/migrations/:migrationId` (filled in by Task 10).

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/data-agent/upload/__tests__/NewMigrationModal.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadMock = vi.fn()
const invokeMock = vi.fn()
const schemaCacheData = [{ object_type: 'contact' }, { object_type: 'orders' }]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: (...args: unknown[]) => uploadMock(...args) }) },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: vi.fn(() => ({ select: () => ({ eq: () => Promise.resolve({ data: schemaCacheData }) }) })),
  },
}))

import { NewMigrationModal } from '../NewMigrationModal'

describe('NewMigrationModal', () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({ error: null })
    invokeMock.mockReset().mockResolvedValue({ data: { migrationId: 'mig-1' }, error: null })
  })

  it('lists Contacts plus every cached Custom Object as target choices', async () => {
    render(<NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByRole('option', { name: /contacts/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /orders/i })).toBeInTheDocument()
  })

  it('uploads the file to storage then calls data-agent-upload, and reports the new migration id', async () => {
    const onCreated = vi.fn()
    render(<NewMigrationModal subAccount="AM333" onCreated={onCreated} onClose={vi.fn()} />)
    await screen.findByRole('option', { name: /orders/i })
    await userEvent.selectOptions(screen.getByLabelText(/target/i), 'orders')
    const file = new File(['Email\njane@x.com\n'], 'contacts.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText(/csv file/i), file)
    await userEvent.click(screen.getByRole('button', { name: /upload/i }))

    await waitFor(() => expect(uploadMock).toHaveBeenCalled())
    const [path] = uploadMock.mock.calls[0]
    expect(path).toMatch(/^AM333\/.+-contacts\.csv$/)
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('data-agent-upload', expect.objectContaining({
      body: expect.objectContaining({ subAccount: 'AM333', targetObjectType: 'orders', originalFilename: 'contacts.csv' }),
    })))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('mig-1'))
  })

  it('surfaces an upload-function error instead of claiming success', async () => {
    // The edge function returns HTTP 200 with { error } for a business
    // failure, not a thrown error — see data-agent-upload's own comment
    // on why (supabase-js discards a non-2xx response's real body).
    invokeMock.mockResolvedValue({ data: { error: 'No schema cached yet' }, error: null })
    render(<NewMigrationModal subAccount="AM333" onCreated={vi.fn()} onClose={vi.fn()} />)
    await screen.findByRole('option', { name: /orders/i })
    const file = new File(['Email\njane@x.com\n'], 'contacts.csv', { type: 'text/csv' })
    await userEvent.upload(screen.getByLabelText(/csv file/i), file)
    await userEvent.click(screen.getByRole('button', { name: /upload/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No schema cached yet/i)
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/upload/__tests__/NewMigrationModal.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```tsx
// src/features/data-agent/upload/NewMigrationModal.tsx
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  subAccount: string
  onCreated: (migrationId: string) => void
  onClose: () => void
}

export function NewMigrationModal({ subAccount, onCreated, onClose }: Props) {
  const [objectTypes, setObjectTypes] = useState<string[]>([])
  const [target, setTarget] = useState('contact')
  const [sourceSystem, setSourceSystem] = useState<'' | 'salesforce' | 'hubspot'>('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void supabase.from('data_agent_ghl_schema_cache').select('object_type').eq('sub_account', subAccount)
      .then(({ data }) => setObjectTypes((data ?? []).map((r: { object_type: string }) => r.object_type)))
  }, [subAccount])

  async function handleUpload() {
    if (!file) return
    setUploading(true); setError(null)
    const storagePath = `${subAccount}/${crypto.randomUUID()}-${file.name}`
    const { error: uploadErr } = await supabase.storage.from('data-agent-uploads').upload(storagePath, file)
    if (uploadErr) { setUploading(false); setError(uploadErr.message); return }

    const { data, error: fnErr } = await supabase.functions.invoke('data-agent-upload', {
      body: { subAccount, targetObjectType: target, sourceSystem: sourceSystem || null, storagePath, originalFilename: file.name },
    })
    setUploading(false)
    // data-agent-upload returns HTTP 200 for every business outcome (see
    // its own comment) so a real failure shows up as `data.error`, not a
    // thrown `fnErr` — `fnErr` only fires for a genuine network/relay
    // failure, which has no useful `.message` of its own either.
    if (fnErr) { setError('Could not reach the upload service — check your connection and try again.'); return }
    const result = data as { migrationId?: string; error?: string }
    if (!result.migrationId) { setError(result.error ?? 'Upload failed for an unknown reason.'); return }
    onCreated(result.migrationId)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900">New Migration</h2>

        <div>
          <label htmlFor="da-target" className="block text-xs font-medium text-gray-600 mb-1">Target</label>
          <select id="da-target" aria-label="target" value={target} onChange={e => setTarget(e.target.value)} className="input w-full">
            <option value="contact">Contacts</option>
            {objectTypes.filter(t => t !== 'contact').map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="da-source" className="block text-xs font-medium text-gray-600 mb-1">Source system (optional)</label>
          <select id="da-source" value={sourceSystem} onChange={e => setSourceSystem(e.target.value as '' | 'salesforce' | 'hubspot')} className="input w-full">
            <option value="">Not sure / other</option>
            <option value="salesforce">Salesforce</option>
            <option value="hubspot">HubSpot</option>
          </select>
        </div>

        <div>
          <label htmlFor="da-file" className="block text-xs font-medium text-gray-600 mb-1">CSV file</label>
          <input id="da-file" type="file" accept=".csv" aria-label="CSV file" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancel</button>
          <button onClick={() => void handleUpload()} disabled={!file || uploading}
            className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Build the page shell**

```tsx
// src/features/data-agent/DataAgentPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { NewMigrationModal } from './upload/NewMigrationModal'

export function DataAgentPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Data Agent</h1>
        <button onClick={() => setShowNew(true)} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
          New Migration
        </button>
      </div>
      {showNew && user?.sub_account && (
        <NewMigrationModal
          subAccount={user.sub_account}
          onClose={() => setShowNew(false)}
          onCreated={migrationId => navigate(`/data-agent/migrations/${migrationId}`)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Register the mapping-review route**

In `src/app/Router.tsx`, add the lazy import and route (rendered unconditionally behind the same `DataAgentRoute` guard used for `/data-agent`; `MappingReviewPage` itself is built in Task 10 — for now it can be a one-line placeholder re-exported from `DataAgentPage.tsx`'s module so this route compiles, and Task 10 replaces it):

```tsx
const MappingReviewPage = lazy(() =>
  import('@/features/data-agent/mapping-review/MappingReviewPage').then(m => ({ default: m.MappingReviewPage }))
)
```

```tsx
<Route path="data-agent/migrations/:migrationId" element={<DataAgentRoute><MappingReviewPage /></DataAgentRoute>} />
```

This requires `DataAgentRoute` (Task 2) to accept `children` instead of always rendering `DataAgentPage` directly — update it:

```tsx
function DataAgentRoute({ children }: { children?: React.ReactNode }) {
  const { hasAccess } = useDataAgentAccess()
  if (!hasAccess) return <Navigate to="/" replace />
  return <Suspense fallback={<Spinner />}>{children ?? <DataAgentPage />}</Suspense>
}
```

And the `/data-agent` route becomes `<Route path="data-agent" element={<DataAgentRoute />} />` (unchanged) while the new route passes explicit children. Since `MappingReviewPage` doesn't exist until Task 10, create a one-line placeholder now so this task's typecheck and tests pass:

```tsx
// src/features/data-agent/mapping-review/MappingReviewPage.tsx (placeholder — replaced in Task 10)
export function MappingReviewPage() {
  return <div className="text-sm text-gray-500">Loading migration…</div>
}
```

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `corepack pnpm vitest run src/features/data-agent/upload/__tests__/NewMigrationModal.test.tsx`
Expected: PASS (3 tests).

Run: `corepack pnpm tsc --noEmit`
Expected: no errors.

```bash
git add src/features/data-agent/upload/NewMigrationModal.tsx src/features/data-agent/upload/__tests__/NewMigrationModal.test.tsx src/features/data-agent/DataAgentPage.tsx src/features/data-agent/mapping-review/MappingReviewPage.tsx src/app/Router.tsx
git commit -m "feat: add the Data Agent new-migration upload modal"
```

---

### Task 10: Mapping review page — display, manual remap, confirm gate

**Files:**
- Create: `src/features/data-agent/mapping-review/MappingReviewPage.tsx` (replaces Task 9's placeholder)
- Create: `src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx`

**Interfaces:**
- Consumes: tables `data_agent_migrations`, `data_agent_column_mappings`, `data_agent_ghl_schema_cache` (Tasks 1, 7); RPC `confirm_data_agent_migration` (Task 7); hook `useRealtime` (existing, `src/hooks/useRealtime.ts`).
- Produces: component `MappingReviewPage` (reads `:migrationId` from the route).

**Binding invariant for this task:** a column's row is green when `status === 'mapped'`, yellow when `'uncertain'`, red when `'unmapped'` — never derived from `target_type`, per the gate fix in Tasks 7–8. Choosing "Ignore this column" writes `status: 'mapped', target_type: 'ignored', target_field_key: null, mapped_by: 'user', confirmed_by_user: true` — it resolves the column, it does not leave it red.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const migrationRow = { id: 'mig-1', sub_account: 'AM333', target_object_type: 'contact', status: 'mapping', original_filename: 'contacts.csv', row_count: 2 }
let mappingRows: Record<string, unknown>[] = []
// Lets a test inject a write failure — the mock's own .eq() resolution
// reads this, rather than always resolving { error: null }, so a test can
// actually exercise the "surface a remap write error" path.
let mappingUpdateError: { message: string } | null = null
const updateMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'data_agent_migrations') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: migrationRow }) }) }),
          update: (...args: unknown[]) => { updateMock(...args); return { eq: () => Promise.resolve({ error: null }) } },
        }
      }
      if (table === 'data_agent_column_mappings') {
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: mappingRows }) }) }),
          update: (...args: unknown[]) => { updateMock(...args); return { eq: () => Promise.resolve({ error: mappingUpdateError }) } },
        }
      }
      // data_agent_ghl_schema_cache: the component chains two .eq() calls
      // (.eq('sub_account',...).eq('object_type',...)) — this must
      // resolve after the SECOND .eq(), not the first.
      return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ fields: [{ key: 'email', label: 'Email', type: 'standard' }] }] }) }) }) }
    }),
  },
}))

import { MappingReviewPage } from '../MappingReviewPage'

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/data-agent/migrations/${id}`]}>
      <Routes><Route path="/data-agent/migrations/:migrationId" element={<MappingReviewPage />} /></Routes>
    </MemoryRouter>
  )
}

describe('MappingReviewPage', () => {
  beforeEach(() => {
    updateMock.mockReset()
    mappingUpdateError = null
    rpcMock.mockReset().mockResolvedValue({ error: null })
    mappingRows = [
      { id: 'cm-1', source_column_name: 'Email', status: 'mapped', target_field_key: 'email', target_type: 'standard_field', mapped_by: 'rule', metadata: {} },
      { id: 'cm-2', source_column_name: 'Mystery', status: 'unmapped', target_field_key: null, target_type: 'ignored', mapped_by: null, metadata: {} },
    ]
  })

  it('shows green for a mapped column and red for an unmapped one', async () => {
    renderAt('mig-1')
    expect(await screen.findByText('Email')).toBeInTheDocument()
    expect(screen.getByTestId('status-cm-1')).toHaveTextContent(/mapped/i)
    expect(screen.getByTestId('status-cm-2')).toHaveTextContent(/unmapped/i)
  })

  it('disables Confirm & Migrate while any column is still unresolved', async () => {
    renderAt('mig-1')
    await screen.findByText('Mystery')
    expect(screen.getByRole('button', { name: /confirm & migrate/i })).toBeDisabled()
  })

  it('choosing "Ignore this column" resolves it as mapped/ignored, not as still-red', async () => {
    renderAt('mig-1')
    await screen.findByText('Mystery')
    await userEvent.selectOptions(screen.getByLabelText(/map "Mystery" to/i), 'ignore')
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'mapped', target_type: 'ignored', target_field_key: null, mapped_by: 'user', confirmed_by_user: true,
    })))
  })

  it('calls confirm_data_agent_migration when every column is resolved, with a null country code when none is needed', async () => {
    mappingRows = [{ id: 'cm-1', source_column_name: 'Email', status: 'mapped', target_field_key: 'email', target_type: 'standard_field', mapped_by: 'rule', metadata: {} }]
    renderAt('mig-1')
    const confirmBtn = await screen.findByRole('button', { name: /confirm & migrate/i })
    expect(confirmBtn).toBeEnabled()
    await userEvent.click(confirmBtn)
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('confirm_data_agent_migration', { p_migration_id: 'mig-1', p_default_country_code: null }))
  })

  it('shows a default-country-code input when a mapped phone column has absent/mixed country codes, and passes it to the confirm RPC directly (never a separate client-side table update, which RLS would silently no-op)', async () => {
    mappingRows = [{ id: 'cm-1', source_column_name: 'Phone', status: 'mapped', target_field_key: 'phone', target_type: 'standard_field', mapped_by: 'rule', metadata: { country_code_presence: 'mixed' } }]
    renderAt('mig-1')
    const input = await screen.findByLabelText(/default country code/i)
    await userEvent.type(input, '+65')
    await userEvent.click(screen.getByRole('button', { name: /confirm & migrate/i }))
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('confirm_data_agent_migration', { p_migration_id: 'mig-1', p_default_country_code: '+65' }))
    expect(updateMock).not.toHaveBeenCalledWith({ default_country_code: '+65' })
  })

  it('does not pre-select "Ignore this column" for a genuinely unmapped column, even though classifyColumn also sets target_type "ignored" on its own no-match default', async () => {
    mappingRows = [{ id: 'cm-2', source_column_name: 'Mystery', status: 'unmapped', target_field_key: null, target_type: 'ignored', mapped_by: null, metadata: {} }]
    renderAt('mig-1')
    const select = await screen.findByLabelText(/map "Mystery" to/i) as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('surfaces a remap write error instead of silently leaving the column unchanged', async () => {
    mappingRows = [{ id: 'cm-2', source_column_name: 'Mystery', status: 'unmapped', target_field_key: null, target_type: 'ignored', mapped_by: null, metadata: {} }]
    mappingUpdateError = { message: 'row-level security violation' }
    renderAt('mig-1')
    await userEvent.selectOptions(await screen.findByLabelText(/map "Mystery" to/i), 'ignore')
    expect(await screen.findByRole('alert')).toHaveTextContent(/row-level security violation/i)
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx`
Expected: FAIL (placeholder component has none of this).

- [ ] **Step 2: Implement**

```tsx
// src/features/data-agent/mapping-review/MappingReviewPage.tsx
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/hooks/useRealtime'
import type { DataAgentColumnMapping, DataAgentMigration } from '@/types/dataAgent'

interface TargetFieldOption { key: string; label: string; type: 'standard' | 'custom' }

const STATUS_STYLE: Record<DataAgentColumnMapping['status'], string> = {
  mapped: 'bg-green-100 text-green-700',
  uncertain: 'bg-amber-100 text-amber-700',
  unmapped: 'bg-red-100 text-red-700',
}

export function MappingReviewPage() {
  const { migrationId } = useParams<{ migrationId: string }>()
  const [migration, setMigration] = useState<DataAgentMigration | null>(null)
  const [mappings, setMappings] = useState<DataAgentColumnMapping[]>([])
  const [targetFields, setTargetFields] = useState<TargetFieldOption[]>([])
  const [pageError, setPageError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [defaultCountryCode, setDefaultCountryCode] = useState('')

  const loadMappings = useCallback(async () => {
    if (!migrationId) return
    const { data } = await supabase.from('data_agent_column_mappings').select('*').eq('migration_id', migrationId).order('source_column_name')
    setMappings((data ?? []) as DataAgentColumnMapping[])
  }, [migrationId])

  useEffect(() => {
    if (!migrationId) return
    void supabase.from('data_agent_migrations').select('*').eq('id', migrationId).single()
      .then(({ data }) => setMigration(data as DataAgentMigration))
    void loadMappings()
  }, [migrationId, loadMappings])

  useEffect(() => {
    if (!migration?.sub_account || !migration?.target_object_type) return
    void supabase.from('data_agent_ghl_schema_cache').select('fields')
      .eq('sub_account', migration.sub_account).eq('object_type', migration.target_object_type)
      .then(({ data }) => {
        const row = (data as { fields: TargetFieldOption[] }[] | null)?.[0]
        setTargetFields(row?.fields ?? [])
      })
  }, [migration?.sub_account, migration?.target_object_type])

  useRealtime({ table: 'data_agent_column_mappings', filter: migrationId ? `migration_id=eq.${migrationId}` : undefined, onUpdate: () => void loadMappings() })

  async function remap(mapping: DataAgentColumnMapping, choice: string) {
    const update = choice === 'ignore'
      ? { status: 'mapped' as const, target_type: 'ignored' as const, target_field_key: null, mapped_by: 'user' as const, confirmed_by_user: true }
      : (() => {
          const field = targetFields.find(f => f.key === choice)
          return {
            status: 'mapped' as const,
            target_type: (field?.type === 'standard' ? 'standard_field' : 'custom_field') as DataAgentColumnMapping['target_type'],
            target_field_key: choice, mapped_by: 'user' as const, confirmed_by_user: true,
          }
        })()
    const { error } = await supabase.from('data_agent_column_mappings').update(update).eq('id', mapping.id)
    if (error) { setPageError(`Could not update "${mapping.source_column_name}": ${error.message}`); return }
    await loadMappings()
  }

  const needsCountryCode = mappings.some(m => m.status === 'mapped' && (m.metadata.country_code_presence === 'absent' || m.metadata.country_code_presence === 'mixed'))

  async function confirmMigration() {
    if (!migrationId) return
    setConfirming(true); setPageError(null)
    if (needsCountryCode && !defaultCountryCode.trim()) {
      setConfirming(false); setPageError('A default country code is required for at least one phone column.'); return
    }
    // There is no client UPDATE policy on data_agent_migrations (Task 7) —
    // the default country code is passed as an RPC parameter instead of a
    // separate prior write, which would silently no-op under RLS (0 rows
    // matched, no error) rather than actually persisting.
    const { error } = await supabase.rpc('confirm_data_agent_migration', {
      p_migration_id: migrationId, p_default_country_code: needsCountryCode ? defaultCountryCode.trim() : null,
    })
    setConfirming(false)
    if (error) setPageError(error.message)
  }

  const allResolved = mappings.length > 0 && mappings.every(m => m.status === 'mapped')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">{migration?.original_filename}</h1>
        <p className="text-sm text-gray-500">{migration?.row_count} rows → {migration?.target_object_type}</p>
      </div>

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
        {mappings.map(m => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{m.source_column_name}</p>
              {m.reasoning && <p className="text-xs text-gray-400">{m.reasoning}</p>}
            </div>
            <span data-testid={`status-${m.id}`} className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_STYLE[m.status]}`}>
              {m.status}
            </span>
            <select
              aria-label={`Map "${m.source_column_name}" to`}
              // target_type === 'ignored' alone does NOT mean the user
              // chose to ignore this column — classifyColumn's no-match
              // default (Task 6) also sets target_type: 'ignored' on a
              // genuinely unmapped/red column, which still has
              // status !== 'mapped'. Pre-selecting "Ignore this column"
              // for that case would misleadingly suggest it's already
              // resolved. Only a column BOTH mapped AND typed 'ignored'
              // was actually ignored by a human.
              value={m.target_field_key ?? (m.status === 'mapped' && m.target_type === 'ignored' ? 'ignore' : '')}
              onChange={e => void remap(m, e.target.value)}
              className="input text-xs"
            >
              <option value="" disabled>Choose…</option>
              {targetFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              <option value="ignore">Ignore this column</option>
            </select>
          </div>
        ))}
      </div>

      {needsCountryCode && (
        <div>
          <label htmlFor="da-default-country-code" className="block text-xs font-medium text-gray-600 mb-1">
            Default country code (for phone numbers missing one)
          </label>
          <input id="da-default-country-code" value={defaultCountryCode} onChange={e => setDefaultCountryCode(e.target.value)}
            placeholder="+65" className="input w-28" />
        </div>
      )}

      {pageError && <p role="alert" className="text-sm text-red-600">{pageError}</p>}
      <button onClick={() => void confirmMigration()} disabled={!allResolved || confirming}
        className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
        {confirming ? 'Starting…' : 'Confirm & Migrate'}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Run tests, typecheck, and commit**

Run: `corepack pnpm vitest run src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx`
Expected: PASS (7 tests).

Run: `corepack pnpm tsc --noEmit`
Expected: no errors.

```bash
git add src/features/data-agent/mapping-review/MappingReviewPage.tsx src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx
git commit -m "feat: add the Data Agent mapping review page with manual remap and confirm gate"
```

---

### Task 11: Claude-tier mapping module

**Files:**
- Create: `supabase/functions/_shared/dataAgentClaude.ts`
- Create: `supabase/functions/_shared/__tests__/dataAgentClaude.test.ts`

**Interfaces:**
- Consumes: `TargetField` (Task 6).
- Produces: `proposeMappingsWithClaude(columns: UncertainColumn[], targetFields: TargetField[], sourceSystem: 'salesforce'|'hubspot'|null, apiKey: string, fetchImpl?: AnthropicFetch): Promise<ClaudeProposal[]>` — consumed by Task 12. `fetchImpl` defaults to the global `fetch`, injected in tests so no real network call is made (matching this codebase's existing convention of mocking edge-function HTTP calls).

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/__tests__/dataAgentClaude.test.ts
import { describe, it, expect, vi } from 'vitest'
import { proposeMappingsWithClaude } from '../dataAgentClaude'

describe('proposeMappingsWithClaude', () => {
  it('returns no proposals and makes no request for an empty column list', async () => {
    const fetchImpl = vi.fn()
    const result = await proposeMappingsWithClaude([], [], null, 'key', fetchImpl)
    expect(result).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the API key and column context, and parses the JSON proposal array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        { source_column_name: 'Notes', target_field_key: 'custom_notes', confidence: 0.6, reasoning: 'Looks like free-text notes', metadata: {} },
      ]) }],
    }), { status: 200 }))

    const result = await proposeMappingsWithClaude(
      [{ columnName: 'Notes', sampleValues: ['hello'] }],
      [{ key: 'custom_notes', label: 'Notes', type: 'custom' }],
      null, 'test-key', fetchImpl,
    )

    expect(fetchImpl).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
    }))
    expect(result).toEqual([{ source_column_name: 'Notes', target_field_key: 'custom_notes', confidence: 0.6, reasoning: 'Looks like free-text notes', metadata: {} }])
  })

  it('throws a clear error when the Anthropic API responds with a non-2xx status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }))
    await expect(proposeMappingsWithClaude([{ columnName: 'X', sampleValues: [] }], [], null, 'key', fetchImpl))
      .rejects.toThrow(/429/)
  })

  it('allows a proposal with a null target_field_key (Claude declining to guess rather than inventing one)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        { source_column_name: 'X', target_field_key: null, confidence: 0, reasoning: 'No plausible match', metadata: {} },
      ]) }],
    }), { status: 200 }))
    const result = await proposeMappingsWithClaude([{ columnName: 'X', sampleValues: [] }], [], null, 'key', fetchImpl)
    expect(result[0].target_field_key).toBeNull()
  })

  it('throws a clear error when the response text is not valid JSON (LLM output isn\'t guaranteed to follow instructions exactly)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Sure, here is the mapping: not actually JSON' }],
    }), { status: 200 }))
    await expect(proposeMappingsWithClaude([{ columnName: 'X', sampleValues: [] }], [], null, 'key', fetchImpl))
      .rejects.toThrow(/not valid JSON/)
  })

  it('throws a clear error when the response has no text content block at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 }))
    await expect(proposeMappingsWithClaude([{ columnName: 'X', sampleValues: [] }], [], null, 'key', fetchImpl))
      .rejects.toThrow(/no text content/)
  })

  it('fills in a safe "no proposal" entry for any input column the model silently dropped, rather than returning a mismatched array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        { source_column_name: 'Notes', target_field_key: 'custom_notes', confidence: 0.9, reasoning: 'ok', metadata: {} },
      ]) }],
    }), { status: 200 }))
    const result = await proposeMappingsWithClaude(
      [{ columnName: 'Notes', sampleValues: [] }, { columnName: 'Dropped', sampleValues: [] }],
      [], null, 'key', fetchImpl,
    )
    expect(result).toHaveLength(2)
    expect(result.find(r => r.source_column_name === 'Dropped')).toEqual({
      source_column_name: 'Dropped', target_field_key: null, confidence: 0, reasoning: 'No proposal returned for this column', metadata: {},
    })
  })
})
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentClaude.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
// supabase/functions/_shared/dataAgentClaude.ts
// Claude tier (spec §6.3) — only ever called for columns the rules tier
// (Task 6) left unmapped. Every proposal here is treated as yellow/
// uncertain by the caller (Task 12), regardless of confidence — this
// module itself never assigns a status; it only proposes.
import type { TargetField } from './dataAgentMatching.ts'

export interface UncertainColumn { columnName: string; sampleValues: string[] }

export interface ClaudeProposal {
  source_column_name: string
  target_field_key: string | null
  confidence: number
  reasoning: string
  metadata: { subtype?: string; dnd_channel?: string; country_code_presence?: string }
}

export type AnthropicFetch = (url: string, init: RequestInit) => Promise<Response>

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-5-5'

function buildPrompt(columns: UncertainColumn[], targetFields: TargetField[], sourceSystem: 'salesforce' | 'hubspot' | null): string {
  return [
    'You are mapping CSV export columns to a CRM\'s real field schema for a data migration tool.',
    'Accuracy matters more than coverage: if no field is a plausible match, return target_field_key: null rather than guessing.',
    sourceSystem ? `The file was exported from ${sourceSystem}.` : 'The file\'s source system is unknown.',
    '',
    'Target schema fields (map only to one of these keys, or null):',
    JSON.stringify(targetFields.map(f => ({ key: f.key, label: f.label, type: f.type }))),
    '',
    'Columns needing a mapping proposal:',
    JSON.stringify(columns),
    '',
    'Respond with ONLY a JSON array, one entry per column in the same order, each shaped exactly as:',
    '{"source_column_name": string, "target_field_key": string | null, "confidence": number between 0 and 1, "reasoning": short string, "metadata": {"subtype"?: "mobile"|"home"|"work"|"fax"|"other", "dnd_channel"?: "call"|"email"|"sms", "country_code_presence"?: "present"|"absent"|"mixed"}}',
  ].join('\n')
}

export async function proposeMappingsWithClaude(
  columns: UncertainColumn[],
  targetFields: TargetField[],
  sourceSystem: 'salesforce' | 'hubspot' | null,
  apiKey: string,
  fetchImpl: AnthropicFetch = fetch,
): Promise<ClaudeProposal[]> {
  if (columns.length === 0) return []

  const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: buildPrompt(columns, targetFields, sourceSystem) }],
    }),
  })
  if (!res.ok) throw new Error(`Claude mapping request failed: ${res.status} ${await res.text()}`)

  const body = await res.json() as { content: { type: string; text: string }[] }
  const textBlock = body.content?.find(c => c.type === 'text')?.text
  if (!textBlock) throw new Error('Claude mapping response had no text content block')

  let parsed: unknown
  try {
    parsed = JSON.parse(textBlock)
  } catch (err) {
    // A clear, specific error — LLM output isn't guaranteed to strictly
    // follow "respond with ONLY a JSON array" despite the prompt asking
    // for it, and a bare SyntaxError here would give Task 12 (and anyone
    // debugging a production failure) nothing actionable.
    throw new Error(`Claude mapping response was not valid JSON: ${err instanceof Error ? err.message : String(err)} — raw text: ${textBlock.slice(0, 500)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Claude mapping response was not a JSON array — raw text: ${textBlock.slice(0, 500)}`)
  }
  const proposals = parsed as ClaudeProposal[]

  // Guarantee exactly one proposal per input column, regardless of model
  // output quality — accuracy matters more than trusting the model to
  // follow instructions exactly. A column Claude silently dropped,
  // renamed, or duplicated gets a safe "no proposal" entry here rather
  // than a mismatched array silently reaching the caller (Task 12).
  return columns.map(col => {
    const match = proposals.find(p => p.source_column_name === col.columnName)
    return match ?? { source_column_name: col.columnName, target_field_key: null, confidence: 0, reasoning: 'No proposal returned for this column', metadata: {} }
  })
}
```

- [ ] **Step 3: Run the test, typecheck, and commit**

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentClaude.test.ts`
Expected: PASS (7 tests).

Run: `node_modules/.bin/tsc --noEmit -p supabase/functions/tsconfig.json` (the real check for `dataAgentClaude.ts` — see Task 6's Global Constraint).
Expected: no errors.

Run: `corepack pnpm tsc --noEmit`
Expected: no errors (confirms no frontend regression only).

```bash
git add supabase/functions/_shared/dataAgentClaude.ts supabase/functions/_shared/__tests__/dataAgentClaude.test.ts
git commit -m "feat: add the Data Agent Claude-tier mapping module"
```

---

### Task 12: Wire the Claude tier into the upload pipeline

**Files:**
- Create: `supabase/functions/data-agent-upload/planWithClaude.ts`
- Create: `supabase/functions/data-agent-upload/__tests__/planWithClaude.test.ts`
- Modify: `supabase/functions/data-agent-upload/index.ts`
- Modify: `supabase/functions/tsconfig.json`

**Interfaces:**
- Consumes: `proposeMappingsWithClaude` (Task 11).

This task extracts the "run rules tier, then Claude tier on whatever's left" orchestration from Task 8's function body into one small, directly testable pure function, then calls it from the handler. Splitting it out is necessary because the handler itself (`Deno.serve`) isn't unit-testable the way the matching/planner modules are — this keeps the one genuinely new piece of logic (Claude only runs on what rules left `unmapped`, and its result is always `uncertain`, never promoted) covered by a real test rather than only exercised by Task 5-style manual verification.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/data-agent-upload/__tests__/planWithClaude.test.ts
import { describe, it, expect, vi } from 'vitest'
import { planWithClaude } from '../planWithClaude'
import type { PlannedColumnMapping } from '../../_shared/dataAgentUploadPlanner'

describe('planWithClaude', () => {
  it('leaves already-mapped columns untouched and does not call Claude for them', async () => {
    const rulesPlan: PlannedColumnMapping[] = [
      { status: 'mapped', mapped_by: 'rule', target_field_key: 'email', target_type: 'standard_field', confidence: 1, metadata: {}, source_column_name: 'Email', sample_values: ['a@x.com'] },
    ]
    const fetchImpl = vi.fn()
    const result = await planWithClaude(rulesPlan, [], null, 'key', fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual(rulesPlan)
  })

  it('sends only the unmapped columns to Claude, and marks any proposal as uncertain regardless of confidence', async () => {
    const rulesPlan: PlannedColumnMapping[] = [
      { status: 'mapped', mapped_by: 'rule', target_field_key: 'email', target_type: 'standard_field', confidence: 1, metadata: {}, source_column_name: 'Email', sample_values: ['a@x.com'] },
      { status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata: {}, source_column_name: 'Notes', sample_values: ['hi'] },
    ]
    // planWithClaude's only injection point is the same AnthropicFetch
    // fetchImpl that proposeMappingsWithClaude (Task 11) itself takes —
    // this module never replaces proposeMappingsWithClaude wholesale, it
    // calls the real thing, matching this plan's one DI convention used
    // consistently by dataAgentGhlClient.ts and dataAgentClaude.ts.
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        { source_column_name: 'Notes', target_field_key: 'custom_notes', confidence: 0.95, reasoning: 'Free text', metadata: {} },
      ]) }],
    }), { status: 200 }))
    const result = await planWithClaude(rulesPlan, [{ key: 'custom_notes', label: 'Notes', type: 'custom' }], null, 'key', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(sentBody.messages[0].content).toContain('"columnName":"Notes"')
    expect(sentBody.messages[0].content).not.toContain('"columnName":"Email"')

    const notes = result.find(r => r.source_column_name === 'Notes')!
    expect(notes.status).toBe('uncertain')
    expect(notes.mapped_by).toBe('claude')
    expect(notes.target_field_key).toBe('custom_notes')
    expect(notes.confidence).toBe(0.95)
  })

  it('leaves a column unmapped (red) when Claude also declines with target_field_key null', async () => {
    const rulesPlan: PlannedColumnMapping[] = [
      { status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata: {}, source_column_name: 'Weird', sample_values: [] },
    ]
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        { source_column_name: 'Weird', target_field_key: null, confidence: 0, reasoning: 'No match', metadata: {} },
      ]) }],
    }), { status: 200 }))
    const result = await planWithClaude(rulesPlan, [], null, 'key', fetchImpl)
    expect(result[0].status).toBe('unmapped')
    expect(result[0].reasoning).toBe('No match')
  })
})
```

Run: `corepack pnpm vitest run supabase/functions/data-agent-upload/__tests__/planWithClaude.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Create the pure orchestration helper**

```ts
// supabase/functions/data-agent-upload/planWithClaude.ts
import type { PlannedColumnMapping } from '../_shared/dataAgentUploadPlanner.ts'
import { proposeMappingsWithClaude, type AnthropicFetch } from '../_shared/dataAgentClaude.ts'
import type { TargetField, ColumnClassificationMetadata } from '../_shared/dataAgentMatching.ts'

export async function planWithClaude(
  rulesPlan: PlannedColumnMapping[],
  targetFields: TargetField[],
  sourceSystem: 'salesforce' | 'hubspot' | null,
  apiKey: string,
  fetchImpl?: AnthropicFetch,
): Promise<PlannedColumnMapping[]> {
  const unmapped = rulesPlan.filter(p => p.status === 'unmapped')
  if (unmapped.length === 0) return rulesPlan

  const proposals = await proposeMappingsWithClaude(
    unmapped.map(p => ({ columnName: p.source_column_name, sampleValues: p.sample_values })),
    targetFields, sourceSystem, apiKey, fetchImpl,
  )
  const proposalByColumn = new Map(proposals.map(p => [p.source_column_name, p]))

  return rulesPlan.map(p => {
    const proposal = proposalByColumn.get(p.source_column_name)
    if (!proposal || p.status !== 'unmapped') return p
    if (proposal.target_field_key === null) {
      // Claude also declined — stays red, with its reasoning kept for display.
      return { ...p, reasoning: proposal.reasoning }
    }
    const field = targetFields.find(f => f.key === proposal.target_field_key)
    return {
      ...p,
      status: 'uncertain', mapped_by: 'claude',
      target_field_key: proposal.target_field_key,
      target_type: field?.type === 'standard' ? 'standard_field' : 'custom_field',
      confidence: proposal.confidence, reasoning: proposal.reasoning,
      // proposal.metadata's fields are typed as plain `string` in
      // dataAgentClaude.ts (Task 11) since Claude's output is never
      // statically guaranteed, but the prompt there constrains Claude to
      // the same literal values ColumnClassificationMetadata expects.
      metadata: { ...p.metadata, ...proposal.metadata } as ColumnClassificationMetadata,
    }
  })
}
```

Note: `PlannedColumnMapping` (Task 8) needs a `reasoning?: string` field for this to compile — add it there: `export interface PlannedColumnMapping extends ColumnClassification { source_column_name: string; sample_values: string[]; reasoning?: string }`. Update Task 8's interface accordingly if implementing out of order.

- [ ] **Step 3: Run the test**

Run: `corepack pnpm vitest run supabase/functions/data-agent-upload/__tests__/planWithClaude.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Call it from the handler**

In `supabase/functions/data-agent-upload/index.ts`, add the import:

```ts
import { planWithClaude } from './planWithClaude.ts'
```

Replace:

```ts
  const plan = planColumnMappings(headers, rows, sourceSystem, targetFields, sourceProfiles)
  const status = computeMigrationStatus(plan)
```

with:

```ts
  const rulesPlan = planColumnMappings(headers, rows, sourceSystem, targetFields, sourceProfiles)
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const plan = anthropicKey ? await planWithClaude(rulesPlan, targetFields, sourceSystem, anthropicKey) : rulesPlan
  const status = computeMigrationStatus(plan)
```

And in the `data_agent_column_mappings` insert, add `reasoning: p.reasoning ?? null` alongside the existing fields.

(No `ANTHROPIC_API_KEY` secret means the Claude tier is simply skipped and every rules-unmapped column stays red — safe by construction, never silently treated as resolved.)

- [ ] **Step 5: Extend the shared edge-function tsconfig to cover this file**

`planWithClaude.ts` lives at `supabase/functions/data-agent-upload/planWithClaude.ts` — outside the `_shared/**/*.ts` glob Task 6's `supabase/functions/tsconfig.json` covers — but it imports only local relative files (`../_shared/dataAgentUploadPlanner.ts`, `../_shared/dataAgentClaude.ts`, `../_shared/dataAgentMatching.ts`), no `esm.sh` specifiers, so it's equally checkable. Add it explicitly:

```json
// supabase/functions/tsconfig.json — add "data-agent-upload/planWithClaude.ts" to "include"
{
  "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true, "skipLibCheck": true, "allowImportingTsExtensions": true, "isolatedModules": true },
  "include": ["_shared/**/*.ts", "data-agent-upload/planWithClaude.ts"],
  "exclude": ["_shared/__tests__", "_shared/dataAgentSchemaCache.ts", "_shared/accountEmails.ts", "_shared/inviteEmail.ts", "_shared/projectEmails.ts", "_shared/smtp.ts"]
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `node_modules/.bin/tsc --noEmit -p supabase/functions/tsconfig.json`
Expected: no errors.

Run: `corepack pnpm tsc --noEmit`
Expected: no errors (confirms no frontend regression only).

```bash
git add supabase/functions/data-agent-upload/planWithClaude.ts supabase/functions/data-agent-upload/__tests__/planWithClaude.test.ts supabase/functions/data-agent-upload/index.ts supabase/functions/_shared/dataAgentUploadPlanner.ts supabase/functions/tsconfig.json
git commit -m "feat: wire the Claude tier into the Data Agent upload pipeline"
```

---

### Task 13: The prompt feature

**Files:**
- Create: `supabase/functions/_shared/dataAgentPrompt.ts`
- Create: `supabase/functions/_shared/__tests__/dataAgentPrompt.test.ts`
- Create: `supabase/functions/data-agent-prompt/index.ts`
- Modify: `src/features/data-agent/mapping-review/MappingReviewPage.tsx`
- Modify: `src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx`

**Interfaces:**
- Consumes: `AnthropicFetch`, `TargetField` (Tasks 6, 11); table `data_agent_prompts` (Task 7).
- Produces: `resolvePrompt(context, targetFields, userPrompt, apiKey, fetchImpl?): Promise<PromptResult>`. Edge function `data-agent-prompt` (POST `{ migrationId, columnMappingId, promptText }` → `{ responseText: string }`).

Spec §6.5: *"Submission invokes an edge function that gives Claude that column's full context plus the instruction; the response either applies a clear resulting change directly or returns a clarifying reply — both are logged to `data_agent_prompts`, including whether a mapping actually changed."* An applied change here is a user-directed resolution (same as Task 10's manual remap, just issued in prose instead of a dropdown) — it sets `status: 'mapped', mapped_by: 'user'`, never `'claude'`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/__tests__/dataAgentPrompt.test.ts
import { describe, it, expect, vi } from 'vitest'
import { resolvePrompt } from '../dataAgentPrompt'

const FIELDS = [{ key: 'custom_notes', label: 'Notes', type: 'custom' as const }]
const context = { columnName: 'Misc', sampleValues: ['hi'], currentTargetFieldKey: null, currentStatus: 'unmapped' }

function mockResponse(body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(body) }] }), { status: 200 }))
}

describe('resolvePrompt', () => {
  it('returns a clarifying reply with no action for a plain question', async () => {
    const fetchImpl = mockResponse({ responseText: 'This looks like a free-text note field.', action: null })
    const result = await resolvePrompt(context, FIELDS, 'what is this column?', 'key', fetchImpl)
    expect(result).toEqual({ responseText: 'This looks like a free-text note field.', action: null })
  })

  it('applies a clear remap instruction to a field that actually exists', async () => {
    const fetchImpl = mockResponse({ responseText: 'Mapped to Notes.', action: { target_field_key: 'custom_notes' } })
    const result = await resolvePrompt(context, FIELDS, 'map this to custom field Notes', 'key', fetchImpl)
    expect(result.action).toEqual({ target_field_key: 'custom_notes' })
  })

  it('applies an explicit ignore instruction', async () => {
    const fetchImpl = mockResponse({ responseText: 'Ignoring this column.', action: { ignore: true } })
    const result = await resolvePrompt(context, FIELDS, 'ignore this one', 'key', fetchImpl)
    expect(result.action).toEqual({ ignore: true })
  })

  it('discards a hallucinated field key that does not exist in the real schema, never inventing one', async () => {
    const fetchImpl = mockResponse({ responseText: 'Mapped to Phone Number.', action: { target_field_key: 'phone_number_that_does_not_exist' } })
    const result = await resolvePrompt(context, FIELDS, 'map this to the phone field', 'key', fetchImpl)
    expect(result.action).toBeNull()
    expect(result.responseText).toBe('Mapped to Phone Number.')
  })
})
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentPrompt.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement the module**

```ts
// supabase/functions/_shared/dataAgentPrompt.ts
import type { TargetField } from './dataAgentMatching.ts'
import type { AnthropicFetch } from './dataAgentClaude.ts'

export interface PromptContext {
  columnName: string
  sampleValues: string[]
  currentTargetFieldKey: string | null
  currentStatus: string
}

export type PromptAction = { target_field_key: string } | { ignore: true } | null
export interface PromptResult { responseText: string; action: PromptAction }

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-5-5'

function buildPrompt(context: PromptContext, targetFields: TargetField[], userPrompt: string): string {
  return [
    'A user is reviewing one column of a CRM data migration mapping and has typed an instruction or question about it.',
    `Column: "${context.columnName}". Sample values: ${JSON.stringify(context.sampleValues)}.`,
    `Current mapping: ${context.currentTargetFieldKey ?? 'none'} (status: ${context.currentStatus}).`,
    'Target fields available (only ever reference one of these keys, never invent one):',
    JSON.stringify(targetFields.map(f => ({ key: f.key, label: f.label }))),
    `User instruction: "${userPrompt}"`,
    '',
    'Respond with ONLY JSON shaped exactly as:',
    '{"responseText": string, "action": null | {"target_field_key": string} | {"ignore": true}}',
    'Use action: null if this is just a question, or the instruction does not clearly resolve to one specific field or an explicit "ignore this column".',
  ].join('\n')
}

export async function resolvePrompt(
  context: PromptContext,
  targetFields: TargetField[],
  userPrompt: string,
  apiKey: string,
  fetchImpl: AnthropicFetch = fetch,
): Promise<PromptResult> {
  const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: 'user', content: buildPrompt(context, targetFields, userPrompt) }] }),
  })
  if (!res.ok) throw new Error(`Claude prompt request failed: ${res.status} ${await res.text()}`)

  const body = await res.json() as { content: { type: string; text: string }[] }
  const text = body.content.find(c => c.type === 'text')?.text ?? '{"responseText":"","action":null}'
  const parsed = JSON.parse(text) as PromptResult

  if (parsed.action && 'target_field_key' in parsed.action && !targetFields.some(f => f.key === parsed.action!.target_field_key)) {
    return { responseText: parsed.responseText, action: null }
  }
  return parsed
}
```

- [ ] **Step 3: Run the test**

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentPrompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write the edge function**

```ts
// supabase/functions/data-agent-prompt/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolvePrompt } from '../_shared/dataAgentPrompt.ts'
import type { TargetField } from '../_shared/dataAgentMatching.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

// Every business-outcome branch below returns HTTP 200 — see Task 5's
// data-agent-test-connection for why (supabase-js's functions.invoke()
// discards a non-2xx response's real body, always reporting a fixed
// generic message instead).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) return json({ error: 'The prompt feature is not configured on this server' })

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' })

  let body: { migrationId?: unknown; columnMappingId?: unknown; promptText?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }) }
  const migrationId = typeof body.migrationId === 'string' ? body.migrationId : ''
  const columnMappingId = typeof body.columnMappingId === 'string' ? body.columnMappingId : ''
  const promptText = typeof body.promptText === 'string' ? body.promptText.trim() : ''
  if (!migrationId || !columnMappingId || !promptText) return json({ error: 'migrationId, columnMappingId, and promptText are required' })

  const serviceClient = createClient(supabaseUrl, serviceKey)
  const { data: migration } = await serviceClient.from('data_agent_migrations').select('sub_account, target_object_type, status').eq('id', migrationId).single()
  if (!migration) return json({ error: 'Migration not found' })
  const { data: isMember } = await callerClient.rpc('is_data_agent_member', { p_sub_account: (migration as { sub_account: string }).sub_account })
  if (!isMember) return json({ error: 'Not authorized for this migration' })
  // Mirrors the data_agent_column_mappings_update RLS policy's own
  // restriction (migration 20261018000100) — this service-role write
  // bypasses RLS entirely, so the same status gate has to be enforced
  // here explicitly, or a prompt submitted/replayed after the migration
  // moved past manual review could still silently apply a change.
  if (!['mapping', 'awaiting_confirmation'].includes((migration as { status: string }).status)) {
    return json({ error: 'This migration is no longer open for manual changes' })
  }

  // Scoped to migrationId, not just columnMappingId — without this, a
  // caller authorized for migrationId (Sub-Account A) could supply a
  // columnMappingId belonging to an unrelated migration (Sub-Account B)
  // and the service-role client below would read and overwrite B's row
  // with no ownership check at all. Matching on both columns means a
  // cross-tenant mismatch simply finds no row, falling into the existing
  // "Column mapping not found" branch.
  const { data: mapping } = await serviceClient.from('data_agent_column_mappings')
    .select('source_column_name, sample_values, target_field_key, status').eq('id', columnMappingId).eq('migration_id', migrationId).single()
  if (!mapping) return json({ error: 'Column mapping not found' })

  const { data: schemaCache } = await serviceClient.from('data_agent_ghl_schema_cache').select('fields')
    .eq('sub_account', (migration as { sub_account: string }).sub_account)
    .eq('object_type', (migration as { target_object_type: string }).target_object_type).maybeSingle()
  const targetFields = ((schemaCache as { fields: TargetField[] } | null)?.fields ?? [])

  const m = mapping as { source_column_name: string; sample_values: string[]; target_field_key: string | null; status: string }
  const { data: appUser } = await callerClient.from('users').select('id').eq('email', callerAuth.email).single()

  let result
  try {
    result = await resolvePrompt(
      { columnName: m.source_column_name, sampleValues: m.sample_values, currentTargetFieldKey: m.target_field_key, currentStatus: m.status },
      targetFields, promptText, anthropicKey,
    )
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) })
  }

  if (result.action) {
    const update = 'ignore' in result.action
      ? { status: 'mapped', target_type: 'ignored', target_field_key: null, mapped_by: 'user', confirmed_by_user: true }
      : (() => {
          const targetKey = (result.action as { target_field_key: string }).target_field_key
          const field = targetFields.find(f => f.key === targetKey)
          return { status: 'mapped', target_type: field?.type === 'standard' ? 'standard_field' : 'custom_field', target_field_key: targetKey, mapped_by: 'user', confirmed_by_user: true }
        })()
    await serviceClient.from('data_agent_column_mappings').update(update).eq('id', columnMappingId)
  }

  await serviceClient.from('data_agent_prompts').insert({
    migration_id: migrationId, column_mapping_id: columnMappingId, user_id: (appUser as { id: string } | null)?.id ?? null,
    prompt_text: promptText, response_text: result.responseText, action_taken: result.action,
  })

  return json({ responseText: result.responseText })
})
```

- [ ] **Step 5: Add the prompt box to the review page**

Add a test to `src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx` (append to the existing `describe` block, extending the shared mock's `supabase.functions.invoke`):

```tsx
it('submitting a prompt for a column calls data-agent-prompt and shows the response', async () => {
  const invokeMock = vi.fn().mockResolvedValue({ data: { responseText: 'Mapped to Notes.' }, error: null })
  vi.mocked(await import('@/lib/supabase')).supabase.functions = { invoke: invokeMock } as never
  renderAt('mig-1')
  await screen.findByText('Mystery')
  await userEvent.type(screen.getByLabelText(/ask about "Mystery"/i), 'map this to notes')
  await userEvent.click(screen.getByRole('button', { name: /ask$/i }))
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('data-agent-prompt', {
    body: { migrationId: 'mig-1', columnMappingId: 'cm-2', promptText: 'map this to notes' },
  }))
  expect(await screen.findByText('Mapped to Notes.')).toBeInTheDocument()
})
```

In `src/features/data-agent/mapping-review/MappingReviewPage.tsx`, add per-row prompt state and UI. Add below the existing state declarations:

```tsx
  const [promptText, setPromptText] = useState<Record<string, string>>({})
  const [promptReply, setPromptReply] = useState<Record<string, string>>({})
  const [promptBusy, setPromptBusy] = useState<string | null>(null)

  async function askPrompt(mapping: DataAgentColumnMapping) {
    if (!migrationId || !promptText[mapping.id]?.trim()) return
    setPromptBusy(mapping.id)
    const { data, error } = await supabase.functions.invoke('data-agent-prompt', {
      body: { migrationId, columnMappingId: mapping.id, promptText: promptText[mapping.id].trim() },
    })
    setPromptBusy(null)
    // data-agent-prompt returns HTTP 200 for every business outcome (see
    // its own comment) so a real failure shows up as `data.error`, not a
    // thrown `error` — `error` only fires for a genuine network/relay
    // failure, which carries no useful message of its own either.
    if (error) { setPromptReply(prev => ({ ...prev, [mapping.id]: 'Error: could not reach the prompt service.' })); return }
    const result = data as { responseText?: string; error?: string }
    setPromptReply(prev => ({ ...prev, [mapping.id]: result.responseText ?? `Error: ${result.error ?? 'unknown failure'}` }))
    await loadMappings()
  }
```

Inside the row `<div>` for each mapping, after the `<select>`, add:

```tsx
            <div className="flex-1 min-w-[180px]">
              <div className="flex gap-1">
                <input
                  aria-label={`Ask about "${m.source_column_name}"`}
                  value={promptText[m.id] ?? ''}
                  onChange={e => setPromptText(prev => ({ ...prev, [m.id]: e.target.value }))}
                  placeholder="Ask or instruct…"
                  className="input text-xs flex-1"
                />
                <button onClick={() => void askPrompt(m)} disabled={promptBusy === m.id}
                  className="text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 rounded-md px-2">
                  Ask
                </button>
              </div>
              {promptReply[m.id] && <p className="text-xs text-gray-500 mt-1">{promptReply[m.id]}</p>}
            </div>
```

- [ ] **Step 6: Run tests, typecheck, and commit**

Run: `corepack pnpm vitest run src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx supabase/functions/_shared/__tests__/dataAgentPrompt.test.ts`
Expected: PASS (5 + 4 tests).

Run: `node_modules/.bin/tsc --noEmit -p supabase/functions/tsconfig.json` (the real check for `dataAgentPrompt.ts` — see Task 6's Global Constraint).
Expected: no errors.

Run: `corepack pnpm tsc --noEmit`
Expected: no errors (confirms no frontend regression only).

```bash
git add supabase/functions/_shared/dataAgentPrompt.ts supabase/functions/_shared/__tests__/dataAgentPrompt.test.ts supabase/functions/data-agent-prompt/index.ts src/features/data-agent/mapping-review/MappingReviewPage.tsx src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx
git commit -m "feat: add the Data Agent per-column prompt feature"
```

---

### Task 14: Cron-polled worker invocation

**Files:**
- Create: `supabase/migrations/20261018000200_data_agent_cron_worker.sql`

**Interfaces:**
- Produces: `pg_cron` job `data-agent-worker-tick` (every minute) calling `net.http_post` into the `data-agent-worker` edge function (built in Task 15), authenticated by an `x-worker-secret` header — mirrors `dispatch_notification_email()`'s `net.http_post` pattern from `20261006000400_notification_email_dispatch.sql`, combined with `032_seat_limits_currency_pricing.sql`'s `cron.schedule` pattern (no existing migration combines the two; this is the first).

This is a deliberate status-table-driven design (spec §7): a dropped invocation in a chain of self-invoking functions can silently stall a migration with nothing to notice and resume it, whereas a cron tick simply tries again next minute regardless of what the last tick did. The up-to-a-minute latency this costs is irrelevant for a data migration tool.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 20261018000200: Data Agent — cron-polled worker invocation
-- (spec §7). One-time manual setup: a Vault secret named
-- "data_agent_worker_secret" must be created with the same value as the
-- data-agent-worker edge function's DATA_AGENT_WORKER_SECRET environment
-- secret (mirrors 20261006000400_notification_email_dispatch.sql's setup).

create or replace function public.trigger_data_agent_worker()
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'data_agent_worker_secret';
  if v_secret is null then
    raise warning 'data_agent_worker_secret not set in Vault; Data Agent worker tick skipped';
    return;
  end if;

  perform net.http_post(
    url                  := 'https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/data-agent-worker',
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    timeout_milliseconds := 30000
  );
exception when others then
  raise warning 'Data Agent worker tick dispatch failed: %', sqlerrm;
end;
$$;
revoke execute on function public.trigger_data_agent_worker() from public, anon, authenticated;

select cron.unschedule('data-agent-worker-tick') from cron.job where jobname = 'data-agent-worker-tick';
select cron.schedule('data-agent-worker-tick', '* * * * *', $$ select public.trigger_data_agent_worker(); $$);
```

- [ ] **Step 2: Verify live via the Supabase Management API**

After deploying, and after creating the `data_agent_worker_secret` Vault entry and the edge function's `DATA_AGENT_WORKER_SECRET` secret (Task 15 deploys the function itself):

```sql
select jobname, schedule, active from cron.job where jobname = 'data-agent-worker-tick'; -- expect schedule '* * * * *', active true
select proname from pg_proc where proname = 'trigger_data_agent_worker';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261018000200_data_agent_cron_worker.sql
git commit -m "feat: add cron-polled invocation for the Data Agent worker"
```

---

### Task 15: Write pipeline — the worker's `migrating` phase

**Files:**
- Modify: `supabase/functions/_shared/dataAgentGhlClient.ts` (add `searchContactByEmail`)
- Create: `supabase/functions/_shared/dataAgentWriter.ts`
- Create: `supabase/functions/_shared/__tests__/dataAgentWriter.test.ts`
- Create: `supabase/migrations/20261018000300_data_agent_worker_claiming.sql`
- Create: `supabase/functions/data-agent-worker/index.ts`

**Interfaces:**
- Consumes: `GhlClientConfig`, `GhlRateLimitError`, `upsertContact`, `searchObjectRecord`, `createObjectRecord`, `updateObjectRecord` (Task 5); tables `data_agent_migrations`, `data_agent_connections`, `data_agent_column_mappings`, `data_agent_migration_records` (Tasks 1, 7).
- Produces: `buildGhlFields(sourceRow, mappings, defaultCountryCode): BuiltGhlFields`, `getFieldValue(sourceRow, mappings, targetFieldKey): string | null`, `isBlankBuiltFields(built): boolean`, `writeRecordBatch(rows: BatchRow[], writer: GhlRecordWriter): Promise<BatchWriteResult[]>` — consumed again by Tasks 17–18. `data_agent_migration_records.claimed_at` column — consumed again by Task 17's undo logic if it needs to avoid racing a live worker tick. Edge function `data-agent-worker` (unauthenticated-by-JWT, authenticated instead by `x-worker-secret` header from Task 14's cron trigger).

- [ ] **Step 1: Add the contact-search helper to the GHL client**

GHL's contact upsert overwrites atomically but returns no "previous value" — to capture `pre_replace_snapshot` before an overwrite, the current record must be fetched first. Append to `supabase/functions/_shared/dataAgentGhlClient.ts`:

```ts
export async function searchContactByEmail(config: GhlClientConfig, email: string): Promise<{ id: string; fields: Record<string, unknown> } | null> {
  const res = await ghlFetch(config, `/contacts/?locationId=${config.locationId}&query=${encodeURIComponent(email)}`)
  await assertOk(res, 'GHL contact search')
  const body = await res.json() as { contacts?: { id: string }[] }
  const first = body.contacts?.[0]
  if (!first) return null
  const detail = await getContact(config, first.id)
  return { id: first.id, fields: detail.contact }
}
```

This endpoint shape carries the same "verify against a real sandbox location" caveat as Task 5's Custom Objects endpoints — fix it during that task's Step 4 manual verification if the real response differs.

- [ ] **Step 2: Write the failing test for the pure field-building helpers**

```ts
// supabase/functions/_shared/__tests__/dataAgentWriter.test.ts (part 1 of 2 — field building)
import { describe, it, expect } from 'vitest'
import { buildGhlFields, getFieldValue, applyDefaultCountryCode, isBlankBuiltFields, type ConfirmedMapping } from '../dataAgentWriter'

const MAPPINGS: ConfirmedMapping[] = [
  { source_column_name: 'Email', target_type: 'standard_field', target_field_key: 'email', metadata: {} },
  { source_column_name: 'Phone', target_type: 'standard_field', target_field_key: 'phone', metadata: { country_code_presence: 'mixed' } },
  { source_column_name: 'Notes', target_type: 'custom_field', target_field_key: 'custom_notes', metadata: {} },
  { source_column_name: 'Email Opt-Out', target_type: 'tag', target_field_key: 'dnd_email', metadata: { dnd_channel: 'email' } },
  { source_column_name: 'Middle Name', target_type: 'ignored', target_field_key: null, metadata: {} },
]

describe('applyDefaultCountryCode', () => {
  it('leaves a value with a leading + untouched', () => {
    expect(applyDefaultCountryCode('+14155551234', '+65')).toBe('+14155551234')
  })
  it('prepends the default when missing, stripping one leading zero', () => {
    expect(applyDefaultCountryCode('091234567', '+65')).toBe('+6591234567')
  })
  it('returns the raw value unchanged when no default is configured', () => {
    expect(applyDefaultCountryCode('91234567', null)).toBe('91234567')
  })
  it('REVIEW FINDING: strips a leading zero correctly even when the raw value has leading whitespace', () => {
    expect(applyDefaultCountryCode(' 091234567', '+65')).toBe('+6591234567')
  })
})

describe('buildGhlFields', () => {
  const row = { Email: 'jane@x.com', Phone: '91234567', Notes: 'VIP client', 'Email Opt-Out': 'yes', 'Middle Name': 'Q' }

  it('places standard fields, custom fields, and tags into their own buckets', () => {
    const built = buildGhlFields(row, MAPPINGS, '+65')
    expect(built.standardFields).toEqual({ email: 'jane@x.com', phone: '+6591234567' })
    expect(built.customFields).toEqual([{ id: 'custom_notes', value: 'VIP client' }])
    expect(built.tags).toEqual(['dnd_email'])
  })

  it('skips an ignored column entirely', () => {
    const built = buildGhlFields(row, MAPPINGS, '+65')
    expect(JSON.stringify(built)).not.toContain('Q')
  })

  it('skips a blank value rather than writing an empty string', () => {
    const built = buildGhlFields({ ...row, Notes: '' }, MAPPINGS, '+65')
    expect(built.customFields).toEqual([])
  })

  it('REVIEW FINDING: treats a whitespace-only value as blank too, consistent with getFieldValue', () => {
    const built = buildGhlFields({ ...row, Notes: '   ' }, MAPPINGS, '+65')
    expect(built.customFields).toEqual([])
  })

  it('does not throw for a row missing one of the mapped columns entirely', () => {
    const sparse = { Email: 'jane@x.com' }
    expect(() => buildGhlFields(sparse, MAPPINGS, '+65')).not.toThrow()
  })

  it('REVIEW FINDING: does not apply a DND/opt-out tag when the column\'s own value reads as falsy (common CSV boolean-export convention)', () => {
    for (const falsy of ['no', 'false', '0', 'N', 'Off']) {
      const built = buildGhlFields({ ...row, 'Email Opt-Out': falsy }, MAPPINGS, '+65')
      expect(built.tags).toEqual([])
    }
  })
})

describe('getFieldValue', () => {
  it('resolves a target field key back to its source column value', () => {
    expect(getFieldValue({ Email: 'jane@x.com' }, MAPPINGS, 'email')).toBe('jane@x.com')
  })
  it('returns null when the value is blank', () => {
    expect(getFieldValue({ Email: '' }, MAPPINGS, 'email')).toBeNull()
  })
  it('returns null when no mapping targets that field key', () => {
    expect(getFieldValue({ Email: 'jane@x.com' }, MAPPINGS, 'nonexistent')).toBeNull()
  })
})

describe('isBlankBuiltFields', () => {
  it('REVIEW FINDING: is true when every bucket is empty, so a fully-blank row can be skipped rather than written as an empty GHL record', () => {
    expect(isBlankBuiltFields({ standardFields: {}, customFields: [], tags: [] })).toBe(true)
  })
  it('is false if any bucket has content', () => {
    expect(isBlankBuiltFields({ standardFields: { email: 'a@x.com' }, customFields: [], tags: [] })).toBe(false)
    expect(isBlankBuiltFields({ standardFields: {}, customFields: [{ id: 'x', value: 'y' }], tags: [] })).toBe(false)
    expect(isBlankBuiltFields({ standardFields: {}, customFields: [], tags: ['dnd_email'] })).toBe(false)
  })
})
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentWriter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure field-building helpers**

```ts
// supabase/functions/_shared/dataAgentWriter.ts (part 1 of 2 — field building)
export interface ConfirmedMapping {
  source_column_name: string
  target_type: 'standard_field' | 'custom_field' | 'tag' | 'ignored'
  target_field_key: string | null
  metadata: { country_code_presence?: 'present' | 'absent' | 'mixed'; subtype?: string; dnd_channel?: string }
}

export interface BuiltGhlFields {
  standardFields: Record<string, string>
  customFields: { id: string; value: string }[]
  tags: string[]
}

export function applyDefaultCountryCode(value: string, defaultCountryCode: string | null): string {
  // Check and strip against the TRIMMED value — a value with leading
  // whitespace (" 091234567") must still have its leading zero detected
  // and stripped; checking .startsWith('+') on the trimmed value but then
  // stripping zeros from the untrimmed original (the review-flagged bug)
  // silently produced a malformed "+65 091234567".
  const trimmed = value.trim()
  if (!trimmed || !defaultCountryCode || trimmed.startsWith('+')) return value
  return `${defaultCountryCode}${trimmed.replace(/^0+/, '')}`
}

const PHONE_SUBTYPES = new Set(['mobile', 'home', 'work', 'fax'])
// Common CSV boolean-export conventions for a DND/opt-out column whose
// mere presence would otherwise always apply the tag regardless of what
// the cell actually says — getting this backwards has real compliance
// consequences, so a recognizably-falsy value must not apply the tag.
const FALSY_TAG_VALUES = new Set(['no', 'false', '0', 'n', 'off'])

export function buildGhlFields(sourceRow: Record<string, string>, mappings: ConfirmedMapping[], defaultCountryCode: string | null): BuiltGhlFields {
  const standardFields: Record<string, string> = {}
  const customFields: { id: string; value: string }[] = []
  const tags: string[] = []

  for (const m of mappings) {
    if (m.target_type === 'ignored' || !m.target_field_key) continue
    const raw = sourceRow[m.source_column_name] ?? ''
    // Blank-check on the trimmed value (consistent with getFieldValue's
    // own check below) without permanently trimming raw — a whitespace-
    // only cell is blank, but a cell with meaningful leading/trailing
    // whitespace around real content keeps that content as written.
    if (raw.trim() === '') continue

    if (m.target_type === 'tag') {
      if (!FALSY_TAG_VALUES.has(raw.trim().toLowerCase())) tags.push(m.target_field_key)
      continue
    }

    const isPhoneLike = m.target_field_key === 'phone' || (m.metadata.subtype && PHONE_SUBTYPES.has(m.metadata.subtype))
    const value = isPhoneLike ? applyDefaultCountryCode(raw, defaultCountryCode) : raw

    if (m.target_type === 'standard_field') standardFields[m.target_field_key] = value
    else customFields.push({ id: m.target_field_key, value })
  }

  return { standardFields, customFields, tags }
}

export function getFieldValue(sourceRow: Record<string, string>, mappings: ConfirmedMapping[], targetFieldKey: string): string | null {
  const mapping = mappings.find(m => m.target_field_key === targetFieldKey)
  if (!mapping) return null
  const value = sourceRow[mapping.source_column_name]
  return value && value.trim().length > 0 ? value : null
}

// A row where every mapped column came back blank would otherwise still
// reach writer.create()/replace() as an essentially-empty GHL record —
// for a custom object (no upsert validation) this silently creates a
// junk record with no signal anything was wrong. The worker checks this
// before calling writeRecordBatch and marks such rows 'skipped' instead
// (a write_status the schema already allows for exactly this case).
export function isBlankBuiltFields(built: BuiltGhlFields): boolean {
  return Object.keys(built.standardFields).length === 0 && built.customFields.length === 0 && built.tags.length === 0
}
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentWriter.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 4: Write the failing test for batch writing (Review Focus #2 and #3)**

Append to the same test file:

```ts
// supabase/functions/_shared/__tests__/dataAgentWriter.test.ts (part 2 of 2 — batch writing)
import { writeRecordBatch, type GhlRecordWriter, type BatchRow } from '../dataAgentWriter'
import { GhlRateLimitError } from '../dataAgentGhlClient'

function createStatefulWriter() {
  const store = new Map<string, { id: string; fields: Record<string, unknown> }>()
  let nextId = 1
  const writer: GhlRecordWriter = {
    async findExisting(matchValue) {
      const existing = store.get(matchValue)
      return existing ? { id: existing.id, currentFields: existing.fields } : null
    },
    async create(fields) {
      const id = `c${nextId++}`
      store.set(fields.email as string, { id, fields })
      return { id }
    },
    async replace(id, fields) {
      const key = [...store.entries()].find(([, v]) => v.id === id)?.[0]
      if (key) store.set(key, { id, fields })
    },
  }
  return { writer, store }
}

describe('writeRecordBatch', () => {
  it('creates a record with no prior match and records a null snapshot', async () => {
    const { writer } = createStatefulWriter()
    const rows: BatchRow[] = [{ recordId: 'r1', matchValue: 'new@x.com', fields: { email: 'new@x.com' } }]
    const [result] = await writeRecordBatch(rows, writer)
    expect(result).toMatchObject({ writeStatus: 'created', preReplaceSnapshot: null })
  })

  it('REVIEW FOCUS #3: captures each duplicate row\'s snapshot from the state right before THAT row\'s own write, not the original pre-upload state', async () => {
    const { writer } = createStatefulWriter()
    await writer.create({ email: 'dup@x.com', name: 'Original' }) // pre-existing, before this migration

    const rows: BatchRow[] = [
      { recordId: 'r1', matchValue: 'dup@x.com', fields: { email: 'dup@x.com', name: 'From Row 1' } },
      { recordId: 'r2', matchValue: 'dup@x.com', fields: { email: 'dup@x.com', name: 'From Row 2' } },
    ]
    const results = await writeRecordBatch(rows, writer)

    expect(results[0]).toMatchObject({ writeStatus: 'replaced', preReplaceSnapshot: { email: 'dup@x.com', name: 'Original' } })
    // Row 2's snapshot must reflect row 1's write — undoing row 2 alone
    // must not resurrect "Original", which row 1 already legitimately overwrote.
    expect(results[1]).toMatchObject({ writeStatus: 'replaced', preReplaceSnapshot: { email: 'dup@x.com', name: 'From Row 1' } })
  })

  it('REVIEW FOCUS #2: marks a genuine validation error as failed, leaves a 429 pending for retry, and lets other rows continue regardless', async () => {
    const writer: GhlRecordWriter = {
      async findExisting() { return null },
      async create(fields) {
        if (fields.email === 'bad@x.com') throw new Error('GHL contact upsert failed: 422 invalid email')
        if (fields.email === 'limited@x.com') throw new GhlRateLimitError('rate limited')
        return { id: 'ok-1' }
      },
      async replace() {},
    }
    const rows: BatchRow[] = [
      { recordId: 'r1', matchValue: null, fields: { email: 'bad@x.com' } },
      { recordId: 'r2', matchValue: null, fields: { email: 'limited@x.com' } },
      { recordId: 'r3', matchValue: null, fields: { email: 'good@x.com' } },
    ]
    const results = await writeRecordBatch(rows, writer)

    expect(results[0]).toMatchObject({ writeStatus: 'failed' })
    expect(results[0].errorMessage).toMatch(/422/)
    expect(results[1]).toMatchObject({ writeStatus: 'pending' }) // left for retry, never "failed"
    expect(results[2]).toMatchObject({ writeStatus: 'created' }) // row 3 unaffected by rows 1-2
  })
})
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentWriter.test.ts`
Expected: FAIL (`writeRecordBatch` not defined).

- [ ] **Step 5: Implement batch writing**

Append to `supabase/functions/_shared/dataAgentWriter.ts`:

```ts
// supabase/functions/_shared/dataAgentWriter.ts (part 2 of 2 — batch writing)
import { GhlRateLimitError } from './dataAgentGhlClient.ts'

export interface GhlRecordWriter {
  findExisting(matchValue: string): Promise<{ id: string; currentFields: Record<string, unknown> } | null>
  create(fields: Record<string, unknown>): Promise<{ id: string }>
  replace(id: string, fields: Record<string, unknown>): Promise<void>
}

export interface BatchRow {
  recordId: string
  matchValue: string | null
  fields: Record<string, unknown>
}

export interface BatchWriteResult {
  recordId: string
  writeStatus: 'created' | 'replaced' | 'failed' | 'skipped' | 'pending'
  ghlRecordId: string | null
  preReplaceSnapshot: Record<string, unknown> | null
  errorMessage: string | null
}

// Sequential, not parallel — the duplicate-row case (Review Focus #3)
// depends on each row seeing the previous row's write already applied.
export async function writeRecordBatch(rows: BatchRow[], writer: GhlRecordWriter): Promise<BatchWriteResult[]> {
  const results: BatchWriteResult[] = []
  for (const row of rows) {
    try {
      const existing = row.matchValue ? await writer.findExisting(row.matchValue) : null
      if (existing) {
        await writer.replace(existing.id, row.fields)
        results.push({ recordId: row.recordId, writeStatus: 'replaced', ghlRecordId: existing.id, preReplaceSnapshot: existing.currentFields, errorMessage: null })
      } else {
        const created = await writer.create(row.fields)
        results.push({ recordId: row.recordId, writeStatus: 'created', ghlRecordId: created.id, preReplaceSnapshot: null, errorMessage: null })
      }
    } catch (err) {
      if (err instanceof GhlRateLimitError) {
        // Left pending, not failed — retried on a later worker tick (spec §7.4).
        results.push({ recordId: row.recordId, writeStatus: 'pending', ghlRecordId: null, preReplaceSnapshot: null, errorMessage: err.message })
        continue
      }
      // A genuine error — isolated to this row; the loop continues regardless.
      results.push({ recordId: row.recordId, writeStatus: 'failed', ghlRecordId: null, preReplaceSnapshot: null, errorMessage: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}
```

- [ ] **Step 6: Run the full test file**

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentWriter.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 7: Add a claim column so overlapping worker ticks can't double-process the same rows**

Task 14's cron fires every minute via a fire-and-forget `net.http_post` — it never waits for the previous tick's HTTP response. If one batch of GHL writes takes longer than 60 seconds, the next tick invokes this same worker again while the first is still running, and without a claim, both would independently `SELECT` and process the identical batch of `pending` rows: for a custom object (no upsert semantics, just a plain `POST`), this creates real duplicate GHL records, not just a theoretical race (confirmed in Task 15's review).

```sql
-- Migration 20261018000300: Data Agent — claim pending migration_records
-- before writing them to GHL, so two overlapping worker ticks can't both
-- pick up and process the same batch (see Task 15's review for why this
-- is a real, non-contrived risk, not just a theoretical one).
alter table public.data_agent_migration_records add column claimed_at timestamptz;
create index data_agent_migration_records_claim_idx on public.data_agent_migration_records (migration_id, write_status, claimed_at);
```

```bash
git add supabase/migrations/20261018000300_data_agent_worker_claiming.sql
git commit -m "feat: add a claim column so the Data Agent worker can't double-process rows across overlapping ticks"
```

- [ ] **Step 8: Write the worker edge function's `migrating`-phase handler**

```ts
// supabase/functions/data-agent-worker/index.ts
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  upsertContact, searchContactByEmail, searchObjectRecord, createObjectRecord, updateObjectRecord,
  type GhlClientConfig,
} from '../_shared/dataAgentGhlClient.ts'
import { buildGhlFields, getFieldValue, isBlankBuiltFields, writeRecordBatch, type ConfirmedMapping, type GhlRecordWriter, type BatchRow } from '../_shared/dataAgentWriter.ts'

const BATCH_SIZE = 25
// A worker tick that crashed or ran unusually long shouldn't permanently
// strand its claimed rows — after this long with no result written back,
// another tick is allowed to reclaim and retry them.
const STALE_CLAIM_MS = 2 * 60_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const secret = req.headers.get('x-worker-secret')
  const expected = Deno.env.get('DATA_AGENT_WORKER_SECRET')
  if (!expected || secret !== expected) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const serviceClient = createClient(supabaseUrl, serviceKey)

  const { data: migrating, error: migratingErr } = await serviceClient.from('data_agent_migrations').select('*').eq('status', 'migrating').limit(5)
  if (migratingErr) {
    console.error('Data Agent worker: failed to load migrating migrations:', migratingErr)
    return json({ error: 'Failed to load migrations' }, 500)
  }
  for (const migration of (migrating ?? []) as MigratingRow[]) {
    await processMigratingMigration(serviceClient, migration)
  }

  return json({ ok: true, processed: (migrating ?? []).length })
})

interface MigratingRow { id: string; sub_account: string; target_object_type: string; match_key_column: string | null; default_country_code: string | null }

async function loadGhlConfig(serviceClient: SupabaseClient, subAccount: string): Promise<GhlClientConfig | null> {
  const { data: connection, error: connErr } = await serviceClient.from('data_agent_connections').select('ghl_location_id, secret_name').eq('sub_account', subAccount).maybeSingle()
  if (connErr) { console.error(`Data Agent worker: failed to load connection for ${subAccount}:`, connErr); return null }
  if (!connection) return null
  const { data: secretRow, error: secretErr } = await serviceClient.schema('vault').from('decrypted_secrets').select('decrypted_secret')
    .eq('name', (connection as { secret_name: string }).secret_name).maybeSingle()
  if (secretErr) { console.error(`Data Agent worker: failed to load Vault secret for ${subAccount}:`, secretErr); return null }
  const pit = (secretRow as { decrypted_secret?: string } | null)?.decrypted_secret
  if (!pit) return null
  return { pit, locationId: (connection as { ghl_location_id: string }).ghl_location_id }
}

function buildWriter(isContact: boolean, config: GhlClientConfig, objectKey: string, matchKeyColumn: string | null): GhlRecordWriter {
  if (isContact) {
    return {
      async findExisting(matchValue) {
        const found = await searchContactByEmail(config, matchValue)
        return found ? { id: found.id, currentFields: found.fields } : null
      },
      async create(fields) {
        const result = await upsertContact(config, { locationId: config.locationId, ...fields } as never)
        return { id: result.contact.id }
      },
      async replace(_id, fields) { await upsertContact(config, { locationId: config.locationId, ...fields } as never) },
    }
  }
  return {
    async findExisting(matchValue) {
      const rec = await searchObjectRecord(config, objectKey, matchKeyColumn!, matchValue)
      return rec ? { id: rec.id, currentFields: rec.properties } : null
    },
    async create(fields) { return await createObjectRecord(config, objectKey, fields) },
    async replace(id, fields) { await updateObjectRecord(config, objectKey, id, fields) },
  }
}

async function processMigratingMigration(serviceClient: SupabaseClient, migration: MigratingRow) {
  const config = await loadGhlConfig(serviceClient, migration.sub_account)
  if (!config) {
    const { error } = await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: 'No usable GHL connection' }).eq('id', migration.id)
    if (error) console.error(`Data Agent worker: failed to mark migration ${migration.id} as failed:`, error)
    return
  }

  const { data: mappingRows, error: mappingErr } = await serviceClient.from('data_agent_column_mappings')
    .select('source_column_name, target_type, target_field_key, metadata').eq('migration_id', migration.id)
  if (mappingErr) { console.error(`Data Agent worker: failed to load column mappings for migration ${migration.id}:`, mappingErr); return }
  const mappings = (mappingRows ?? []) as ConfirmedMapping[]

  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: candidateRows, error: candidateErr } = await serviceClient.from('data_agent_migration_records')
    .select('id').eq('migration_id', migration.id).eq('write_status', 'pending')
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
    .order('row_number').limit(BATCH_SIZE)
  if (candidateErr) { console.error(`Data Agent worker: failed to list pending records for migration ${migration.id}:`, candidateErr); return }
  const candidateIds = (candidateRows ?? []).map(r => (r as { id: string }).id)

  if (candidateIds.length === 0) {
    // Checking `error` here matters: `count ?? 0` would otherwise treat a
    // failed count query the same as "genuinely zero pending rows left"
    // and wrongly transition this migration to 'verifying' — stranding
    // any rows that are still legitimately pending, since the worker
    // only ever polls migrations with status = 'migrating'.
    const { count, error: countErr } = await serviceClient.from('data_agent_migration_records').select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id).eq('write_status', 'pending')
    if (countErr) { console.error(`Data Agent worker: failed to check remaining pending count for migration ${migration.id}:`, countErr); return }
    if ((count ?? 0) === 0) {
      const { error } = await serviceClient.from('data_agent_migrations').update({ status: 'verifying' }).eq('id', migration.id)
      if (error) console.error(`Data Agent worker: failed to transition migration ${migration.id} to verifying:`, error)
    }
    return
  }

  // Atomic claim: the WHERE clause re-checks write_status/claimed_at in
  // the SAME statement, so a row another tick already claimed between
  // our SELECT above and this UPDATE simply won't match here and won't
  // come back from .select() — no double-processing, no extra locking
  // primitive needed.
  const { data: claimedRows, error: claimErr } = await serviceClient.from('data_agent_migration_records')
    .update({ claimed_at: new Date().toISOString() })
    .in('id', candidateIds).eq('write_status', 'pending')
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
    .select('id, source_row_data')
  if (claimErr) { console.error(`Data Agent worker: failed to claim records for migration ${migration.id}:`, claimErr); return }
  const pending = (claimedRows ?? []) as { id: string; source_row_data: Record<string, string> }[]
  if (pending.length === 0) return // everything was claimed by a concurrent tick between our select and update

  const isContact = migration.target_object_type === 'contact'
  const writer = buildWriter(isContact, config, migration.target_object_type, migration.match_key_column)

  const builtRows = pending.map(r => ({ record: r, built: buildGhlFields(r.source_row_data, mappings, migration.default_country_code) }))

  // A row where every mapped column came back blank would otherwise still
  // be create()'d/replace()'d as an essentially-empty GHL record — mark
  // it skipped instead of writing it at all.
  const blankIds = builtRows.filter(b => isBlankBuiltFields(b.built)).map(b => b.record.id)
  if (blankIds.length > 0) {
    const { error } = await serviceClient.from('data_agent_migration_records')
      .update({ write_status: 'skipped', written_at: new Date().toISOString(), claimed_at: null }).in('id', blankIds)
    if (error) console.error(`Data Agent worker: failed to mark blank records skipped for migration ${migration.id}:`, error)
  }

  const rows: BatchRow[] = builtRows.filter(b => !isBlankBuiltFields(b.built)).map(({ record: r, built }) => {
    const fields = isContact
      ? { ...built.standardFields, customFields: built.customFields, tags: built.tags }
      : { ...built.standardFields, ...Object.fromEntries(built.customFields.map(c => [c.id, c.value])) }
    const matchValue = isContact
      ? (built.standardFields.email ?? built.standardFields.phone ?? null)
      : getFieldValue(r.source_row_data, mappings, migration.match_key_column ?? '')
    return { recordId: r.id, matchValue, fields }
  })

  const results = await writeRecordBatch(rows, writer)
  for (const result of results) {
    if (result.writeStatus === 'pending') {
      // 429 — release the claim so the very next tick can retry
      // immediately rather than waiting out the stale-claim window.
      const { error } = await serviceClient.from('data_agent_migration_records').update({ claimed_at: null }).eq('id', result.recordId)
      if (error) console.error(`Data Agent worker: failed to release claim on record ${result.recordId}:`, error)
      continue
    }
    const { error } = await serviceClient.from('data_agent_migration_records').update({
      write_status: result.writeStatus, ghl_record_id: result.ghlRecordId,
      pre_replace_snapshot: result.preReplaceSnapshot, error_message: result.errorMessage,
      written_at: result.writeStatus === 'failed' ? null : new Date().toISOString(),
      claimed_at: null,
    }).eq('id', result.recordId)
    if (error) {
      // This DB write failing right after a successful GHL write is a
      // genuine dual-write risk this plan accepts without a full outbox
      // pattern (out of scope for this task) — the row stays claimed
      // until the stale window expires, then gets retried and MAY create
      // a duplicate GHL record for a custom object (contacts self-heal
      // via GHL's upsert-by-email, per Task 5). Logging loudly here is
      // the mitigation: it turns a silent failure into an operationally
      // visible one instead of pretending this write-back can't fail.
      console.error(`Data Agent worker: CRITICAL — GHL write for record ${result.recordId} succeeded (${result.writeStatus}, ghl id ${result.ghlRecordId}) but writing that result back to the database failed — this row will be retried after the stale-claim window and may create a duplicate GHL record:`, error)
    }
  }
}
```

- [ ] **Step 9: Typecheck and commit**

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentWriter.test.ts`
Expected: PASS (18 tests).

Run: `node_modules/.bin/tsc --noEmit -p supabase/functions/tsconfig.json` (the real check for `dataAgentGhlClient.ts`/`dataAgentWriter.ts` — see Task 6's Global Constraint).
Expected: no errors.

Run: `corepack pnpm tsc --noEmit`
Expected: no errors (confirms no frontend regression only).

```bash
git add supabase/functions/_shared/dataAgentGhlClient.ts supabase/functions/_shared/dataAgentWriter.ts supabase/functions/_shared/__tests__/dataAgentWriter.test.ts supabase/functions/data-agent-worker/index.ts
git commit -m "feat: add the Data Agent write pipeline (migrating phase)"
```

---

### Task 16: Worker's `verifying` phase — QA sampling and accuracy rating

**Files:**
- Create: `supabase/functions/_shared/dataAgentQa.ts`
- Create: `supabase/functions/_shared/__tests__/dataAgentQa.test.ts`
- Modify: `supabase/functions/_shared/dataAgentGhlClient.ts` (add `getObjectRecord`)
- Create: `supabase/migrations/20261018000400_data_agent_verifying_claim.sql`
- Modify: `supabase/functions/data-agent-worker/index.ts`

**Interfaces:**
- Consumes: `ConfirmedMapping`, `getFieldValue`, `STALE_CLAIM_MS` (Task 15); `getContact` (Task 5).
- Produces: `computeSampleSize(total: number): number`, `selectRandomSample<T>(items: T[], size: number, randomFn?: () => number): T[]`, `sampleOffsets(total: number, size: number, randomFn?: () => number): number[]`, `flattenGhlRecordFields(raw: Record<string, unknown>): Record<string, unknown>`, `compareFields(sourceRow, mappings, flattenedActual): FieldComparison[]`, `getObjectRecord(config, objectKey, recordId): Promise<GhlObjectRecord>`. `data_agent_migrations.claimed_at` column.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/__tests__/dataAgentQa.test.ts
import { describe, it, expect } from 'vitest'
import { computeSampleSize, selectRandomSample, sampleOffsets, flattenGhlRecordFields, compareFields } from '../dataAgentQa'
import type { ConfirmedMapping } from '../dataAgentWriter'

describe('computeSampleSize', () => {
  it('is 0 for no written records', () => { expect(computeSampleSize(0)).toBe(0) })
  it('is at least 1 for a small total', () => { expect(computeSampleSize(10)).toBe(1) })
  it('is capped at 50 even for a very large total', () => { expect(computeSampleSize(10000)).toBe(50) })
  it('is roughly 10% for a mid-size total', () => { expect(computeSampleSize(300)).toBe(30) })
  it('never exceeds the total itself', () => { expect(computeSampleSize(3)).toBeLessThanOrEqual(3) })
})

describe('selectRandomSample', () => {
  it('returns exactly the requested size, as a subset of the input, with no duplicates', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const sample = selectRandomSample(items, 5, () => 0.5)
    expect(sample).toHaveLength(5)
    expect(new Set(sample).size).toBe(5)
    for (const v of sample) expect(items).toContain(v)
  })
  it('returns the whole list when size >= length', () => {
    expect(selectRandomSample([1, 2, 3], 5)).toHaveLength(3)
  })
  it('returns an empty array for size 0', () => {
    expect(selectRandomSample([1, 2, 3], 0)).toEqual([])
  })
})

describe('sampleOffsets', () => {
  it('REVIEW FINDING: returns distinct offsets within [0, total) without ever materializing an array of size `total` (selectRandomSample over a full index range scales O(total) in both memory and time — unacceptable once `total` is large, which Task 16\'s own commit calls a mainline scenario for this tool)', () => {
    const offsets = sampleOffsets(1_000_000, 10)
    expect(offsets).toHaveLength(10)
    expect(new Set(offsets).size).toBe(10)
    for (const o of offsets) { expect(o).toBeGreaterThanOrEqual(0); expect(o).toBeLessThan(1_000_000) }
  })
  it('returns the full range (deduplicated) when size >= total', () => {
    expect(sampleOffsets(3, 5).slice().sort((a, b) => a - b)).toEqual([0, 1, 2])
  })
  it('returns an empty array for size 0 or total 0', () => {
    expect(sampleOffsets(10, 0)).toEqual([])
    expect(sampleOffsets(0, 5)).toEqual([])
  })
})

describe('flattenGhlRecordFields', () => {
  it('spreads standard fields and maps customFields entries by id into one flat map', () => {
    const flat = flattenGhlRecordFields({ email: 'jane@x.com', customFields: [{ id: 'custom_notes', value: 'VIP' }] })
    expect(flat).toEqual({ email: 'jane@x.com', custom_notes: 'VIP' })
  })
  it('handles a record with no customFields array at all', () => {
    expect(flattenGhlRecordFields({ email: 'jane@x.com' })).toEqual({ email: 'jane@x.com' })
  })
})

describe('compareFields', () => {
  const mappings: ConfirmedMapping[] = [
    { source_column_name: 'Email', target_type: 'standard_field', target_field_key: 'email', metadata: {} },
    { source_column_name: 'Notes', target_type: 'custom_field', target_field_key: 'custom_notes', metadata: {} },
  ]

  it('matches equal values case-insensitively', () => {
    const result = compareFields({ Email: 'Jane@X.com', Notes: 'VIP' }, mappings, { email: 'jane@x.com', custom_notes: 'VIP' })
    expect(result.every(r => r.match)).toBe(true)
  })
  it('flags a mismatch', () => {
    const result = compareFields({ Email: 'jane@x.com', Notes: 'VIP' }, mappings, { email: 'jane@x.com', custom_notes: 'Regular' })
    expect(result.find(r => r.field === 'custom_notes')?.match).toBe(false)
  })
  it('flags a field missing from the fetched GHL record as a mismatch, not a crash', () => {
    const result = compareFields({ Email: 'jane@x.com', Notes: 'VIP' }, mappings, { email: 'jane@x.com' })
    expect(result.find(r => r.field === 'custom_notes')?.match).toBe(false)
  })
  it('returns an empty comparison list (vacuously 100%) when no field was actually mapped', () => {
    expect(compareFields({}, [], {})).toEqual([])
  })
})
```

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentQa.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
// supabase/functions/_shared/dataAgentQa.ts
import type { ConfirmedMapping } from './dataAgentWriter.ts'

export function computeSampleSize(total: number): number {
  if (total === 0) return 0
  return Math.min(50, total, Math.max(1, Math.round(total * 0.1)))
}

export function selectRandomSample<T>(items: T[], size: number, randomFn: () => number = Math.random): T[] {
  if (size <= 0) return []
  if (size >= items.length) return [...items]
  const pool = [...items]
  const result: T[] = []
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(randomFn() * pool.length)
    result.push(pool.splice(idx, 1)[0])
  }
  return result
}

// Picks `size` distinct offsets in [0, total) without ever materializing
// a `total`-length array — selectRandomSample over Array.from({length:
// total}) scales O(total) in both memory and time (its own internal
// `[...items]` copy plus up to `size` O(pool.length) splices), which is
// fine for a small list but a real cost once `total` is the written-row
// count of a large migration (this tool's own mainline case, not an edge
// case). Rejection sampling into a Set is O(size) in the common case
// (size is capped at 50 by computeSampleSize, so collisions are rare).
export function sampleOffsets(total: number, size: number, randomFn: () => number = Math.random): number[] {
  if (size <= 0 || total <= 0) return []
  if (size >= total) return Array.from({ length: total }, (_, i) => i)
  const chosen = new Set<number>()
  while (chosen.size < size) chosen.add(Math.floor(randomFn() * total))
  return [...chosen]
}

export function flattenGhlRecordFields(raw: Record<string, unknown>): Record<string, unknown> {
  const { customFields, ...rest } = raw as { customFields?: { id: string; value: unknown }[] }
  const flat: Record<string, unknown> = { ...rest }
  for (const cf of customFields ?? []) flat[cf.id] = cf.value
  return flat
}

export interface FieldComparison { field: string; expected: unknown; actual: unknown; match: boolean }

export function compareFields(sourceRow: Record<string, string>, mappings: ConfirmedMapping[], flattenedActual: Record<string, unknown>): FieldComparison[] {
  const comparisons: FieldComparison[] = []
  for (const m of mappings) {
    if (m.target_type !== 'standard_field' && m.target_type !== 'custom_field') continue
    if (!m.target_field_key) continue
    const expected = (sourceRow[m.source_column_name] ?? '').trim()
    const actual = flattenedActual[m.target_field_key]
    const actualStr = typeof actual === 'string' ? actual.trim() : actual == null ? '' : String(actual)
    comparisons.push({ field: m.target_field_key, expected, actual, match: expected.toLowerCase() === actualStr.toLowerCase() })
  }
  return comparisons
}
```

- [ ] **Step 3: Run the test**

Run: `corepack pnpm vitest run supabase/functions/_shared/__tests__/dataAgentQa.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 4: Add `getObjectRecord` (custom-object get-by-id) to the GHL client**

`dataAgentGhlClient.ts` (Task 5) only has `searchObjectRecord` (by field value), not get-by-id — needed here to re-fetch a custom-object record for comparison. Append:

```ts
export async function getObjectRecord(config: GhlClientConfig, objectKey: string, recordId: string): Promise<GhlObjectRecord> {
  const res = await ghlFetch(config, `/objects/${objectKey}/records/${recordId}`)
  await assertOk(res, 'GHL object record fetch')
  const body = await res.json() as { record: GhlObjectRecord }
  return body.record
}
```

- [ ] **Step 5: Add a claim column so overlapping ticks can't both verify the same migration**

Same risk class as Task 15's row-claiming fix, at the migration level this time: two overlapping worker ticks could both pick up and process the same `verifying`-status migration (confirmed in this task's review — lower-stakes than Task 15's bug since this phase only reads from GHL and writes to a local audit table, but it produces duplicate `data_agent_qa_samples` rows and a non-deterministic, last-write-wins `accuracy_rating`).

```sql
-- Migration 20261018000400: Data Agent — claim data_agent_migrations before
-- the verifying phase processes one, so overlapping worker ticks can't
-- both pick up and process the same migration (same idiom as Task 15's
-- claimed_at on data_agent_migration_records, applied here at the
-- migration level since the verifying phase has no per-record table to
-- claim against instead).
alter table public.data_agent_migrations add column claimed_at timestamptz;
```

```bash
git add supabase/migrations/20261018000400_data_agent_verifying_claim.sql
git commit -m "feat: add a claim column so the Data Agent worker can't double-process a migration across overlapping verifying ticks"
```

- [ ] **Step 6: Add the `verifying`-phase handler to the worker**

In `supabase/functions/data-agent-worker/index.ts`, add the import:

```ts
import { computeSampleSize, sampleOffsets, flattenGhlRecordFields, compareFields } from '../_shared/dataAgentQa.ts'
import { getContact, getObjectRecord } from '../_shared/dataAgentGhlClient.ts'
```

Add the dispatch call in the main handler, alongside the existing `migrating` loop. This uses the same claim-via-UPDATE pattern as the `migrating` loop's row-level claim, scoped to the migration row itself and reusing the same `STALE_CLAIM_MS` constant:

```ts
  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: verifyingCandidates, error: verifyingCandErr } = await serviceClient.from('data_agent_migrations')
    .select('id').eq('status', 'verifying').or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`).limit(5)
  if (verifyingCandErr) console.error('Data Agent worker: failed to list verifying migrations:', verifyingCandErr)
  const verifyingCandidateIds = (verifyingCandidates ?? []).map(m => (m as { id: string }).id)
  if (verifyingCandidateIds.length > 0) {
    const { data: verifying, error: verifyingClaimErr } = await serviceClient.from('data_agent_migrations')
      .update({ claimed_at: new Date().toISOString() })
      .in('id', verifyingCandidateIds).eq('status', 'verifying')
      .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
      .select('*')
    if (verifyingClaimErr) console.error('Data Agent worker: failed to claim verifying migrations:', verifyingClaimErr)
    for (const migration of (verifying ?? []) as MigratingRow[]) {
      await processVerifyingMigration(serviceClient, migration)
    }
  }
```

Add the handler function. Three corrections from a naive first pass, found in this task's own review: (1) the `written`-records query must go through an explicit count-then-offset-sample against the true total, not an unbounded `.select()` — PostgREST's default page-size cap (commonly 1000 rows) would otherwise silently and non-deterministically truncate the sampling population for any migration with more successfully-written records than that cap, which is a mainline scenario for a bulk migration tool, not an edge case; (2) every DB read needs its error checked — an unchecked `mappingRows` failure would silently make every sample compare against zero mapped fields, which `compareFields` scores as a vacuous 100% match, actively writing a *false* "fully accurate" result rather than a missing one; (3) a missing GHL connection must be visibly distinguished from "nothing to verify" rather than collapsing both into the same `accuracy_rating: null` with no signal — but it must NOT mark the whole migration `failed`, since the actual CRM writes already succeeded; only the verification step itself couldn't run:

```ts
async function processVerifyingMigration(serviceClient: SupabaseClient, migration: MigratingRow) {
  const { data: mappingRows, error: mappingErr } = await serviceClient.from('data_agent_column_mappings')
    .select('source_column_name, target_type, target_field_key, metadata').eq('migration_id', migration.id)
  if (mappingErr) { console.error(`Data Agent worker: failed to load column mappings for verifying migration ${migration.id}:`, mappingErr); return }
  const mappings = (mappingRows ?? []) as ConfirmedMapping[]

  const { count: totalWritten, error: countErr } = await serviceClient.from('data_agent_migration_records')
    .select('id', { count: 'exact', head: true }).eq('migration_id', migration.id).in('write_status', ['created', 'replaced'])
  if (countErr) { console.error(`Data Agent worker: failed to count written records for migration ${migration.id}:`, countErr); return }

  const sampleSize = computeSampleSize(totalWritten ?? 0)
  // Sample by picking random OFFSETS into the true total (not by fetching
  // the whole population) — a plain, unbounded .select() here would be
  // silently capped at PostgREST's default page size for any migration
  // with more written rows than that cap, biasing the sample toward an
  // arbitrary (and, without an explicit order, undefined) subset instead
  // of being genuinely representative. sampleOffsets (not
  // selectRandomSample over a materialized index array) keeps this
  // O(sampleSize) instead of O(totalWritten) for a large migration.
  const offsets = sampleOffsets(totalWritten ?? 0, sampleSize)
  const sample: { id: string; source_row_data: Record<string, string>; ghl_record_id: string }[] = []
  for (const offset of offsets) {
    const { data: rows, error: rowErr } = await serviceClient.from('data_agent_migration_records')
      .select('id, source_row_data, ghl_record_id').eq('migration_id', migration.id).in('write_status', ['created', 'replaced'])
      .order('row_number').range(offset, offset)
    if (rowErr) { console.error(`Data Agent worker: failed to fetch sample offset ${offset} for migration ${migration.id}:`, rowErr); continue }
    if (rows?.[0]) sample.push(rows[0] as { id: string; source_row_data: Record<string, string>; ghl_record_id: string })
  }

  let accuracyRating: number | null = null
  let verificationNote: string | null = null

  if (sample.length > 0) {
    const config = await loadGhlConfig(serviceClient, migration.sub_account)
    if (!config) {
      // The migration itself already succeeded (it only reaches this
      // phase after a clean migrating phase) — only the QA step couldn't
      // run, so this stays `completed`, not `failed`, but must be
      // distinguishable from "nothing to verify" (both would otherwise
      // collapse into the same accuracy_rating: null with zero signal).
      verificationNote = 'Verification skipped: no usable GHL connection'
      console.error(`Data Agent worker: ${verificationNote} (migration ${migration.id})`)
    } else {
      const matchPcts: number[] = []
      for (const record of sample) {
        try {
          const fetched = migration.target_object_type === 'contact'
            ? (await getContact(config, record.ghl_record_id)).contact
            : (await getObjectRecord(config, migration.target_object_type, record.ghl_record_id)).properties
          const flattened = flattenGhlRecordFields(fetched as Record<string, unknown>)
          const comparisons = compareFields(record.source_row_data, mappings, flattened)
          const matchPct = comparisons.length === 0 ? 100 : (comparisons.filter(c => c.match).length / comparisons.length) * 100
          matchPcts.push(matchPct)
          const { error: insertErr } = await serviceClient.from('data_agent_qa_samples').insert({
            migration_record_id: record.id, fetched_ghl_data: fetched, field_comparisons: comparisons, match_pct: matchPct,
          })
          if (insertErr) console.error(`Data Agent worker: failed to insert QA sample for record ${record.id}:`, insertErr)
        } catch {
          // A sample that fails to re-fetch is skipped from the average rather
          // than crashing the whole verification pass — it is informational,
          // never a reason to block `completed` (spec §8).
        }
      }
      accuracyRating = matchPcts.length > 0 ? matchPcts.reduce((a, b) => a + b, 0) / matchPcts.length : null
    }
  }

  const { error } = await serviceClient.from('data_agent_migrations').update({
    status: 'completed', completed_at: new Date().toISOString(),
    accuracy_rating: accuracyRating, error_message: verificationNote, claimed_at: null,
  }).eq('id', migration.id)
  if (error) console.error(`Data Agent worker: failed to mark migration ${migration.id} completed:`, error)
}
```

- [ ] **Step 7: Typecheck and commit**

Run: `node_modules/.bin/tsc --noEmit -p supabase/functions/tsconfig.json` (the real check for `dataAgentQa.ts`/`dataAgentGhlClient.ts` — see Task 6's Global Constraint).
Expected: no errors.

Run: `corepack pnpm tsc --noEmit`
Expected: no errors (confirms no frontend regression only).

```bash
git add supabase/functions/_shared/dataAgentQa.ts supabase/functions/_shared/__tests__/dataAgentQa.test.ts supabase/functions/_shared/dataAgentGhlClient.ts supabase/functions/data-agent-worker/index.ts
git commit -m "feat: add the Data Agent verifying phase (QA sampling and accuracy rating)"
```

---

### Task 17: Worker's `undoing` phase — rollback, and the Undo control

**Files:**
- Create: `supabase/migrations/20261018000500_data_agent_undo_tracking.sql`
- Modify: `supabase/functions/data-agent-worker/index.ts`
- Modify: `src/features/data-agent/mapping-review/MappingReviewPage.tsx`
- Modify: `src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx`

**Interfaces:**
- Consumes: `deleteContact`, `deleteObjectRecord`, `upsertContact`, `updateObjectRecord` (Task 5); `loadGhlConfig`, `MigratingRow` (Task 15, extended here).
- Produces: `undo_status` column on `data_agent_migration_records`; RPC `public.request_data_agent_undo(p_migration_id uuid) returns void`.

**Review Focus #5, concretely:** the worker reloads the connection via the same `loadGhlConfig(serviceClient, migration.sub_account)` used for every other write — if the sub-account's PIT/location has since changed, undo uses *that* current connection, the same as any other write would. If it points at a different location than the data was originally written to, the reversal calls will simply fail against that location's data (404/not-found on delete, or create a stray record on restore) — each such failure is captured per-record as `undo_status: 'failed'` with `error_message` set, never silently skipped.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 20261018000500: Data Agent — per-record undo tracking and the
-- undo-request gate (spec §9). Numbered 000500, not 000300 — Task 15's
-- and Task 16's own fix rounds already claimed 000300/000400 for their
-- own new migrations after this task's brief was first written; this is
-- a filename-collision fix, not a design change.

alter table public.data_agent_migration_records
  add column undo_status text check (undo_status in ('pending', 'done', 'failed'));

create or replace function public.request_data_agent_undo(p_migration_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_sub_account text;
  v_status text;
begin
  select sub_account, status into v_sub_account, v_status from public.data_agent_migrations where id = p_migration_id;
  if v_sub_account is null then
    raise exception 'Migration not found';
  end if;
  -- is_data_agent_member() always returns true/false, never null (see its
  -- own definition) — the explicit "is not true" here is defense in
  -- depth, not a workaround: this is the single authorization gate before
  -- a real CRM write, and must stay correct even if a future edit to that
  -- function's body ever reintroduced a NULL path.
  if coalesce(public.is_data_agent_member(v_sub_account), false) is not true then
    raise exception 'Not authorized for this migration';
  end if;
  if v_status <> 'completed' then
    raise exception 'Only a completed migration can be undone (current status: %)', v_status;
  end if;

  update public.data_agent_migration_records
    set undo_status = 'pending'
    where migration_id = p_migration_id and write_status in ('created', 'replaced');

  update public.data_agent_migrations set status = 'undoing' where id = p_migration_id;
end;
$$;
revoke execute on function public.request_data_agent_undo(uuid) from public, anon;
grant execute on function public.request_data_agent_undo(uuid) to authenticated;
```

- [ ] **Step 2: Verify live via the Supabase Management API**

```sql
select column_name from information_schema.columns where table_name = 'data_agent_migration_records' and column_name = 'undo_status';
select proname from pg_proc where proname = 'request_data_agent_undo';
```

- [ ] **Step 3: Commit the migration**

```bash
git add supabase/migrations/20261018000500_data_agent_undo_tracking.sql
git commit -m "feat: add Data Agent undo tracking and the undo-request gate"
```

- [ ] **Step 4: Add the `undoing`-phase handler to the worker**

In `supabase/functions/data-agent-worker/index.ts`, add the dispatch call. This reuses the `staleThreshold` constant already declared earlier in `Deno.serve` by the `verifying` dispatch loop (Task 16) — do not redeclare it:

```ts
  // Claimed exactly like the verifying dispatch loop above — two
  // overlapping ticks must not both process the same undoing migration.
  // The GHL-side operations here (delete-by-id, update-by-id with the
  // same snapshot) are naturally idempotent on their own, so this isn't
  // about preventing a duplicate CRM record the way Task 15's claim is —
  // it's about the per-record/per-migration undo_status bookkeeping
  // itself, which has no such self-healing: two overlapping ticks racing
  // to write different results (success vs. a transient failure) for the
  // same record can leave it permanently stuck in a wrong terminal state,
  // since nothing ever revisits a 'done'/'failed' row (found in this
  // task's review). Reuses data_agent_migrations.claimed_at (added for
  // the verifying phase) — the two phases' claims never overlap in time
  // since a migration is never 'verifying' and 'undoing' at once.
  const { data: undoingCandidates, error: undoingCandErr } = await serviceClient.from('data_agent_migrations')
    .select('id').eq('status', 'undoing').or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`).limit(5)
  if (undoingCandErr) console.error('Data Agent worker: failed to list undoing migrations:', undoingCandErr)
  const undoingCandidateIds = (undoingCandidates ?? []).map(m => (m as { id: string }).id)
  if (undoingCandidateIds.length > 0) {
    const { data: undoing, error: undoingClaimErr } = await serviceClient.from('data_agent_migrations')
      .update({ claimed_at: new Date().toISOString() })
      .in('id', undoingCandidateIds).eq('status', 'undoing')
      .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
      .select('*')
    if (undoingClaimErr) console.error('Data Agent worker: failed to claim undoing migrations:', undoingClaimErr)
    for (const migration of (undoing ?? []) as MigratingRow[]) {
      await processUndoingMigration(serviceClient, migration)
    }
  }
```

Add the handler:

```ts
async function processUndoingMigration(serviceClient: SupabaseClient, migration: MigratingRow) {
  // Reload the connection fresh, exactly like every other write — if it
  // has since changed, undo uses whatever is current now (Review Focus #5).
  const config = await loadGhlConfig(serviceClient, migration.sub_account)
  if (!config) {
    const { error } = await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: 'No usable GHL connection for undo', claimed_at: null }).eq('id', migration.id)
    if (error) console.error(`Data Agent worker: failed to mark migration ${migration.id} failed (no connection for undo):`, error)
    return
  }

  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: candidateRows, error: candidateErr } = await serviceClient.from('data_agent_migration_records')
    .select('id').eq('migration_id', migration.id).eq('undo_status', 'pending')
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`).order('row_number').limit(BATCH_SIZE)
  if (candidateErr) { console.error(`Data Agent worker: failed to list pending undo records for migration ${migration.id}:`, candidateErr); return }
  const candidateIds = (candidateRows ?? []).map(r => (r as { id: string }).id)

  if (candidateIds.length === 0) {
    const { count, error: countErr } = await serviceClient.from('data_agent_migration_records').select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id).eq('undo_status', 'pending')
    if (countErr) { console.error(`Data Agent worker: failed to check remaining undo count for migration ${migration.id}:`, countErr); return }
    if ((count ?? 0) === 0) {
      const { error } = await serviceClient.from('data_agent_migrations').update({ status: 'undone', claimed_at: null }).eq('id', migration.id)
      if (error) console.error(`Data Agent worker: failed to mark migration ${migration.id} undone:`, error)
    }
    return
  }

  // Same atomic claim-via-UPDATE pattern as the migrating phase's record
  // claim: the WHERE clause re-checks undo_status/claimed_at in the same
  // statement, so a row another tick already claimed between the SELECT
  // above and this UPDATE simply won't come back from .select() here.
  const { data: claimedRows, error: claimErr } = await serviceClient.from('data_agent_migration_records')
    .update({ claimed_at: new Date().toISOString() })
    .in('id', candidateIds).eq('undo_status', 'pending')
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
    .select('id, write_status, ghl_record_id, pre_replace_snapshot')
  if (claimErr) { console.error(`Data Agent worker: failed to claim undo records for migration ${migration.id}:`, claimErr); return }
  const pending = (claimedRows ?? []) as { id: string; write_status: string; ghl_record_id: string; pre_replace_snapshot: Record<string, unknown> | null }[]
  if (pending.length === 0) return // everything was claimed by a concurrent tick between our select and update

  const isContact = migration.target_object_type === 'contact'
  for (const record of pending) {
    try {
      if (record.write_status === 'created') {
        if (isContact) await deleteContact(config, record.ghl_record_id)
        else await deleteObjectRecord(config, migration.target_object_type, record.ghl_record_id)
      } else if (record.write_status === 'replaced') {
        // A 'replaced' row with no captured snapshot can't actually be
        // reversed — this should never happen (writeRecordBatch always
        // captures one for a replace), but failing loudly here is the
        // safe default: silently marking undo_status: 'done' with
        // nothing actually reverted would be a false "this was undone"
        // signal on a destructive, irreversible operation.
        if (!record.pre_replace_snapshot) throw new Error('Cannot undo: no pre-replace snapshot was captured for this record')
        if (isContact) await upsertContact(config, { locationId: config.locationId, ...record.pre_replace_snapshot } as never)
        else await updateObjectRecord(config, migration.target_object_type, record.ghl_record_id, record.pre_replace_snapshot)
      }
      const { error } = await serviceClient.from('data_agent_migration_records').update({ undo_status: 'done', claimed_at: null }).eq('id', record.id)
      if (error) console.error(`Data Agent worker: failed to mark record ${record.id} undo done:`, error)
    } catch (err) {
      if (err instanceof GhlRateLimitError) {
        // Left pending — release the claim so the very next tick can
        // retry immediately rather than waiting out the stale window.
        const { error } = await serviceClient.from('data_agent_migration_records').update({ claimed_at: null }).eq('id', record.id)
        if (error) console.error(`Data Agent worker: failed to release claim on undo record ${record.id}:`, error)
        continue
      }
      const { error } = await serviceClient.from('data_agent_migration_records').update({ undo_status: 'failed', error_message: err instanceof Error ? err.message : String(err), claimed_at: null }).eq('id', record.id)
      if (error) console.error(`Data Agent worker: failed to mark record ${record.id} undo failed:`, error)
    }
  }
}
```

Add `deleteContact, deleteObjectRecord, GhlRateLimitError` to the worker's existing import from `../_shared/dataAgentGhlClient.ts`.

- [ ] **Step 5: Add the Undo control to the review page**

Append to `src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx`:

```tsx
it('shows an Undo button only once the migration has completed, and calls request_data_agent_undo', async () => {
  Object.assign(migrationRow, { status: 'completed' })
  mappingRows = [{ id: 'cm-1', source_column_name: 'Email', status: 'mapped', target_field_key: 'email', target_type: 'standard_field', mapped_by: 'rule', metadata: {} }]
  renderAt('mig-1')
  const undoBtn = await screen.findByRole('button', { name: /undo migration/i })
  await userEvent.click(undoBtn)
  await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('request_data_agent_undo', { p_migration_id: 'mig-1' }))
})

it('does not show Undo while the migration is still in progress', async () => {
  Object.assign(migrationRow, { status: 'mapping' })
  renderAt('mig-1')
  await screen.findByText('Mystery')
  expect(screen.queryByRole('button', { name: /undo migration/i })).not.toBeInTheDocument()
})
```

This page already has a `useRealtime` subscription on `data_agent_column_mappings` so mapping-row changes show up live, but `migration` itself is only ever fetched once, on mount — the worker drives `migrating → verifying → completed → undoing → undone` entirely asynchronously after that, so without this subscription the page never reflects any of it without a manual refresh. This matters specifically for Undo: the Undo button's own gate (`migration?.status === 'completed'`) would otherwise stay true after a successful undo request (server-side status moves to `'undoing'`, but the client never learns that), leaving the button visually enabled with no success feedback — a real, if non-destructive, UX defect found in this task's review (the RPC's own precondition still blocks an actual double-undo, but a confused user clicking it again gets a raw, destructive-sounding Postgres error instead of any indication their first click worked). Add this subscription below the existing one (`data_agent_column_mappings`):

```tsx
  useRealtime({ table: 'data_agent_migrations', filter: migrationId ? `id=eq.${migrationId}` : undefined, onUpdate: row => setMigration(row as DataAgentMigration) })
```

In `src/features/data-agent/mapping-review/MappingReviewPage.tsx`, add below the existing `confirmMigration` function:

```tsx
  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)

  async function undoMigration() {
    if (!migrationId) return
    setUndoing(true); setUndoError(null)
    const { error } = await supabase.rpc('request_data_agent_undo', { p_migration_id: migrationId })
    setUndoing(false)
    if (error) setUndoError(error.message)
  }
```

And in the JSX, after the Confirm & Migrate button:

```tsx
      {migration?.status === 'completed' && (
        <div className="space-y-1">
          <button onClick={() => void undoMigration()} disabled={undoing}
            className="text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-md px-4 py-2">
            {undoing ? 'Undoing…' : 'Undo Migration'}
          </button>
          {undoError && <p role="alert" className="text-sm text-red-600">{undoError}</p>}
        </div>
      )}
```

- [ ] **Step 6: Run tests, typecheck, and commit**

Run: `corepack pnpm vitest run src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx`
Expected: PASS (10 tests).

Run: `corepack pnpm tsc --noEmit`
Expected: no errors.

```bash
git add supabase/functions/data-agent-worker/index.ts src/features/data-agent/mapping-review/MappingReviewPage.tsx src/features/data-agent/mapping-review/__tests__/MappingReviewPage.test.tsx
git commit -m "feat: add the Data Agent undo/rollback phase and Undo control"
```

---

### Task 18: Dashboard

**Files:**
- Create: `src/features/data-agent/dashboard/dashboardStats.ts`
- Create: `src/features/data-agent/dashboard/__tests__/dashboardStats.test.ts`
- Create: `src/features/data-agent/dashboard/DataAgentDashboard.tsx`
- Create: `src/features/data-agent/dashboard/__tests__/DataAgentDashboard.test.tsx`
- Modify: `src/features/data-agent/DataAgentPage.tsx`

**Interfaces:**
- Consumes: table `data_agent_migrations`, `data_agent_members` (Tasks 1, 7); component `NewMigrationModal` (Task 9).
- Produces: `computeDashboardStats(migrations): DashboardStats`; component `DataAgentDashboard`.

**Review Focus #4, concretely:** `computeDashboardStats` only counts a migration toward `completedCount`, `recordsProcessed`, or the accuracy average when `status === 'completed'`. The "latest" field shows whichever migration is most recent by `created_at` *regardless* of status, carrying its own real status — an abandoned `mapping` migration is shown honestly as `mapping`, never implied as a success, and never folded into the aggregates.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/data-agent/dashboard/__tests__/dashboardStats.test.ts
import { describe, it, expect } from 'vitest'
import { computeDashboardStats } from '../dashboardStats'

const m = (overrides: Partial<{ status: string; row_count: number; accuracy_rating: number | null; created_at: string }>) => ({
  status: 'completed', row_count: 10, accuracy_rating: 95, created_at: '2026-10-01T00:00:00Z', ...overrides,
})

describe('computeDashboardStats', () => {
  it('returns zeroed stats and no latest for an empty list', () => {
    expect(computeDashboardStats([])).toEqual({ completedCount: 0, recordsProcessed: 0, avgAccuracy: null, latest: null })
  })

  it('REVIEW FOCUS #4: excludes an abandoned mid-mapping migration from every aggregate, while still surfacing it as the latest with its real status', () => {
    const completed = m({ status: 'completed', row_count: 100, accuracy_rating: 90, created_at: '2026-10-01T00:00:00Z' })
    const abandoned = m({ status: 'mapping', row_count: 500, accuracy_rating: null, created_at: '2026-10-05T00:00:00Z' })
    const stats = computeDashboardStats([completed, abandoned])

    expect(stats.completedCount).toBe(1)
    expect(stats.recordsProcessed).toBe(100) // not 600 — the abandoned one's 500 rows never counted
    expect(stats.avgAccuracy).toBe(90)
    expect(stats.latest).toBe(abandoned) // most recent by created_at, regardless of status
    expect(stats.latest?.status).toBe('mapping') // shown honestly, not implied complete
  })

  it('averages accuracy only across completed migrations that actually have a rating', () => {
    const a = m({ accuracy_rating: 80, created_at: '2026-10-01T00:00:00Z' })
    const b = m({ accuracy_rating: null, created_at: '2026-10-02T00:00:00Z' }) // completed but 0 records written, so no sample
    const c = m({ accuracy_rating: 100, created_at: '2026-10-03T00:00:00Z' })
    expect(computeDashboardStats([a, b, c]).avgAccuracy).toBe(90)
  })

  it('picks the most recent migration as latest even when it is earlier in the array', () => {
    const older = m({ created_at: '2026-10-01T00:00:00Z' })
    const newer = m({ created_at: '2026-10-09T00:00:00Z' })
    expect(computeDashboardStats([older, newer]).latest).toBe(newer)
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/dashboard/__tests__/dashboardStats.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
// src/features/data-agent/dashboard/dashboardStats.ts
export interface DashboardMigrationLike {
  status: string
  row_count: number
  accuracy_rating: number | null
  created_at: string
}

export interface DashboardStats<T extends DashboardMigrationLike> {
  completedCount: number
  recordsProcessed: number
  avgAccuracy: number | null
  latest: T | null
}

export function computeDashboardStats<T extends DashboardMigrationLike>(migrations: T[]): DashboardStats<T> {
  const completed = migrations.filter(m => m.status === 'completed')
  const ratings = completed.map(m => m.accuracy_rating).filter((r): r is number => r !== null)

  const latest = migrations.reduce<T | null>((acc, m) =>
    !acc || new Date(m.created_at).getTime() > new Date(acc.created_at).getTime() ? m : acc, null)

  return {
    completedCount: completed.length,
    recordsProcessed: completed.reduce((sum, m) => sum + m.row_count, 0),
    avgAccuracy: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    latest,
  }
}
```

- [ ] **Step 3: Run the test**

Run: `corepack pnpm vitest run src/features/data-agent/dashboard/__tests__/dashboardStats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Write the failing component test**

```tsx
// src/features/data-agent/dashboard/__tests__/DataAgentDashboard.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'

const migrationsData = [
  { id: 'mig-1', status: 'completed', row_count: 100, accuracy_rating: 92, created_at: '2026-10-01T00:00:00Z', original_filename: 'contacts.csv' },
  { id: 'mig-2', status: 'mapping', row_count: 500, accuracy_rating: null, created_at: '2026-10-05T00:00:00Z', original_filename: 'orders.csv' },
]
const membersData = [{ user_id: 'u1', users: { name: 'Jane' } }]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'data_agent_migrations') return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: migrationsData }) }) }) }
      return { select: () => ({ eq: () => Promise.resolve({ data: membersData }) }) }
    }),
  },
}))

import { DataAgentDashboard } from '../DataAgentDashboard'

describe('DataAgentDashboard', () => {
  it('shows the latest migration with its real status, not implied success, and excludes it from the completed count', async () => {
    render(<MemoryRouter><DataAgentDashboard subAccount="AM333" /></MemoryRouter>)
    expect(await screen.findByText('orders.csv')).toBeInTheDocument()
    expect(screen.getByTestId('latest-status')).toHaveTextContent(/mapping/i)
    expect(screen.getByTestId('completed-count')).toHaveTextContent('1')
    expect(screen.getByTestId('records-processed')).toHaveTextContent('100')
  })

  it('lists team members by name', async () => {
    render(<MemoryRouter><DataAgentDashboard subAccount="AM333" /></MemoryRouter>)
    expect(await screen.findByText('Jane')).toBeInTheDocument()
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/dashboard/__tests__/DataAgentDashboard.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement**

```tsx
// src/features/data-agent/dashboard/DataAgentDashboard.tsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { computeDashboardStats, type DashboardMigrationLike } from './dashboardStats'

interface MigrationRow extends DashboardMigrationLike { id: string; original_filename: string }
interface MemberRow { user_id: string; users: { name: string } | null }

export function DataAgentDashboard({ subAccount }: { subAccount: string }) {
  const [migrations, setMigrations] = useState<MigrationRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void supabase.from('data_agent_migrations').select('id, status, row_count, accuracy_rating, created_at, original_filename')
      .eq('sub_account', subAccount).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setLoadError('Could not load migration history.'); return }
        setMigrations((data ?? []) as MigrationRow[])
      })
    void supabase.from('data_agent_members').select('user_id, users(name)').eq('sub_account', subAccount)
      .then(({ data, error }) => {
        if (error) { setLoadError('Could not load team members.'); return }
        setMembers((data ?? []) as unknown as MemberRow[])
      })
  }, [subAccount])

  const stats = computeDashboardStats(migrations)

  return (
    <div className="space-y-5">
      {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Migrations Completed" value={stats.completedCount} testId="completed-count" />
        <StatCard label="Records Processed" value={stats.recordsProcessed} testId="records-processed" />
        <StatCard label="Avg. Accuracy" value={stats.avgAccuracy !== null ? `${stats.avgAccuracy.toFixed(1)}%` : '—'} testId="avg-accuracy" />
        <StatCard label="Team Members" value={members.length} testId="member-count" />
      </div>

      {stats.latest && (
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-400">Most recent</p>
          <p className="text-sm font-medium text-gray-900">{stats.latest.original_filename}</p>
          <span data-testid="latest-status" className="text-xs font-semibold text-gray-600">{stats.latest.status}</span>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Migration History</h3>
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {migrations.map(m => (
            <li key={m.id} className="px-4 py-2 text-sm">
              <Link to={`/data-agent/migrations/${m.id}`} className="text-violet-700 hover:underline">{m.original_filename}</Link>
              <span className="text-gray-400 ml-2 text-xs">{m.status}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Team</h3>
        <ul className="text-sm text-gray-700 space-y-1">
          {members.map(m => <li key={m.user_id}>{m.users?.name}</li>)}
        </ul>
      </div>
    </div>
  )
}

function StatCard({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p data-testid={testId} className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  )
}
```

- [ ] **Step 6: Wire into the page**

Replace the body of `src/features/data-agent/DataAgentPage.tsx`:

```tsx
// src/features/data-agent/DataAgentPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { NewMigrationModal } from './upload/NewMigrationModal'
import { DataAgentDashboard } from './dashboard/DataAgentDashboard'

export function DataAgentPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Data Agent</h1>
        <button onClick={() => setShowNew(true)} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
          New Migration
        </button>
      </div>
      {user?.sub_account && <DataAgentDashboard subAccount={user.sub_account} />}
      {showNew && user?.sub_account && (
        <NewMigrationModal
          subAccount={user.sub_account}
          onClose={() => setShowNew(false)}
          onCreated={migrationId => navigate(`/data-agent/migrations/${migrationId}`)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run tests, typecheck, and commit**

Run: `corepack pnpm vitest run src/features/data-agent/dashboard/__tests__/dashboardStats.test.ts src/features/data-agent/dashboard/__tests__/DataAgentDashboard.test.tsx`
Expected: PASS (4 + 2 tests).

Run: `corepack pnpm tsc --noEmit`
Expected: no errors.

```bash
git add src/features/data-agent/dashboard/dashboardStats.ts src/features/data-agent/dashboard/__tests__/dashboardStats.test.ts src/features/data-agent/dashboard/DataAgentDashboard.tsx src/features/data-agent/dashboard/__tests__/DataAgentDashboard.test.tsx src/features/data-agent/DataAgentPage.tsx
git commit -m "feat: add the Data Agent dashboard"
```

---

### Task 19: Chat panel

**Files:**
- Create: `src/features/data-agent/chat/DataAgentChat.tsx`
- Create: `src/features/data-agent/chat/__tests__/DataAgentChat.test.tsx`
- Modify: `src/features/data-agent/dashboard/DataAgentDashboard.tsx`

**Interfaces:**
- Consumes: table `data_agent_chat_messages` (Task 7); hook `useRealtime` (existing).
- Produces: component `DataAgentChat({ subAccount: string })`.

Spec §11: one thread per sub-account's whole Data Agent workspace, not per-migration — distinct from the per-column prompt feature (Task 13), which talks to the App about one mapping decision rather than to other people.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/data-agent/chat/__tests__/DataAgentChat.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const messagesData = [{ id: 'm1', user_id: 'u1', message: 'Started the contacts upload', created_at: '2026-10-01T00:00:00Z', users: { name: 'Jane' } }]
const insertMock = vi.fn()

vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u2', sub_account: 'AM333' } }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: messagesData }) }) }),
      insert: (...args: unknown[]) => { insertMock(...args); return Promise.resolve({ error: null }) },
    })),
  },
}))

import { DataAgentChat } from '../DataAgentChat'

describe('DataAgentChat', () => {
  beforeEach(() => insertMock.mockReset())

  it('shows existing messages with the sender\'s name', async () => {
    render(<DataAgentChat subAccount="AM333" />)
    expect(await screen.findByText('Started the contacts upload')).toBeInTheDocument()
    expect(screen.getByText('Jane')).toBeInTheDocument()
  })

  it('sends a new message scoped to the sub-account', async () => {
    render(<DataAgentChat subAccount="AM333" />)
    await userEvent.type(await screen.findByLabelText(/message/i), 'Mapping looks good')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(insertMock).toHaveBeenCalledWith({ sub_account: 'AM333', user_id: 'u2', message: 'Mapping looks good' }))
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/chat/__tests__/DataAgentChat.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```tsx
// src/features/data-agent/chat/DataAgentChat.tsx
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useRealtime } from '@/hooks/useRealtime'

interface MessageRow { id: string; user_id: string; message: string; created_at: string; users: { name: string } | null }

export function DataAgentChat({ subAccount }: { subAccount: string }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('data_agent_chat_messages').select('id, user_id, message, created_at, users(name)')
      .eq('sub_account', subAccount).order('created_at')
    setMessages((data ?? []) as unknown as MessageRow[])
  }, [subAccount])

  useEffect(() => { void load() }, [load])
  useRealtime({ table: 'data_agent_chat_messages', filter: `sub_account=eq.${subAccount}`, onInsert: () => void load() })

  async function send() {
    if (!draft.trim() || !user?.id) return
    await supabase.from('data_agent_chat_messages').insert({ sub_account: subAccount, user_id: user.id, message: draft.trim() })
    setDraft('')
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">Team Chat</h3>
      <div className="border border-gray-200 rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
        {messages.map(m => (
          <div key={m.id} className="text-sm">
            <span className="font-medium text-gray-800">{m.users?.name}</span>
            <span className="text-gray-600 ml-2">{m.message}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input aria-label="message" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Message your team…" className="input flex-1" />
        <button onClick={() => void send()} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
          Send
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire into the Dashboard**

In `src/features/data-agent/dashboard/DataAgentDashboard.tsx`, add the import and render it after the Team section:

```tsx
import { DataAgentChat } from '../chat/DataAgentChat'
```

```tsx
      <DataAgentChat subAccount={subAccount} />
```

- [ ] **Step 4: Run tests, typecheck, and commit**

Run: `corepack pnpm vitest run src/features/data-agent/chat/__tests__/DataAgentChat.test.tsx`
Expected: PASS (2 tests).

Run: `corepack pnpm tsc --noEmit`
Expected: no errors.

```bash
git add src/features/data-agent/chat/DataAgentChat.tsx src/features/data-agent/chat/__tests__/DataAgentChat.test.tsx src/features/data-agent/dashboard/DataAgentDashboard.tsx
git commit -m "feat: add the Data Agent team chat panel"
```

---

### Task 20: Service providers (agency model) and the workspace switcher

**Files:**
- Create: `supabase/migrations/20261018000400_data_agent_provider_clients.sql`
- Create: `src/features/data-agent/entitlements/ProviderClientsPanel.tsx`
- Create: `src/features/data-agent/entitlements/__tests__/ProviderClientsPanel.test.tsx`
- Modify: `src/features/data-agent/entitlements/DataAgentEntitlementsTab.tsx`
- Create: `src/features/data-agent/workspace/DataAgentWorkspaceSwitcher.tsx`
- Create: `src/features/data-agent/workspace/__tests__/DataAgentWorkspaceSwitcher.test.tsx`
- Modify: `src/features/data-agent/DataAgentPage.tsx`
- Create: `src/features/data-agent/__tests__/DataAgentPage.test.tsx`

**Interfaces:**
- Consumes: `is_data_agent_member` (Task 1, redefined here); table `sub_accounts` (existing); components `DataAgentDashboard` (Task 18), `NewMigrationModal` (Task 9).
- Produces: table `data_agent_provider_clients(provider_sub_account, client_sub_account, added_by, added_at)`; component `DataAgentWorkspaceSwitcher({ ownSubAccount, selected, onChange })`.

Per the amended spec §2.1: a provider sub-account (e.g. AM333) can run Data Agent migrations for a client sub-account (e.g. JOY Consultancy) only once Super-Admin explicitly grants it — the same authority that already grants `data_agent_entitlements`, and this codebase's one existing precedent for any cross-tenant grant (Projects, Super-Admin-only). The client keeps owning its own GHL connection; the grant only extends *who* may operate migrations against it, never *whose* credentials are used.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 20261018000400: Data Agent — service-provider (agency) grants
-- (spec §2.1). Redefines is_data_agent_member() from migration
-- 20261018000000, the same way migration 027 redefined auth_user_app_id()
-- from migration 025 — this codebase's established pattern for extending
-- an already-shipped SECURITY DEFINER helper rather than editing the
-- migration that first defined it.

create table public.data_agent_provider_clients (
  provider_sub_account text not null references public.sub_accounts(code) on delete cascade,
  client_sub_account   text not null references public.sub_accounts(code) on delete cascade,
  added_by             uuid references public.users(id) on delete set null,
  added_at             timestamptz not null default now(),
  primary key (provider_sub_account, client_sub_account),
  check (provider_sub_account <> client_sub_account)
);

alter table public.data_agent_provider_clients enable row level security;

create policy data_agent_provider_clients_select on public.data_agent_provider_clients
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or public.auth_user_sub_account() in (provider_sub_account, client_sub_account)
  );
create policy data_agent_provider_clients_write on public.data_agent_provider_clients
  for all using (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');

create policy data_agent_provider_clients_deny_associates on public.data_agent_provider_clients
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));

-- ── Extend the access gate ───────────────────────────────────────────────────
-- coalesce(..., false) at the top level, same as Task 1's original
-- definition this replaces — this redefinition must independently
-- preserve the "always true or false, never null" contract (see Task 1's
-- comment on this function for why); a redefinition that dropped it would
-- silently reopen the exact fail-open hole Task 7's review found.
create or replace function public.is_data_agent_member(p_sub_account text)
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select coalesce(
    exists (select 1 from public.data_agent_entitlements e where e.sub_account = p_sub_account and e.enabled)
    and (
      public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_sub_account() = p_sub_account
        and (
          public.auth_user_role() = 'Admin'
          or exists (select 1 from public.data_agent_members m where m.sub_account = p_sub_account and m.user_id = public.auth_user_app_id())
        )
      )
      -- A member/Admin of a sub-account Super-Admin has authorized to act
      -- as a provider for p_sub_account (spec §2.1). The client sub-account
      -- must still be entitled (the first exists() above) — this clause
      -- only extends *who* qualifies once it is.
      or exists (
        select 1 from public.data_agent_provider_clients pc
        where pc.client_sub_account = p_sub_account
          and pc.provider_sub_account = public.auth_user_sub_account()
          and (
            public.auth_user_role() = 'Admin'
            or exists (select 1 from public.data_agent_members m2 where m2.sub_account = pc.provider_sub_account and m2.user_id = public.auth_user_app_id())
          )
      )
    ),
    false
  )
$$;
revoke execute on function public.is_data_agent_member(text) from public, anon;
grant execute on function public.is_data_agent_member(text) to authenticated;
```

- [ ] **Step 2: Run the associate-lock regression test**

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts`
Expected: PASS — the new table is covered by its own `_deny_associates` policy.

- [ ] **Step 3: Verify live via the Supabase Management API**

```sql
select proname, prosrc ilike '%data_agent_provider_clients%' as extended from pg_proc where proname = 'is_data_agent_member';
-- expect extended = true
select policyname from pg_policies where tablename = 'data_agent_provider_clients';
```

- [ ] **Step 4: Commit the migration**

```bash
git add supabase/migrations/20261018000400_data_agent_provider_clients.sql
git commit -m "feat: add Data Agent service-provider grants and extend the access gate"
```

- [ ] **Step 5: Write the failing test for the Super-Admin assignment panel**

```tsx
// src/features/data-agent/entitlements/__tests__/ProviderClientsPanel.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const subAccountsData = [{ code: 'AM333', company_name: 'AM333 Wellness' }, { code: 'JOY', company_name: 'JOY Consultancy' }]
let relationships: { provider_sub_account: string; client_sub_account: string }[] = []
const insertMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'sub_accounts') return { select: () => ({ order: () => Promise.resolve({ data: subAccountsData }) }) }
      return {
        select: () => ({ order: () => Promise.resolve({ data: relationships }) }),
        insert: (...args: unknown[]) => { insertMock(...args); return Promise.resolve({ error: null }) },
        delete: () => ({ eq: () => ({ eq: () => { deleteMock(); return Promise.resolve({ error: null }) } }) }),
      }
    }),
  },
}))

import { ProviderClientsPanel } from '../ProviderClientsPanel'

describe('ProviderClientsPanel', () => {
  beforeEach(() => { insertMock.mockReset(); deleteMock.mockReset(); relationships = [] })

  it('grants AM333 as a provider for JOY, inserting the relationship', async () => {
    render(<ProviderClientsPanel />)
    await userEvent.selectOptions(await screen.findByLabelText(/provider/i), 'AM333')
    await userEvent.selectOptions(screen.getByLabelText(/client/i), 'JOY')
    await userEvent.click(screen.getByRole('button', { name: /grant/i }))
    await waitFor(() => expect(insertMock).toHaveBeenCalledWith({ provider_sub_account: 'AM333', client_sub_account: 'JOY' }))
  })

  it('lists existing relationships and can revoke one', async () => {
    relationships = [{ provider_sub_account: 'AM333', client_sub_account: 'JOY' }]
    render(<ProviderClientsPanel />)
    expect(await screen.findByText(/AM333.*JOY/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await waitFor(() => expect(deleteMock).toHaveBeenCalled())
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/entitlements/__tests__/ProviderClientsPanel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 6: Implement the panel**

```tsx
// src/features/data-agent/entitlements/ProviderClientsPanel.tsx
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface SubAccountRow { code: string; company_name: string }
interface RelationshipRow { provider_sub_account: string; client_sub_account: string }

export function ProviderClientsPanel() {
  const [accounts, setAccounts] = useState<SubAccountRow[]>([])
  const [relationships, setRelationships] = useState<RelationshipRow[]>([])
  const [provider, setProvider] = useState('')
  const [client, setClient] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('data_agent_provider_clients').select('provider_sub_account, client_sub_account').order('provider_sub_account')
    setRelationships((data ?? []) as RelationshipRow[])
  }, [])

  useEffect(() => {
    void supabase.from('sub_accounts').select('code, company_name').order('company_name')
      .then(({ data }) => setAccounts((data ?? []) as SubAccountRow[]))
    void load()
  }, [load])

  async function grant() {
    if (!provider || !client || provider === client) return
    await supabase.from('data_agent_provider_clients').insert({ provider_sub_account: provider, client_sub_account: client })
    await load()
  }

  async function revoke(r: RelationshipRow) {
    await supabase.from('data_agent_provider_clients').delete().eq('provider_sub_account', r.provider_sub_account).eq('client_sub_account', r.client_sub_account)
    await load()
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Let one sub-account run Data Agent migrations for another's CRM, as a managed service. The client keeps owning its own GHL connection.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="pc-provider" className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
          <select id="pc-provider" aria-label="provider" value={provider} onChange={e => setProvider(e.target.value)} className="input">
            <option value="">Choose…</option>
            {accounts.map(a => <option key={a.code} value={a.code}>{a.company_name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pc-client" className="block text-xs font-medium text-gray-600 mb-1">Client</label>
          <select id="pc-client" aria-label="client" value={client} onChange={e => setClient(e.target.value)} className="input">
            <option value="">Choose…</option>
            {accounts.map(a => <option key={a.code} value={a.code}>{a.company_name}</option>)}
          </select>
        </div>
        <button onClick={() => void grant()} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-3 py-2">
          Grant
        </button>
      </div>
      <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
        {relationships.map(r => (
          <li key={`${r.provider_sub_account}-${r.client_sub_account}`} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>{r.provider_sub_account} → {r.client_sub_account}</span>
            <button onClick={() => void revoke(r)} className="text-xs font-semibold text-red-600 hover:text-red-700">Revoke</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 7: Wire into the entitlements tab**

In `src/features/data-agent/entitlements/DataAgentEntitlementsTab.tsx`, add the import and render it below the existing toggle list:

```tsx
import { ProviderClientsPanel } from './ProviderClientsPanel'
```

```tsx
      <div className="pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Service Providers</h4>
        <ProviderClientsPanel />
      </div>
```

- [ ] **Step 8: Run the test**

Run: `corepack pnpm vitest run src/features/data-agent/entitlements/__tests__/ProviderClientsPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Write the failing test for the workspace switcher**

```tsx
// src/features/data-agent/workspace/__tests__/DataAgentWorkspaceSwitcher.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

let clientsData: { client_sub_account: string }[] = []
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ select: () => ({ eq: () => Promise.resolve({ data: clientsData }) }) })) },
}))

import { DataAgentWorkspaceSwitcher } from '../DataAgentWorkspaceSwitcher'

describe('DataAgentWorkspaceSwitcher', () => {
  it('renders nothing when the sub-account services no clients', async () => {
    clientsData = []
    const { container } = render(<DataAgentWorkspaceSwitcher ownSubAccount="DERMITAGE" selected="DERMITAGE" onChange={vi.fn()} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('offers "My workspace" plus every granted client, and calls onChange on selection', async () => {
    clientsData = [{ client_sub_account: 'JOY' }]
    const onChange = vi.fn()
    render(<DataAgentWorkspaceSwitcher ownSubAccount="AM333" selected="AM333" onChange={onChange} />)
    const select = await screen.findByLabelText(/workspace/i)
    expect(screen.getByRole('option', { name: /my workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'JOY' })).toBeInTheDocument()
    await userEvent.selectOptions(select, 'JOY')
    expect(onChange).toHaveBeenCalledWith('JOY')
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/workspace/__tests__/DataAgentWorkspaceSwitcher.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 10: Implement the switcher**

```tsx
// src/features/data-agent/workspace/DataAgentWorkspaceSwitcher.tsx
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface Props { ownSubAccount: string; selected: string; onChange: (subAccount: string) => void }

export function DataAgentWorkspaceSwitcher({ ownSubAccount, selected, onChange }: Props) {
  const [clients, setClients] = useState<string[]>([])

  useEffect(() => {
    void supabase.from('data_agent_provider_clients').select('client_sub_account').eq('provider_sub_account', ownSubAccount)
      .then(({ data }) => setClients(((data ?? []) as { client_sub_account: string }[]).map(c => c.client_sub_account)))
  }, [ownSubAccount])

  if (clients.length === 0) return null

  return (
    <select aria-label="Workspace" value={selected} onChange={e => onChange(e.target.value)} className="input text-sm">
      <option value={ownSubAccount}>My workspace ({ownSubAccount})</option>
      {clients.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}
```

- [ ] **Step 11: Run the test**

Run: `corepack pnpm vitest run src/features/data-agent/workspace/__tests__/DataAgentWorkspaceSwitcher.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 12: Write the failing test for the page wiring**

```tsx
// src/features/data-agent/__tests__/DataAgentPage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { sub_account: 'AM333' } }) }))
vi.mock('../workspace/DataAgentWorkspaceSwitcher', () => ({
  DataAgentWorkspaceSwitcher: ({ onChange }: { onChange: (s: string) => void }) => (
    <button onClick={() => onChange('JOY')}>switch-to-joy</button>
  ),
}))
vi.mock('../dashboard/DataAgentDashboard', () => ({
  DataAgentDashboard: ({ subAccount }: { subAccount: string }) => <div data-testid="dashboard-for">{subAccount}</div>,
}))
vi.mock('../upload/NewMigrationModal', () => ({ NewMigrationModal: () => null }))

import { DataAgentPage } from '../DataAgentPage'

describe('DataAgentPage', () => {
  it('defaults the dashboard to the signed-in user\'s own sub-account', () => {
    render(<DataAgentPage />)
    expect(screen.getByTestId('dashboard-for')).toHaveTextContent('AM333')
  })

  it('switching workspace re-points the dashboard at the chosen client sub-account', async () => {
    render(<DataAgentPage />)
    await userEvent.click(screen.getByText('switch-to-joy'))
    expect(screen.getByTestId('dashboard-for')).toHaveTextContent('JOY')
  })
})
```

Run: `corepack pnpm vitest run src/features/data-agent/__tests__/DataAgentPage.test.tsx`
Expected: FAIL (current `DataAgentPage` always passes `user.sub_account` directly, with no switcher).

- [ ] **Step 13: Wire the switcher into the page**

Replace `src/features/data-agent/DataAgentPage.tsx`:

```tsx
// src/features/data-agent/DataAgentPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { NewMigrationModal } from './upload/NewMigrationModal'
import { DataAgentDashboard } from './dashboard/DataAgentDashboard'
import { DataAgentWorkspaceSwitcher } from './workspace/DataAgentWorkspaceSwitcher'

export function DataAgentPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const [workspace, setWorkspace] = useState(user?.sub_account ?? '')

  useEffect(() => { setWorkspace(user?.sub_account ?? '') }, [user?.sub_account])

  if (!user?.sub_account) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Data Agent</h1>
        <div className="flex items-center gap-2">
          <DataAgentWorkspaceSwitcher ownSubAccount={user.sub_account} selected={workspace} onChange={setWorkspace} />
          <button onClick={() => setShowNew(true)} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-4 py-2">
            New Migration
          </button>
        </div>
      </div>
      <DataAgentDashboard subAccount={workspace} />
      {showNew && (
        <NewMigrationModal
          subAccount={workspace}
          onClose={() => setShowNew(false)}
          onCreated={migrationId => navigate(`/data-agent/migrations/${migrationId}`)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 14: Run every Data Agent test and typecheck**

Run: `corepack pnpm vitest run src/features/data-agent/__tests__/DataAgentPage.test.tsx src/features/data-agent/workspace/__tests__/DataAgentWorkspaceSwitcher.test.tsx src/features/data-agent/entitlements/__tests__/ProviderClientsPanel.test.tsx`
Expected: PASS (2 + 2 + 2 tests).

Run: `corepack pnpm vitest run src/features/data-agent supabase/functions/_shared src/hooks/__tests__/useDataAgentAccess.test.ts src/features/settings src/features/super-admin src/__tests__/associateLock.test.ts`
Expected: PASS — the full Data Agent surface together, including every path/import touched by this task's reorg and this task's new grant model.

Run: `corepack pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 15: Commit**

```bash
git add src/features/data-agent/entitlements/ProviderClientsPanel.tsx src/features/data-agent/entitlements/__tests__/ProviderClientsPanel.test.tsx src/features/data-agent/entitlements/DataAgentEntitlementsTab.tsx src/features/data-agent/workspace/DataAgentWorkspaceSwitcher.tsx src/features/data-agent/workspace/__tests__/DataAgentWorkspaceSwitcher.test.tsx src/features/data-agent/DataAgentPage.tsx src/features/data-agent/__tests__/DataAgentPage.test.tsx
git commit -m "feat: add the Data Agent workspace switcher for service providers"
```

---

## Self-Review

**Spec coverage:** §1 (accuracy-first gate) → Tasks 6, 7, 10. §2 (entitlement/access) → Task 1. §2.1 (service providers) → Task 20. §3 (connection) → Tasks 1, 4, 5. §4 (data model, incl. the 24h schema-cache staleness refresh) → Tasks 1, 5, 7, 8. §5 (upload flow) → Tasks 8, 9. §6.1–6.2 (rules + profiles) → Tasks 6, 7. §6.3 (Claude tier) → Tasks 11–12. §6.4 (gate) → Tasks 7, 10. §6.5 (prompt) → Task 13. §7 (write pipeline, replace, 429) → Tasks 14–15. §8 (QA) → Task 16. §9 (rollback) → Task 17. §10 (dashboard) → Task 18. §11 (chat) → Task 19. §12 (access UI, workspace switcher) → Tasks 2–4, 20. §13 (secrets, provider never holds a client's PIT) → Tasks 1, 5, 11–13, 20. §14 (testing strategy) → every task's pure-logic modules get real unit coverage; Task 5 carries the explicit manual-verification requirement for GHL's less-certain endpoints. §15 (phasing) → this plan's task order follows it directly.

**Placeholder scan:** no task leaves a step without real code; the two spots where this plan explicitly names an endpoint shape as uncertain (Task 5's Custom Objects API, Task 15's contact-search endpoint) are flagged with a concrete, required manual-verification step and a fallback of "fix the client module now" — not a vague TODO.

**Type consistency:** `ColumnClassification`/`ColumnClassificationMetadata` (Task 6) flow unchanged through `PlannedColumnMapping` (Task 8) into `DataAgentColumnMapping`/`DataAgentColumnMappingMetadata` (Task 2); `is_primary_candidate` was added to Task 6's metadata type to match Task 2's frontend type before Task 8 relied on it. `ConfirmedMapping` (Task 15) is reused unchanged by Tasks 16–17. The `status`/`target_type` "ignored vs. unmapped" ambiguity found while drafting Task 10 was fixed retroactively in Tasks 7 and 8 (blocking is now purely `status`-based) before Task 10 was written against it. Task 20's `is_data_agent_member()` redefinition keeps the exact same signature and every existing caller (Tasks 5, 8, 10, 13, 15–17) works unchanged, since the function's contract — "true or false for this sub-account" — never changed, only what can make it true.

**Edge-function response contract (found during execution, not during this self-review pass):** Task 5's implementation review caught that every edge function's non-2xx status codes were silently discarded by `supabase.functions.invoke()`'s generic `FunctionsHttpError` (verified against the installed `@supabase/functions-js` source) — the same bug existed in Tasks 8 and 13. Tasks 5, 8, and 13's functions were changed to return HTTP 200 for every business outcome; Task 9's UI (the only already-built UI caller affected) was corrected to read `data.error`; Task 4's UI needed no change since it already did. Documented as a new Global Constraint so no later task repeats it.

**File-structure consistency:** mid-plan, Tasks 2–19's frontend files were reorganized from a flat `src/features/data-agent/` into per-area subfolders (`settings/`, `entitlements/`, `upload/`, `mapping-review/`, `dashboard/`, `chat/`, `workspace/`) to match this codebase's "organize by feature, not by file type" convention — every `Create`/`Modify` path, `git add` line, and relative import across those tasks was updated to match (including correcting two tabs, `DataAgentSettingsTab`/`DataAgentEntitlementsTab`, that had initially been placed under the *consuming* page's own folder — `src/features/settings/` / `src/features/super-admin/` — rather than their own feature's folder, inconsistent with this codebase's existing `GHLIntegrationTab` precedent of living in `src/features/ghl/` and being imported into Settings from there).

**Review Focus coverage:** #1 (blank-sample column) → Task 6's `classifyColumn` test + Task 8's `planColumnMappings` empty-rows test. #2 (429 vs validation error) → Task 15's `writeRecordBatch` test. #3 (duplicate-row snapshot ordering) → Task 15's stateful-writer test. #4 (abandoned migration vs. aggregates) → Task 18's `computeDashboardStats` test. #5 (connection changed before undo) → Task 17's design note and the worker reusing `loadGhlConfig` fresh on every call, with per-record failure capture rather than a silent no-op. A sixth, provider-specific failure mode surfaced by Task 20's own scope — a provider granted access to a client whose entitlement is later revoked — is already covered without new code: `is_data_agent_member`'s very first clause still requires `data_agent_entitlements.enabled`, so revoking the client's entitlement alone (no change to the provider grant) immediately locks the provider out too, pinned implicitly by every existing `is_data_agent_member`-gated RLS policy rather than needing its own test.

---

Plan complete and saved to `docs/superpowers/plans/2026-10-18-data-agent-implementation.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Subagent-driven**, because 20 tasks span three distinct runtimes (Postgres RLS/pg_cron, Deno edge functions, React/Vitest) with interfaces that later tasks depend on precisely (the matching engine's types flow through six downstream tasks unchanged), and a shipped mistake here writes into a client's real CRM data — an independent reviewer per task catches interface drift and accuracy-gate regressions before they compound, which is worth more than the extra cost on a feature this size. Does the plan capture what you want, and which approach should we use?
