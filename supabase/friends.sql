-- ======= Друзья: заявки + видимость активности только друзьям =======
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);
alter table public.friendships enable row level security;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  )
$$;

drop policy if exists "fr read" on public.friendships;
create policy "fr read" on public.friendships for select to authenticated
  using (public.is_approved() and (requester = auth.uid() or addressee = auth.uid()));
drop policy if exists "fr insert" on public.friendships;
create policy "fr insert" on public.friendships for insert to authenticated
  with check (public.is_approved() and requester = auth.uid() and status = 'pending');
drop policy if exists "fr accept" on public.friendships;
create policy "fr accept" on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid());
drop policy if exists "fr delete" on public.friendships;
create policy "fr delete" on public.friendships for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- Библиотеку видят только владелец и его друзья (раньше — все одобренные).
drop policy if exists "library read" on public.library;
create policy "library read" on public.library for select to authenticated
  using (public.is_approved() and (user_id = auth.uid() or public.are_friends(auth.uid(), user_id)));
