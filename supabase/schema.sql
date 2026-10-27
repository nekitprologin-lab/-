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

-- Проверка кода при регистрации по почте. Вход через Google код не спрашивает, но такой человек
-- остаётся «не одобренным» (profiles.approved = false), пока не введёт код на сайте (функция redeem_invite ниже).
create or replace function public.check_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data->>'provider', 'email') = 'email' then
    if coalesce(new.raw_user_meta_data->>'invite', '') <>
       (select value from public.app_settings where key = 'invite_code') then
      raise exception 'invalid invite code';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists check_invite_before_signup on auth.users;
create trigger check_invite_before_signup
  before insert on auth.users
  for each row execute function public.check_invite();

-- Профили (имя, которое видят друзья; approved = человек ввёл код приглашения).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  approved boolean not null default true
);
alter table public.profiles add column if not exists approved boolean not null default true;
alter table public.profiles enable row level security;

-- Одобрен ли тот, кто сейчас делает запрос.
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false)
$$;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_approved());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_app_meta_data->>'provider', 'email') = 'email'  -- по почте код уже проверен
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ввод кода приглашения после входа через Google.
create or replace function public.redeem_invite(code text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if code = (select value from public.app_settings where key = 'invite_code') then
    update public.profiles set approved = true where id = auth.uid();
    return true;
  end if;
  return false;
end $$;
grant execute on function public.redeem_invite(text) to authenticated;

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

-- Читать могут все одобренные (так друзья видят, что смотрят друг у друга), менять — только своё.
drop policy if exists "library read" on public.library;
create policy "library read" on public.library for select to authenticated using (public.is_approved());
drop policy if exists "library insert own" on public.library;
create policy "library insert own" on public.library for insert to authenticated with check (auth.uid() = user_id and public.is_approved());
drop policy if exists "library update own" on public.library;
create policy "library update own" on public.library for update to authenticated using (auth.uid() = user_id and public.is_approved());
drop policy if exists "library delete own" on public.library;
create policy "library delete own" on public.library for delete to authenticated using (auth.uid() = user_id and public.is_approved());

-- История просмотра: каждая открытая серия, видна только самому человеку.
create table if not exists public.history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  anime_id bigint not null,
  episode int not null,
  title text,
  poster text,
  watched_at timestamptz not null default now(),
  primary key (user_id, anime_id, episode)
);
alter table public.history add column if not exists position_sec integer;
alter table public.history add column if not exists source text;
alter table public.history enable row level security;
drop policy if exists "history own" on public.history;
create policy "history own" on public.history for all to authenticated
  using (auth.uid() = user_id and public.is_approved())
  with check (auth.uid() = user_id and public.is_approved());

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
