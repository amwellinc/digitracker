# Data Agent — Design Spec

## 1. Objective

A new DigiTracker feature, assigned per sub-account by Super-Admin, that helps a client
map and migrate their CRM data into their own DIGI5Y sub-account CRM (a GHL/HighLevel
whitelabel location) with high accuracy. The user uploads a file; the App reads it,
proposes field mappings against the location's real schema, requires explicit human
confirmation of anything it isn't certain about, writes the confirmed data into GHL, and
verifies the result by sampling records back out of GHL and comparing them to the
original file.

**Non-negotiable principle, stated explicitly because it governs every design choice
below:** the App must never silently guess. Any mapping it is not deterministically
certain of is surfaced for human confirmation before anything is written. Data accuracy
outranks convenience and speed everywhere in this design.

## 2. Entitlement & Access Model

- `data_agent_entitlements` — one row per sub-account: `sub_account`, `enabled boolean`,
  `enabled_by`, `enabled_at`. Only Super-Admin can write this table. Independent of
  subscription plan/tier — a manual grant, not a pricing feature.
- `data_agent_members` — `sub_account`, `user_id`, `added_by`, `added_at`. The
  sub-account's own Admin grants access to their *existing* DigiTracker users (no new
  user type is introduced).
- Access to any Data Agent data requires: the sub-account is entitled, AND the caller
  either has a `data_agent_members` row or is that sub-account's Admin, OR the caller is
  Super-Admin (unconditional). A new SECURITY DEFINER helper,
  `is_data_agent_member(sub_account)`, encapsulates this check and is the single gate
  every RLS policy in this feature uses — mirroring how `is_project_member()` already
  gates the Projects feature in this codebase.

## 3. Settings — CRM Connection

- `data_agent_connections` — `sub_account`, `ghl_location_id`, `connected_by`,
  `connected_at`, `last_verified_at`. The Private Integration Token itself is never
  stored in a plain column — it's written to Supabase Vault (the same mechanism already
  used for `notification_email_secret`) and referenced by a secret name/id on this row.
  It is never returned to the browser by any query; reading it back is only ever done
  server-side, inside an edge function, at the moment of a GHL API call.
- This connection is dedicated to Data Agent — independent of the separate, existing
  OAuth-based GHL Integration tab elsewhere in Settings.
- A "Test Connection" action calls an edge function that authenticates with the given
  PIT/Location ID and fetches that location's object schemas (contacts' custom fields,
  and the list of Custom Objects configured there). Success populates
  `data_agent_ghl_schema_cache`; failure surfaces GHL's actual error immediately, before
  any migration ever depends on this connection.

## 4. Data Model (remaining tables)

