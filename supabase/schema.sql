-- Вставь этот файл целиком в Supabase → SQL Editor → Run.
-- ВАЖНО: замени 'ТВОЙ-КОД-ПРИГЛАШЕНИЯ' на любое своё слово или фразу и раздай его друзьям.

-- Секретный код приглашения. Без него зарегистрироваться нельзя.
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
insert into public.app_settings (key, value)
values ('invite_code', 'ТВОЙ-КОД-ПРИГЛАШЕНИЯ')
on conflict (key) do update set value = excluded.value;
alter table public.app_settings enable row level security;  -- политик нет: из браузера таблицу не прочитать

-- Проверка кода при регистрации.
create or replace function public.check_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data->>'invite', '') <>
     (select value from public.app_settings where key = 'invite_code') then
    raise exception 'invalid invite code';
  end if;
  return new;
end $$;

drop trigger if exists check_invite_before_signup on auth.users;
create trigger check_invite_before_signup
  before insert on auth.users
  for each row execute function public.check_invite();

-- Профили (имя, которое видят друзья).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null
);
alter table public.profiles enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Библиотека: лайки, статусы, последняя открытая серия.
create table if not exists public.library (
  user_id uuid not null references public.profiles(id) on delete cascade,
  anime_id bigint not null,
  mal_id bigint,
  title text,
  poster text,
  genres text[] default '{}',
  score int,
  episodes int,
  status text check (status in ('watching', 'planned', 'completed', 'dropped')),
  liked boolean not null default false,
  episode int,
  updated_at timestamptz not null default now(),
  primary key (user_id, anime_id)
);
alter table public.library enable row level security;

-- Читать могут все вошедшие (так друзья видят, что смотрят друг у друга), менять — только своё.
drop policy if exists "library read" on public.library;
create policy "library read" on public.library for select to authenticated using (true);
drop policy if exists "library insert own" on public.library;
create policy "library insert own" on public.library for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "library update own" on public.library;
create policy "library update own" on public.library for update to authenticated using (auth.uid() = user_id);
drop policy if exists "library delete own" on public.library;
create policy "library delete own" on public.library for delete to authenticated using (auth.uid() = user_id);
