-- Migration 20261006000700: import existing project task/comment attachments
-- into project_files (spec §2.3). Idempotent; nothing is moved or deleted.
-- Stored attachment URLs look like
--   https://<ref>.supabase.co/storage/v1/object/sign/task-attachments/<url-encoded path>?token=…
-- The path survives even after the token expired.

create or replace function public.url_decode(p_input text)
  returns text
  language plpgsql immutable
as $$
declare
  v_bytes bytea := ''::bytea;
  i       int := 1;
  n       int := length(p_input);
  ch      text;
begin
  if p_input is null then
    return null;
  end if;
  while i <= n loop
    ch := substr(p_input, i, 1);
    if ch = '%' and i + 2 <= n and substr(p_input, i + 1, 2) ~ '^[0-9A-Fa-f]{2}$' then
      v_bytes := v_bytes || decode(substr(p_input, i + 1, 2), 'hex');
      i := i + 3;
    else
      v_bytes := v_bytes || convert_to(ch, 'UTF8');
      i := i + 1;
    end if;
  end loop;
  return convert_from(v_bytes, 'UTF8');
exception when others then
  return null;
end;
$$;

-- Task-form attachments
insert into public.project_files
  (project_id, folder_id, task_id, bucket, storage_path, name, size_bytes, mime_type, uploaded_by, source, created_at)
select t.project_id, null, t.id, 'task-attachments', p.path,
       left(coalesce(nullif(trim(a->>'name'), ''), p.path), 255),
       case when a->>'size' ~ '^\d{1,15}$' then (a->>'size')::bigint end,
       nullif(a->>'type', ''),
       t.creator_id, 'import', t.created_at
from public.project_tasks t
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(t.attachments) = 'array' then t.attachments else '[]'::jsonb end) a
cross join lateral (
  select public.url_decode(substring(a->>'url' from '/object/sign/task-attachments/([^?]+)')) as path) p
where p.path is not null
  and exists (select 1 from storage.objects o
              where o.bucket_id = 'task-attachments' and o.name = p.path)
on conflict (bucket, storage_path) do nothing;

-- Comment attachments
insert into public.project_files
  (project_id, folder_id, task_id, bucket, storage_path, name, size_bytes, mime_type, uploaded_by, source, created_at)
select t.project_id, null, t.id, 'task-attachments', p.path,
       left(coalesce(nullif(trim(a->>'name'), ''), p.path), 255),
       case when a->>'size' ~ '^\d{1,15}$' then (a->>'size')::bigint end,
       nullif(a->>'type', ''),
       c.user_id, 'import', c.created_at
from public.project_task_comments c
join public.project_tasks t on t.id = c.project_task_id
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(c.attachments) = 'array' then c.attachments else '[]'::jsonb end) a
cross join lateral (
  select public.url_decode(substring(a->>'url' from '/object/sign/task-attachments/([^?]+)')) as path) p
where p.path is not null
  and exists (select 1 from storage.objects o
              where o.bucket_id = 'task-attachments' and o.name = p.path)
on conflict (bucket, storage_path) do nothing;