- `data_agent_ghl_schema_cache` — `sub_account`, `object_type` (`'contact'` or a Custom
  Object's key), `fields` (jsonb: standard + custom field definitions for that object),
  `fetched_at`. Refreshed via "Test Connection" or an explicit "Refresh Schema" action;
  also auto-refreshed at the start of a new migration if the cache is older than a set
  threshold (e.g. 24h), so mapping decisions are never made against stale schema.
- `data_agent_migrations` — one row per upload. `sub_account`, `created_by`,
  `target_object_type` (`'contact'` or a specific Custom Object key — explicitly chosen
  by the user at upload time, never inferred from file structure), `source_system`
  (nullable: `'salesforce'` | `'hubspot'` | null), `original_filename`, `storage_path`,
  `row_count`, `match_key_column` (nullable; unused and left null when
  `target_object_type = 'contact'`, since matching there is always email-then-phone via
  GHL's own upsert — this column only ever holds a value for a Custom Object migration,
  where the user explicitly confirms which mapped field serves as that object's unique
  match key), `status`
  (`uploaded → mapping → awaiting_confirmation → migrating → verifying →
  completed|failed|cancelled`, plus `undoing → undone` for rollback), progress counters
  for whichever phase is active, `accuracy_rating` (nullable until verification
  completes), `started_at`, `completed_at`, `error_message`.
- `data_agent_column_mappings` — one row per CSV column per migration.
  `source_column_name`, `sample_values` (jsonb), `target_type`
  (`standard_field`/`custom_field`/`tag`/`ignored`), `target_field_key`, `status`
  (`mapped`=green / `uncertain`=yellow / `unmapped`=red), `confidence`, `reasoning`
  (populated when Claude was involved), `mapped_by` (`rule`/`source_profile`/`claude`/
  `user`), `confirmed_by_user` (boolean — explicitly tracks whether a yellow suggestion
  has been accepted), `metadata` (jsonb: detected phone/email subtype, detected DND
  channel, detected country-code presence on sample values).
- `data_agent_migration_records` — one row per data row in the file. `row_number`,
  `source_row_data` (jsonb, the raw row), `ghl_record_id` (populated once written, for
  either a contact or a Custom Object record), `pre_replace_snapshot` (jsonb — the
  matched existing record's prior field values, captured immediately before it's
  overwritten; null if this row created a new record), `write_status`
  (`pending`/`created`/`replaced`/`failed`/`skipped`), `error_message`, `written_at`.
- `data_agent_qa_samples` — one row per record sampled for verification.
  `migration_record_id`, `fetched_ghl_data` (jsonb, re-pulled from GHL),
  `field_comparisons` (jsonb — per mapped field, expected vs. actual, match boolean),
  `match_pct`, `created_at`.
- `data_agent_source_profiles` — global reference data, not per-sub-account.
  `source_system`, `pattern` (a known export column name), `target_field_hint`,
  `subtype_hint` (e.g. `mobile`/`work`/`home` for phone-like patterns), `notes`. Seeded
  with a starter set for Salesforce and HubSpot (Section 6.2); extended over time as real
  client files reveal gaps — not user-editable through the UI in this version.
- `data_agent_chat_messages` — `sub_account`, `user_id`, `message`, `created_at`. One
  thread per sub-account's whole Data Agent workspace (not per-migration).
- `data_agent_prompts` — `migration_id`, `column_mapping_id` (nullable), `user_id`,
  `prompt_text`, `response_text`, `action_taken` (jsonb — what changed, if anything),
  `created_at`.

## 5. Upload Flow

1. User opens "New Migration" from the Dashboard, selects the target object (Contacts,
   or one of the Custom Objects listed from `data_agent_ghl_schema_cache` for that
   location), and optionally selects a source system (Salesforce/HubSpot/other) for
   sharper rule-tier matching.
2. User uploads one CSV file. One object type per upload — a file believed to represent
   Orders is a separate upload from one representing Contacts, never combined.
3. The file is parsed and stored; a `data_agent_migrations` row is created
   (`status: uploaded`), one `data_agent_column_mappings` row is created per column, and
   processing immediately begins (Section 6).

## 6. Mapping Engine

### 6.1 Rules tier (runs first, no API cost)

For each column:

1. Exact/near-exact name match against the target object's schema (standard fields +
   cached custom fields), normalized for case, whitespace, and punctuation.
2. If a source system was selected, check that source's profile (`data_agent_source_profiles`)
   before generic matching — more specific knowledge takes priority (e.g. Salesforce's
   `MobilePhone` maps to phone/mobile even though the raw name wouldn't fuzzy-match GHL's
   `phone` field well on its own).
3. Pattern detection over the column name and its sample values:
   - **Phone/email subtype** (mobile/home/work/fax) from name keywords.
   - **DND channel**: GHL supports per-channel DND (call/email/SMS/etc.), not one flag.
     A column like "Email Opt-Out" maps to the email channel specifically. A generic
     "Do Not Contact" is ambiguous across channels and is routed to the Claude tier
     rather than assumed to mean "all channels."
   - **Country-code presence**: sample phone values are checked for a leading `+`/known
     prefix. Mixed or absent country codes across a column's values are flagged; the
     migration requires an explicit default country code confirmation before any write
     that needs one, never a silent assumption.
4. **Multiple phone/email-like columns for one target**: GHL's contact object has one
   primary `phone` and one primary `email` field. When a file has several phone- or
   email-like columns, the engine proposes a priority order (mobile > work > home) for
   which becomes the primary field, with the rest proposed as custom fields — always
   shown to the user as an explicit choice, never decided silently.
5. A confident rule or source-profile match → **green**, `mapped_by: rule` or
   `source_profile`. Anything else (fuzzy-but-not-exact, multiple tied candidates, no
   match at all) is routed to the Claude tier.

### 6.2 Source-system profiles (starter set, Section 4)

