-- Minimal auth schema for pure-SQL tests (Supabase Auth/GoTrue creates the real one).
create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
-- ตาราง identities แบบเดียวกับ Supabase Auth (สำหรับทดสอบ trigger จำกัดโดเมน)
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  last_sign_in_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (provider_id, provider)
);
