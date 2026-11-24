-- =====================================================================
-- Mapa PV – role (administrator / menedżer / handlowiec) i tereny
-- Uruchom w Supabase → SQL Editor PRZED wgraniem nowych plików aplikacji.
-- Skrypt można uruchomić ponownie – nie usuwa ani nie zmienia pinezek.
-- =====================================================================

-- ---------- 1. Profile użytkowników: rola i hierarchia ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  imie       text,
  rola       text not null default 'handlowiec' check (rola in ('admin', 'manager', 'handlowiec')),
  manager_id uuid references public.profiles(id) on delete set null,
  utworzono  timestamptz not null default now()
);

-- Konta, które istnieją dziś, zostają administratorami (zachowują pełny dostęp jak dotąd).
insert into public.profiles (id, email, rola)
select id, email, 'admin' from auth.users
on conflict (id) do nothing;

-- Każde nowe konto dodane w panelu Supabase dostaje profil „handlowiec” bez menedżera
-- (czyli nie widzi nic, dopóki administrator nie nada mu roli/menedżera, a menedżer terenu).
create or replace function public.pv_nowy_uzytkownik() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, rola) values (new.id, new.email, 'handlowiec')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists pv_nowy_uzytkownik on auth.users;
create trigger pv_nowy_uzytkownik after insert on auth.users
  for each row execute function public.pv_nowy_uzytkownik();

-- ---------- 2. Tereny: wielokąty narysowane na mapie ----------
-- poly = [[lat, lon], [lat, lon], ...]  (co najmniej 3 punkty)
create table if not exists public.tereny (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles(id) on delete cascade,  -- komu przydzielony
  nazwa     text,
  poly      jsonb not null,
  min_lat   double precision, max_lat double precision,
  min_lon   double precision, max_lon double precision,
  utworzyl  uuid default auth.uid(),
  utworzono timestamptz not null default now()
);
create index if not exists tereny_user_id on public.tereny (user_id);

create or replace function public.pv_teren_bbox() returns trigger
language plpgsql as $$
begin
  if jsonb_typeof(new.poly) is distinct from 'array' or jsonb_array_length(new.poly) < 3 then
    raise exception 'Teren musi mieć co najmniej 3 punkty';
  end if;
  select min((p->>0)::float8), max((p->>0)::float8), min((p->>1)::float8), max((p->>1)::float8)
    into new.min_lat, new.max_lat, new.min_lon, new.max_lon
    from jsonb_array_elements(new.poly) p;
  return new;
end $$;
drop trigger if exists pv_teren_bbox on public.tereny;
create trigger pv_teren_bbox before insert or update of poly on public.tereny
  for each row execute function public.pv_teren_bbox();

-- ---------- 3. Funkcje pomocnicze ----------
-- Czy punkt leży w wielokącie (algorytm promienia).
create or replace function public.pv_w_wielokacie(p_lat float8, p_lon float8, poly jsonb) returns boolean
language plpgsql immutable as $$
declare n int := jsonb_array_length(poly); i int; j int; ins boolean := false;
        yi float8; xi float8; yj float8; xj float8;
begin
  if n < 3 then return false; end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (poly->i->>0)::float8; xi := (poly->i->>1)::float8;
    yj := (poly->j->>0)::float8; xj := (poly->j->>1)::float8;
    if ((yi > p_lat) <> (yj > p_lat)) and (p_lon < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
      ins := not ins;
    end if;
    j := i;
  end loop;
  return ins;
end $$;

-- Czy punkt leży w którymkolwiek terenie danego użytkownika.
create or replace function public.pv_w_terenie(p_user uuid, p_lat float8, p_lon float8) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tereny t
    where t.user_id = p_user
      and p_lat between t.min_lat and t.max_lat
      and p_lon between t.min_lon and t.max_lon
      and public.pv_w_wielokacie(p_lat, p_lon, t.poly));
$$;

-- Rola zalogowanego użytkownika.
create or replace function public.pv_rola() returns text
language sql stable security definer set search_path = public as $$
  select rola from public.profiles where id = auth.uid();
$$;

-- Czy zalogowany użytkownik widzi pinezkę w tym miejscu.
--   admin      – wszystko
--   menedżer   – tylko w swoim terenie (przydzielonym przez administratora)
--   handlowiec – tylko w swoim terenie ORAZ w terenie swojego menedżera
create or replace function public.pv_widzi(p_lat float8, p_lon float8) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text; m uuid; u uuid := auth.uid();
begin
  select rola, manager_id into r, m from public.profiles where id = u;
  if r = 'admin' then return true; end if;
  if r = 'manager' then return public.pv_w_terenie(u, p_lat, p_lon); end if;
  if r = 'handlowiec' then
    return m is not null and public.pv_w_terenie(u, p_lat, p_lon) and public.pv_w_terenie(m, p_lat, p_lon);
  end if;
  return false;