Curated ahead of time, not fetched live from any external site (see the brainstorming
discussion — a live dependency on a third-party docs page during a customer migration
was explicitly rejected as a reliability risk). Starter patterns to seed at launch,
refined as real client files are seen:

- **Salesforce** (standard Contact/Lead object field API names): `FirstName`,
  `LastName`, `Email`, `Phone` → primary, `MobilePhone` → mobile, `HomePhone` → home,
  `OtherPhone` → other, `Fax` → fax (flagged, not auto-mapped to phone), `MailingStreet`,
  `MailingCity`, `MailingState`, `MailingPostalCode`, `MailingCountry`, `DoNotCall` → DND
  (call channel), `HasOptedOutOfEmail` → DND (email channel), `Title`, `Description`,
  `LeadSource`.
- **HubSpot** (standard contact property internal names): `firstname`, `lastname`,
  `email`, `phone` → primary, `mobilephone` → mobile, `company`, `jobtitle`, `address`,
  `city`, `state`, `zip`, `country`, `website`, `hs_email_optout` → DND (email channel),
  `lifecyclestage`, `hs_lead_status`. HubSpot has no single universal standard
  "do-not-call" property across all portals — a call-DND-looking column from HubSpot is
  routed to the Claude tier rather than guessed.

### 6.3 Claude tier (only what the rules tier leaves uncertain)

Given the column name, sample values, the full list of target-object fields (from the
schema cache), and the source profile if any, Claude proposes a target field, a
confidence level, a short reasoning string (shown to the user), and any detected
subtype/DND-channel/country-code metadata.

### 6.4 Status logic — the accuracy gate

- **Green**: a rule or curated source-profile match. Deterministic.
- **Yellow**: any Claude-sourced proposal, *regardless of its reported confidence*. An
  AI suggestion is never auto-promoted to green — a human confirms it, picks a different
  target, or uses the prompt feature to refine it.
- **Red**: neither tier found a plausible match.

**Gate**: a migration cannot leave `mapping` for `awaiting_confirmation` while any
column remains yellow or red. Every column must end up explicitly green (rule- or
user-confirmed) or explicitly marked "ignore this column" by a human before migration
can proceed. Nothing is written to GHL based on an unconfirmed guess.

### 6.5 The prompt feature

Per column, a free-text box (e.g. "map this to custom field D", "this is a mobile
number, just formatted oddly"). Submission invokes an edge function that gives Claude
that column's full context plus the instruction; the response either applies a clear
resulting change directly or returns a clarifying reply — both are logged to
`data_agent_prompts`, including whether a mapping actually changed.

## 7. Migration Execution

Once the gate passes and the user confirms, `status → migrating`. A scheduled
(cron-polled) edge function advances in-progress migrations in bounded batches per tick
— this is a deliberate choice over chained self-invoking functions: a dropped
invocation in a chain can silently stall a migration with nothing to notice and resume
it, whereas a status-table-driven worker is naturally resumable and auditable. The
latency this costs (up to roughly a minute between batches) is irrelevant for a data
migration tool.

For each record in a batch:

1. **Contacts**: call GHL's contact upsert endpoint (GHL dedupes by email/phone within
   the location — we rely on GHL's own matching, not a reimplementation of it).
   **Custom Objects**: look up an existing record by the migration's confirmed
   `match_key_column` value; if found, capture its current field values into
   `pre_replace_snapshot` before proceeding.
2. Build the payload from the confirmed column mappings: standard fields, custom
   fields, tags, the confirmed default country code applied to numbers lacking one, and
   the confirmed DND channel settings.
3. **Replace semantics**: if a match exists, the new row's mapped fields overwrite the
   existing record's values wholesale. This is not a selective merge — the upload is the
   authoritative source for every field it maps; nothing about "only fill blanks" or
   preserving old values in mapped fields.
4. On success: record `ghl_record_id`, `write_status: created` or `replaced`,
   `written_at`. On failure (validation error, rate limit, etc.): record
   `write_status: failed` with the error — this does not abort the batch; other rows
   continue. A `429` specifically triggers backoff and retry on a later tick rather than
   an immediate hard failure.

Once every record reaches a terminal `write_status`, `status → verifying`.

## 8. QA / Accuracy Verification

Randomly sample up to 50 records (or 10% of the total written, whichever is smaller)
from those with `write_status` in (`created`, `replaced`). For each: re-fetch the record
from GHL by its `ghl_record_id`, compare every mapped field's value against what the
original source row + confirmed mapping says it should be, and compute a match
percentage. The migration's `accuracy_rating` is the average across the sample.

This is always informational, visible on the Dashboard. A notably low rating surfaces a
clear warning naming the specific mismatched fields/records for review — it does not
trigger an automatic rollback; reversing a migration is always a deliberate human
decision (Section 9). `status → completed` once verification finishes, regardless of
the rating's value.

## 9. Rollback / Undo

User-triggered, available for as long as the migration record exists.
`status → undoing`, processed by the same worker, walking `data_agent_migration_records`:

- Records with `write_status: created` → delete from GHL (clean undo; nothing existed
  before this migration touched it).
- Records with `write_status: replaced` → restore the field values captured in
  `pre_replace_snapshot`.

`status → undone` once every record is reversed.

## 10. Dashboard

Per sub-account workspace: most recent migration's status and timestamp, aggregate
stats (migrations run, records processed), most recent accuracy rating, the list of
`data_agent_members`, the chat panel (Section 11), and the entry point to start a new
migration (pick target object → upload file → mapping review, Section 5).

## 11. Chat

A message list and input scoped to the sub-account's whole Data Agent workspace (not
per-migration), visible to its `data_agent_members` plus that sub-account's Admin and
Super-Admin. Real-time via Supabase Realtime, matching the `useRealtime` hook pattern
already used elsewhere in this codebase. This is a separate feature from the AI prompt
box (Section 6.5) — one is people talking to each other, the other is a person
instructing the App about a specific mapping decision.

