-- Minimal storage schema mimicking Supabase Storage tables (for policies tests / local e2e).
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key, name text not null unique, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid, owner_id text,
  metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create policy buckets_read on storage.buckets for select to anon, authenticated using (true);
grant select on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant select on storage.objects to anon;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
