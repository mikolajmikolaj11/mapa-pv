-- =====================================================================
-- Mapa PV – zmiany z 24.11.2026, część 3 (uruchom PO skrypcie 04, PRZED wgraniem nowej aplikacji)
--  1. autor_statusu: kto nadał obecny status (lead / spotkanie / umowa …). Ustawia go baza przy
--     każdej zmianie statusu – na tej podstawie menedżer i administrator widzą wyniki poszczególnych osób.
--  2. Spotkanie umówione wymaga terminu (żeby trafiło do grafiku).
--  3. Śledzenie: tabela pozycje (GPS menedżerów i handlowców, wysyłane z otwartej aplikacji).
--     Widzi: każdy siebie, menedżer swoich handlowców, administrator wszystkich.
-- Skrypt można uruchomić ponownie.
-- =====================================================================

-- ---------- 1. Autor statusu ----------
alter table public.pins add column if not exists autor_statusu uuid references auth.users(id) on delete set null;
-- dla istniejących statusów: najlepsze przybliżenie to ostatnia osoba, która zmieniała pinezkę
update public.pins set autor_statusu = zmienil where status is not null and autor_statusu is null;

-- ---------- 2. Strażnik pinezek (jak w 04 + autor statusu + wymagany termin spotkania) ----------
create or replace function public.pv_pins_straznik() returns trigger
language plpgsql security definer set search_path = public as $$
declare pusty constant text := '';
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor: bez ograniczeń

  if tg_op = 'UPDATE' and public.pv_rola() is distinct from 'admin' then
    if (new.id, new.adres, new.miejscowosc, new.gmina, new.lat, new.lon, new.zrodlo,
        new.pewnosc, new.wynik, new.obszar, new.ukryta_admin)
       is distinct from
       (old.id, old.adres, old.miejscowosc, old.gmina, old.lat, old.lon, old.zrodlo,
        old.pewnosc, old.wynik, old.obszar, old.ukryta_admin) then
      raise exception 'Brak uprawnień do zmiany danych pinezki';
    end if;
    if new.status in ('usun', 'potencjal') and old.status is distinct from new.status then
      raise exception 'Brak uprawnień do tego statusu';
    end if;
  end if;

  -- wymagane dane klienta (sprawdzane, gdy zmienia się status albo dane klienta)
  if new.status in ('lead', 'spotkanie', 'umowa') and (
       tg_op = 'INSERT' or old.status is distinct from new.status
       or (new.klient_imie, new.klient_nazwisko, new.klient_telefon, new.produkt, new.termin)
          is distinct from (old.klient_imie, old.klient_nazwisko, old.klient_telefon, old.produkt, old.termin)
       or (new.status in ('lead', 'spotkanie') and new.notatka is distinct from old.notatka)) then
    if coalesce(btrim(new.klient_imie), pusty) = pusty then
      raise exception 'Wpisz imię klienta';
    end if;
    if new.status in ('lead', 'spotkanie') then
      if length(regexp_replace(coalesce(new.klient_telefon, pusty), '\D', '', 'g')) < 9 then
        raise exception 'Wpisz numer telefonu klienta (co najmniej 9 cyfr)';
      end if;
      if coalesce(btrim(new.notatka), pusty) = pusty then
        raise exception 'Wpisz notatkę';
      end if;
      if new.status = 'spotkanie' and new.termin is null then
        raise exception 'Wpisz termin spotkania';
      end if;
    else
      if coalesce(btrim(new.klient_nazwisko), pusty) = pusty then
        raise exception 'Wpisz nazwisko klienta';
      end if;
      if coalesce(btrim(new.produkt), pusty) = pusty then
        raise exception 'Wpisz sprzedany produkt';
      end if;
    end if;
  end if;

  -- autor statusu: zmienia się tylko razem ze statusem (nie da się go podrobić z aplikacji)
  if tg_op = 'INSERT' then
    new.autor_statusu := case when new.status is not null then auth.uid() end;
  elsif new.status is distinct from old.status then
    new.autor_statusu := case when new.status is not null then auth.uid() end;
  else
    new.autor_statusu := old.autor_statusu;
  end if;

  if tg_op = 'UPDATE' then
    new.zmienil := auth.uid();
  elsif new.zrodlo = 'reczne' then
    new.zmienil := auth.uid();
  end if;
  return new;
end $$;

-- ---------- 3. Śledzenie ----------
create table if not exists public.pozycje (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  lat         double precision not null,
  lon         double precision not null,
  dokladnosc  real,                                   -- metry (z telefonu)
  czas        timestamptz not null default now()
);
create index if not exists pozycje_user_czas on public.pozycje (user_id, czas desc);

alter table public.pozycje enable row level security;
drop policy if exists pozycje_insert on public.pozycje;
drop policy if exists pozycje_select on public.pozycje;
-- zapisuje tylko menedżer i handlowiec, wyłącznie własną pozycję
create policy pozycje_insert on public.pozycje for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.pv_rola()) in ('manager', 'handlowiec'));
-- widzi: siebie; menedżer – swoich handlowców; administrator – wszystkich (pv_moze_zarzadzac)
create policy pozycje_select on public.pozycje for select to authenticated
  using (user_id = (select auth.uid()) or public.pv_moze_zarzadzac(user_id));
grant select, insert on public.pozycje to authenticated;
revoke all on public.pozycje from anon;

-- Ostatnia znana pozycja każdej widocznej osoby (z ostatnich 7 dni) – działa z uprawnieniami wołającego.
create or replace function public.pv_ostatnie_pozycje()
returns table (user_id uuid, lat double precision, lon double precision, dokladnosc real, czas timestamptz)
language sql stable security invoker set search_path = public as $$
  select distinct on (p.user_id) p.user_id, p.lat, p.lon, p.dokladnosc, p.czas
  from public.pozycje p
  where p.czas > now() - interval '7 days'
  order by p.user_id, p.czas desc;
$$;
grant execute on function public.pv_ostatnie_pozycje() to authenticated;

-- Sprawdzenie
select count(*) filter (where status in ('lead', 'spotkanie', 'umowa')) as leady_spotkania_umowy,
       count(*) filter (where status in ('lead', 'spotkanie', 'umowa') and autor_statusu is null) as bez_autora,
       count(*) filter (where status = 'spotkanie' and termin is null) as spotkania_bez_terminu
from public.pins;