## 12. Access UI Touchpoints

- **Super-Admin**: a new panel to toggle `data_agent_entitlements` per sub-account.
- **Sub-account Admin**: a new "Data Agent" entry in their own Settings (visible only
  when entitled), with a connection form (Section 3) and a team-access list for granting
  `data_agent_members`.
- **Navigation**: a new nav entry, visible only to users who are both in an entitled
  sub-account and are either a `data_agent_members` row or that sub-account's Admin (or
  Super-Admin).

## 13. Secrets & External Dependencies

- GHL Private Integration Token: Supabase Vault, never returned to the browser, read
  only inside edge functions at the moment of an API call.
- Anthropic API key: a Supabase Edge Function secret, used only server-side for the
  Claude-tier mapping calls (Section 6.3) and the prompt feature (Section 6.5). No
  client-side calls to Claude.
- No live fetch to any third-party CRM's documentation or support site at runtime —
  source-system knowledge is the curated, versioned data in Section 6.2, built ahead of
  time and extended deliberately.

## 14. Testing Strategy

- The rules tier (Section 6.1) is pure, deterministic logic given a column name, sample
  values, a source profile, and a target schema — this is the highest-value test
  surface given the accuracy-first requirement, and should have thorough unit coverage:
  exact matches, source-profile matches, phone/email subtype detection, DND-channel
  detection, country-code detection, and the multiple-phone/email priority logic.
- Claude-tier and GHL API calls are mocked in unit/component tests, matching this
  codebase's existing conventions for edge-function calls.
- The write pipeline (Section 7), rollback (Section 9), and QA sampling (Section 8) get
  integration-style tests against a mocked GHL client, covering: successful
  create/replace, partial-batch failure (one row fails, others continue), 429
  backoff/retry, and rollback correctly reversing both created and replaced records.
- Given real external dependencies (GHL, Claude), full end-to-end tests against live
  services aren't practical for CI. Before shipping, this needs manual verification
  against a real sandbox GHL location and a real (non-production) Anthropic key,
  following this project's existing standing practice of browser-testing a feature
  before calling it complete.

## 15. Build Phasing

Comparable in scope to the Projects feature (built earlier in this app across 11
implementation tasks). Expected phases for the implementation plan:

1. Entitlement + Settings (connection) + schema cache.
2. Upload flow + rules-tier mapping engine + review UI — generic to Contacts and Custom
   Objects from the start, since that genericity is cheaper to build in from the
   beginning than to retrofit.
3. Claude-tier integration + the prompt feature.
4. Write pipeline (cron worker, GHL writes, replace semantics, per-object match keys).
5. QA sampling + rollback.
6. Dashboard + chat.
