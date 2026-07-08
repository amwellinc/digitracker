-- Add country and phone to users table
-- country ties the user to the correct public holiday set
alter table public.users
  add column if not exists country text not null default 'SG'
    check (country in ('SG', 'MY', 'PH')),
  add column if not exists phone text;
