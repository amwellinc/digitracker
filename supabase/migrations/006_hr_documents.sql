-- Extend document types to cover all HR document categories
alter table public.documents
  drop constraint if exists documents_type_check;
alter table public.documents
  add constraint documents_type_check
  check (type in ('Medical','Employment','HR','ID','Certificate','Contract','Performance','Standard','Other'));

-- Optional description field
alter table public.documents
  add column if not exists description text;

-- Storage: allow admin/manager to upload documents for any user's folder
drop policy if exists "documents_upload" on storage.objects;
create policy "documents_upload" on storage.objects
  for insert with check (
    bucket_id = 'documents' and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.auth_user_role() in ('Super-admin', 'Manager')
    )
  );

-- Storage: allow admin/manager to read (generate signed URLs for) any document
drop policy if exists "documents_read" on storage.objects;
create policy "documents_read" on storage.objects
  for select using (
    bucket_id = 'documents' and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.auth_user_role() in ('Super-admin', 'Manager')
    )
  );

-- Storage: allow admin/manager to delete any document file
drop policy if exists "documents_delete" on storage.objects;
create policy "documents_delete" on storage.objects
  for delete using (
    bucket_id = 'documents' and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.auth_user_role() in ('Super-admin', 'Manager')
    )
  );

-- Enable Realtime for documents
do $$ begin
  alter publication supabase_realtime add table public.documents;
exception when others then null;
end $$;