end $$;

-- Czy zalogowany użytkownik może zarządzać danym kontem (przydzielać mu tereny).
--   admin – każdym; menedżer – tylko swoimi handlowcami.
create or replace function public.pv_moze_zarzadzac(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.pv_rola()
    when 'admin' then true
    when 'manager' then exists (select 1 from public.profiles
                                where id = p_user and rola = 'handlowiec' and manager_id = auth.uid())
    else false end;
$$;

-- ---------- 4. Pinezki: autor zmian i ochrona pól ----------
alter table public.pins add column if not exists zmienil uuid references auth.users(id) on delete set null;

-- Menedżer i handlowiec mogą zmieniać tylko status, „jest/nie ma PV” i notatkę.
-- Nie mogą „usunąć” pinezki (status 'usun'). Zapytania z SQL Editora (bez zalogowanego
-- użytkownika) i konto administratora nie są ograniczane.
create or replace function public.pv_pins_straznik() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then
    if public.pv_rola() is distinct from 'admin' then
      if (new.id, new.adres, new.miejscowosc, new.gmina, new.lat, new.lon, new.zrodlo,
          new.pewnosc, new.wynik, new.obszar)
         is distinct from
         (old.id, old.adres, old.miejscowosc, old.gmina, old.lat, old.lon, old.zrodlo,
          old.pewnosc, old.wynik, old.obszar) then
        raise exception 'Brak uprawnień do zmiany danych pinezki';
      end if;
      if new.status = 'usun' and old.status is distinct from 'usun' then
        raise exception 'Brak uprawnień do usuwania pinezek';
      end if;
    end if;
    new.zmienil := auth.uid();
  elsif tg_op = 'INSERT' and new.zrodlo = 'reczne' then
    new.zmienil := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists pv_pins_straznik on public.pins;
create trigger pv_pins_straznik before insert or update on public.pins
  for each row execute function public.pv_pins_straznik();

-- ---------- 5. Reguły dostępu (RLS) ----------
alter table public.pins     enable row level security;
alter table public.profiles enable row level security;
alter table public.tereny   enable row level security;

-- usuń dotychczasowe reguły tabel (stare „każdy zalogowany może wszystko”)
do $$ declare r record; begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('pins', 'profiles', 'tereny') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- pins
create policy pins_select on public.pins for select to authenticated
  using ((select public.pv_rola()) = 'admin'
         or (status is distinct from 'usun' and public.pv_widzi(lat, lon)));
create policy pins_insert on public.pins for insert to authenticated
  with check ((select public.pv_rola()) = 'admin'
              or (zrodlo = 'reczne' and status is distinct from 'usun' and public.pv_widzi(lat, lon)));
create policy pins_update on public.pins for update to authenticated
  using ((select public.pv_rola()) = 'admin'
         or (status is distinct from 'usun' and public.pv_widzi(lat, lon)))
  with check ((select public.pv_rola()) = 'admin' or public.pv_widzi(lat, lon));
create policy pins_delete on public.pins for delete to authenticated
  using ((select public.pv_rola()) = 'admin');

-- profiles: każdy widzi siebie, menedżer swoich handlowców, admin wszystkich; zmienia tylko admin
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or manager_id = (select auth.uid()) or (select public.pv_rola()) = 'admin');
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.pv_rola()) = 'admin') with check ((select public.pv_rola()) = 'admin');

-- tereny: widzi właściciel i ten, kto nim zarządza; przydziela admin (każdemu) i menedżer (swoim handlowcom)
create policy tereny_select on public.tereny for select to authenticated
  using (user_id = (select auth.uid()) or public.pv_moze_zarzadzac(user_id));
create policy tereny_insert on public.tereny for insert to authenticated
  with check (public.pv_moze_zarzadzac(user_id));
create policy tereny_update on public.tereny for update to authenticated
  using (public.pv_moze_zarzadzac(user_id)) with check (public.pv_moze_zarzadzac(user_id));
create policy tereny_delete on public.tereny for delete to authenticated
  using (public.pv_moze_zarzadzac(user_id));

grant select, insert, update, delete on public.pins to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.tereny to authenticated;
revoke all on public.pins, public.profiles, public.tereny from anon;

-- Sprawdzenie: lista kont i ich ról
select email, imie, rola, manager_id from public.profiles order by rola, email;
