-- Allow users to overwrite their own avatar (upsert support)
drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update" on storage.objects
  for update using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- Allow Super-admin and Manager to create signed URLs for screenshots
-- (Screenshots bucket remains private; signed URLs are generated at upload time)
-- No policy change needed — createSignedUrl uses the service role key server-side
-- or the authenticated user's token via supabase-js client.
-- The existing screenshots_read policy already allows Super-admin/Manager SELECT.
