-- ============================================================================
-- TheAgriDoctor — complete database setup (single source of truth)
--
-- HOW TO USE: Supabase Dashboard → SQL Editor → New query → paste this whole
-- file → Run. Safe to re-run (idempotent).
--
-- Security model: Row Level Security (RLS) is ON for every table. The browser
-- holds only the public "anon/publishable" key, so these policies are what
-- guarantee each farmer can read and change ONLY their own data.
--   • Private per user : users, farms, crop_cycles, crop_tasks, diagnoses,
--                        chat_sessions, chat_messages, notifications
--   • Shared (read)    : community_posts, community_replies (any signed-in user)
--   • Shared (derived) : disease heatmap via disease_heatmap() — anonymised,
--                        locations rounded to ~1 km, no user ids exposed
-- ============================================================================

create extension if not exists pgcrypto;

-- ─── 1. Users (profile; 1-to-1 with auth.users) ──────────────────────────────
create table if not exists public.users (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text,
  phone              text,
  state              text,
  district           text,
  preferred_language text default 'English',
  alert_preferences  jsonb,
  created_at         timestamptz not null default now()
);

-- ─── 2. Farms ────────────────────────────────────────────────────────────────
create table if not exists public.farms (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.users(id) on delete cascade,
  name                    text not null,
  total_area_acres        numeric,
  lat                     double precision check (lat between -90 and 90),
  lng                     double precision check (lng between -180 and 180),
  soil_type               text,
  water_source            text,
  agro_polygon_id         text,
  polygon_geojson         jsonb,
  polygon_area_ha         numeric,
  polygon_radius_m        integer,
  last_scan_at            timestamptz,
  latest_monitor_snapshot jsonb,
  created_at              timestamptz not null default now()
);

-- ─── 3. Crop cycles ──────────────────────────────────────────────────────────
create table if not exists public.crop_cycles (
  id                    uuid primary key default gen_random_uuid(),
  farm_id               uuid not null references public.farms(id) on delete cascade,
  crop_name             text not null,
  variety               text,
  sown_date             date,
  expected_harvest_date date,
  growth_stage          text not null default 'seedling'
                        check (growth_stage in ('seedling','vegetative','flowering','fruiting','harvest','harvested')),
  status                text not null default 'active' check (status in ('active','harvested','failed')),
  created_at            timestamptz not null default now()
);

-- ─── 4. Crop tasks (manual + AI-generated) ───────────────────────────────────
create table if not exists public.crop_tasks (
  id            uuid primary key default gen_random_uuid(),
  crop_cycle_id uuid not null references public.crop_cycles(id) on delete cascade,
  task_name     text not null,
  description   text,
  category      text check (category in ('irrigation','fertilization','pest','weeding','monitoring','harvest','other')),
  priority      text default 'medium' check (priority in ('low','medium','high')),
  status        text not null default 'pending' check (status in ('pending','done','skipped')),
  due_date      date,
  ai_generated  boolean not null default false,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- ─── 5. Diagnoses ────────────────────────────────────────────────────────────
-- image_urls holds Storage PATHS ("<user_id>/<file>.jpg"); the app signs them on view.
create table if not exists public.diagnoses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  crop_type        text not null,
  image_urls       text[] not null default '{}',
  disease_name     text,
  confidence_pct   numeric check (confidence_pct between 0 and 100),
  severity         text check (severity in ('low','medium','high','critical')),
  full_report_json jsonb,
  status           text not null default 'open' check (status in ('open','resolved')),
  ai_model         text,  -- which AI vision model produced the report
  created_at       timestamptz not null default now()
);

-- ─── 6–7. Advisor chat ───────────────────────────────────────────────────────
create table if not exists public.chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null default 'New Conversation',
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  model      text,  -- which AI model wrote an assistant reply (shown as "via …")
  created_at timestamptz not null default now()
);

