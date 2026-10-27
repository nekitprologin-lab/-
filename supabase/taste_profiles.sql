-- Профиль вкусов и последние рекомендации: считается на сайте, хранится на аккаунте и открывается мгновенно на любом устройстве.
-- Видит и меняет только сам человек.
create table if not exists public.taste_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  fp text,
  top_genres text[] default '{}',
  weights jsonb default '{}'::jsonb,
  recs jsonb default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.taste_profiles enable row level security;
drop policy if exists "taste own" on public.taste_profiles;
create policy "taste own" on public.taste_profiles for all to authenticated
  using (auth.uid() = user_id and public.is_approved())
  with check (auth.uid() = user_id and public.is_approved());
