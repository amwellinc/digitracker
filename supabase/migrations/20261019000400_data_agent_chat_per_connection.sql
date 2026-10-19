-- Migration 20261019000400: Data Agent — scope team chat per connection
-- ("folder"), not per sub-account.
--
-- A sub-account can now run several GHL connections/migration projects in
-- parallel (20261019000300). Team chat was still one shared thread for
-- the whole sub-account, so messages about different GHL accounts/
-- projects blended together with no way to tell them apart. Adding
-- connection_id lets each connection ("folder") have its own chat thread.
--
-- RLS is unaffected: data_agent_chat_messages_select/insert already gate
-- on the sub_account column directly (not a join), and that column stays
-- exactly as-is — this only adds a column to filter by, on top of the
-- same existing access check.
alter table public.data_agent_chat_messages add column connection_id uuid references public.data_agent_connections(id) on delete cascade;
create index data_agent_chat_messages_connection_idx on public.data_agent_chat_messages (connection_id, created_at);
-- Existing messages predate the per-connection split and aren't
-- attributable to any single GHL account — left with connection_id null;
-- they simply won't surface in any folder's chat going forward.