-- ─── 8–9. Community forum ────────────────────────────────────────────────────
-- author_name is filled by a trigger from the author's profile, so names can be
-- shown publicly without making the private users table readable to everyone.
create table if not exists public.community_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  author_name text,
  title       text not null check (char_length(title) <= 200),
  body        text not null check (char_length(body) <= 5000),
  crop_tag    text,
  tags        text[] not null default '{}',
  image_urls  text[] not null default '{}',
  upvotes     integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.community_replies (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.community_posts(id) on delete cascade,
  user_id     uuid references public.users(id) on delete cascade,  -- null for AI replies
  author_name text,
  is_ai       boolean not null default false,
  content     text not null check (char_length(content) <= 5000),
  upvotes     integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint ai_or_human check ((is_ai and user_id is null) or (not is_ai and user_id is not null))
);

-- ─── 10. Notifications (field alerts etc.) ───────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       text not null default 'info',   -- e.g. info | alert_warning | alert_critical
  title      text not null,
  message    text,
  metadata   jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Columns added after the first release (no-ops on a fresh database).
alter table public.chat_messages add column if not exists model text;
alter table public.diagnoses     add column if not exists ai_model text;

-- ─── Indexes (every foreign key + the app's hot queries) ─────────────────────
create index if not exists idx_farms_user            on public.farms(user_id, created_at);
create index if not exists idx_crop_cycles_farm      on public.crop_cycles(farm_id);
create index if not exists idx_crop_tasks_cycle      on public.crop_tasks(crop_cycle_id, due_date);
create index if not exists idx_diagnoses_user        on public.diagnoses(user_id, created_at desc);
create index if not exists idx_diagnoses_created     on public.diagnoses(created_at desc);
create index if not exists idx_chat_sessions_user    on public.chat_sessions(user_id, created_at desc);
create index if not exists idx_chat_messages_session on public.chat_messages(session_id, created_at desc);
create index if not exists idx_posts_created         on public.community_posts(created_at desc);
create index if not exists idx_posts_user            on public.community_posts(user_id);
create index if not exists idx_replies_post          on public.community_replies(post_id, created_at);
create index if not exists idx_replies_user          on public.community_replies(user_id);
create index if not exists idx_notifications_user    on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread  on public.notifications(user_id) where read_at is null;

-- ─── Triggers ────────────────────────────────────────────────────────────────
-- Create the profile row automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.users (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stamp author_name from the author's own profile (cannot be spoofed by the client).
create or replace function public.set_author_name()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- to_jsonb(new) works for both tables (community_posts has no is_ai column).
  if coalesce((to_jsonb(new) ->> 'is_ai')::boolean, false) then
    new.author_name := 'AgriDoctor AI';
  else
    select coalesce(nullif(u.full_name, ''), 'Farmer') into new.author_name
    from public.users u where u.id = new.user_id;
    new.author_name := coalesce(new.author_name, 'Farmer');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_posts_author on public.community_posts;
create trigger trg_posts_author before insert on public.community_posts
  for each row execute function public.set_author_name();

drop trigger if exists trg_replies_author on public.community_replies;
create trigger trg_replies_author before insert on public.community_replies
  for each row execute function public.set_author_name();

-- ─── Row Level Security ──────────────────────────────────────────────────────
alter table public.users             enable row level security;
alter table public.farms             enable row level security;
alter table public.crop_cycles       enable row level security;
alter table public.crop_tasks        enable row level security;
alter table public.diagnoses         enable row level security;
alter table public.chat_sessions     enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.community_posts   enable row level security;
alter table public.community_replies enable row level security;
alter table public.notifications     enable row level security;

-- Helper: drop a policy if it exists (keeps the script re-runnable).
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('users','farms','crop_cycles','crop_tasks','diagnoses','chat_sessions',
                        'chat_messages','community_posts','community_replies','notifications')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- (select auth.uid()) is evaluated once per query instead of once per row.

-- Own profile only
create policy users_select_own on public.users for select to authenticated using (id = (select auth.uid()));
create policy users_insert_own on public.users for insert to authenticated with check (id = (select auth.uid()));
create policy users_update_own on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Directly owned rows
create policy farms_own on public.farms for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy diagnoses_own on public.diagnoses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chat_sessions_own on public.chat_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_own on public.notifications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Rows owned through a parent
create policy crop_cycles_own on public.crop_cycles for all to authenticated
  using (exists (select 1 from public.farms f where f.id = farm_id and f.user_id = (select auth.uid())))
  with check (exists (select 1 from public.farms f where f.id = farm_id and f.user_id = (select auth.uid())));

create policy crop_tasks_own on public.crop_tasks for all to authenticated
  using (exists (select 1 from public.crop_cycles c join public.farms f on f.id = c.farm_id
                 where c.id = crop_cycle_id and f.user_id = (select auth.uid())))
  with check (exists (select 1 from public.crop_cycles c join public.farms f on f.id = c.farm_id
                      where c.id = crop_cycle_id and f.user_id = (select auth.uid())));

create policy chat_messages_own on public.chat_messages for all to authenticated
  using (exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
  with check (exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = (select auth.uid())));

-- Community: everyone signed in can read; you can only write/delete as yourself.
-- No UPDATE policies: posts/replies are immutable from the client (protects upvote counts).
create policy posts_read on public.community_posts for select to authenticated using (true);
create policy posts_insert_own on public.community_posts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy posts_delete_own on public.community_posts for delete to authenticated
  using (user_id = (select auth.uid()));

create policy replies_read on public.community_replies for select to authenticated using (true);
-- Humans only. AI replies are written by the server with the service-role key, which bypasses RLS.
create policy replies_insert_own on public.community_replies for insert to authenticated
  with check (user_id = (select auth.uid()) and is_ai = false);
create policy replies_delete_own on public.community_replies for delete to authenticated
  using (user_id = (select auth.uid()));

-- Anonymous (logged-out) visitors get nothing.
revoke all on all tables in schema public from anon;

-- ─── Disease heatmap (privacy-preserving, cross-farmer) ──────────────────────
-- Returns anonymised outbreak points: no user ids, farm location rounded to
-- 2 decimals (~1 km). Each diagnosis is placed at its owner's first farm.
create or replace function public.disease_heatmap(p_days integer default 90, p_crop text default null)
returns table (
  id uuid, lat double precision, lng double precision, crop_type text, disease_name text,
  severity text, status text, created_at timestamptz, is_mine boolean
)
language sql stable security definer set search_path = ''
as $$
  select d.id,
         round(f.lat::numeric, 2)::double precision,
         round(f.lng::numeric, 2)::double precision,
         d.crop_type, d.disease_name, d.severity, d.status, d.created_at,
         d.user_id = (select auth.uid())
  from public.diagnoses d
  join lateral (
    select fa.lat, fa.lng from public.farms fa
    where fa.user_id = d.user_id and fa.lat is not null and fa.lng is not null
    order by fa.created_at limit 1
  ) f on true
  where (select auth.uid()) is not null
    and d.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 90), 1), 730))
    and (p_crop is null or d.crop_type ilike '%' || replace(replace(p_crop, '%', ''), '_', '') || '%')
  order by d.created_at desc
  limit 1000;
$$;

revoke all on function public.disease_heatmap(integer, text) from public, anon;
grant execute on function public.disease_heatmap(integer, text) to authenticated;

-- ─── Storage: private bucket for diagnosis photos ────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diagnosis-images', 'diagnosis-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "diagnosis images: upload own"  on storage.objects;
drop policy if exists "diagnosis images: read own"    on storage.objects;
drop policy if exists "diagnosis images: delete own"  on storage.objects;

-- Files live under "<user_id>/…": each user can only touch their own folder.
create policy "diagnosis images: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'diagnosis-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "diagnosis images: read own" on storage.objects for select to authenticated
  using (bucket_id = 'diagnosis-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "diagnosis images: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'diagnosis-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ─── Verify: every table should show rls_enabled = true ──────────────────────
select tablename, rowsecurity as rls_enabled
from pg_tables where schemaname = 'public' order by tablename;
