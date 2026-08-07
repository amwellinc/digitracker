-- Migration 049: Company message board.
--
-- One board per sub-account. Admin (and Super-Admin, any sub-account) can
-- post; every active member of that sub-account can read. Scoped with the
-- same sub_account-column-direct-compare pattern as platform_settings/
-- department_managers — this table has no user_id to join through, so
-- same_sub_account_as_caller doesn't apply; auth_user_sub_account() is
-- compared directly instead.
--
-- Images live in a public bucket (like avatars) rather than the private,
-- signed-URL pattern used for task attachments: a post with no end date is
-- meant to stay visible indefinitely, and a signed URL with a fixed expiry
-- would quietly break its images long before the post itself expires.

create table public.message_board_posts (
  id          uuid primary key default gen_random_uuid(),
  sub_account text not null,
  subject     text not null,
  content     text not null,
  images      jsonb not null default '[]'::jsonb,
  posted_by   uuid references public.users(id) on delete set null,
  posted_at   timestamptz not null default now(),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index message_board_posts_sub_account_idx
  on public.message_board_posts (sub_account, posted_at desc);

alter table public.message_board_posts enable row level security;

create policy "message_board_posts_select" on public.message_board_posts
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or sub_account = public.auth_user_sub_account()
  );

create policy "message_board_posts_insert" on public.message_board_posts
  for insert with check (
    posted_by = public.auth_user_app_id()
    and (
      public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
    )
  );

create policy "message_board_posts_update" on public.message_board_posts
  for update using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

create policy "message_board_posts_delete" on public.message_board_posts
  for delete using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

-- ── Storage: message-board-images (public bucket, like avatars) ────────────

insert into storage.buckets (id, name, public)
values ('message-board-images', 'message-board-images', true)
on conflict (id) do nothing;

create policy "message_board_images_public_read" on storage.objects
  for select using (bucket_id = 'message-board-images');

create policy "message_board_images_upload" on storage.objects
  for insert with check (
    bucket_id = 'message-board-images'
    and (public.auth_user_role() = 'Admin' or public.auth_user_role() = 'Super-Admin')
  );

create policy "message_board_images_delete" on storage.objects
  for delete using (
    bucket_id = 'message-board-images'
    and (public.auth_user_role() = 'Admin' or public.auth_user_role() = 'Super-Admin')
  );

-- ── Realtime: new/edited posts show up live without a manual refresh ───────

alter table public.message_board_posts replica identity full;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.message_board_posts; EXCEPTION WHEN OTHERS THEN NULL; END $$;

notify pgrst, 'reload schema';
