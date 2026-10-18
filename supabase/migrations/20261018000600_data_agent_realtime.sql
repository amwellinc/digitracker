-- Migration 20261018000600: Data Agent — enable Realtime for this
-- feature's three useRealtime()-subscribed tables. Wrapped in DO/EXCEPTION
-- (idempotent-safe re-run) matching this codebase's own more recent
-- realtime-publication migrations, not the older bare-ALTER form.
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.data_agent_column_mappings; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.data_agent_migrations; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.data_agent_chat_messages; EXCEPTION WHEN OTHERS THEN NULL; END $$;
