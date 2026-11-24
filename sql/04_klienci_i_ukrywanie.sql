-- =====================================================================
-- Mapa PV – zmiany z 24.11.2026, część 2 (uruchom PO skrypcie 03, PRZED wgraniem nowej aplikacji)
--  1. „Usuń” administratora ukrywa pinezkę TYLKO u administratora (kolumna ukryta_admin).
--     Menedżer i handlowiec dalej ją widzą. Dotychczasowe pinezki ze statusem 'usun' są przenoszone
--     na nowy znacznik (status wraca do pustego, pinezka dalej ukryta u administratora).
--  2. Dane klienta przy statusach:
--     lead, spotkanie – wymagane: imię, telefon, notatka (nazwisko i termin spotkania opcjonalne)
--     umowa           – wymagane: imię, nazwisko, sprzedany produkt (telefon opcjonalny)
--     Baza pilnuje tych pól przy każdej zmianie statusu lub danych klienta z aplikacji.
-- Skrypt można uruchomić ponownie.
-- =====================================================================

-- ---------- 1. Nowe kolumny ----------
alter table public.pins add column if not exists ukryta_admin   boolean not null default false;
alter table public.pins add column if not exists klient_imie     text;
alter table public.pins add column if not exists klient_nazwisko text;
alter table public.pins add column if not exists klient_telefon  text;
alter table public.pins add column if not exists produkt         text;
alter table public.pins add column if not exists termin          timestamptz;

-- dotychczasowe „usunięte” → ukryte tylko u administratora
update public.pins set ukryta_admin = true, status = null where status = 'usun';

-- ---------- 2. Strażnik pinezek ----------
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
    else
      if coalesce(btrim(new.klient_nazwisko), pusty) = pusty then
        raise exception 'Wpisz nazwisko klienta';
      end if;
      if coalesce(btrim(new.produkt), pusty) = pusty then
        raise exception 'Wpisz sprzedany produkt';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.zmienil := auth.uid();
  elsif new.zrodlo = 'reczne' then
    new.zmienil := auth.uid();
  end if;
  return new;
end $$;

-- ---------- 3. Imiona przełożonych widoczne dla zespołu ----------
-- (żeby przy wpisach było widać „Wpisał(a): Jan Kowalski”, a nie „inny użytkownik”)
create or replace function public.pv_moj_menedzer() returns uuid
language sql stable security definer set search_path = public as $$
  select manager_id from public.profiles where id = auth.uid();
$$;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or manager_id = (select auth.uid()) or rola = 'admin'
         or id = (select public.pv_moj_menedzer()) or (select public.pv_rola()) = 'admin');

-- Reguły dostępu do pinezek (RLS) zostają bez zmian: zespół nie widzi tylko statusu 'potencjal'
-- (oraz dawnego 'usun', którego po przeniesieniu powyżej już nie ma). Znacznik ukryta_admin
-- działa tylko w aplikacji administratora.

-- Sprawdzenie
select count(*) filter (where ukryta_admin) as ukryte_u_administratora,
       count(*) filter (where status = 'usun') as stary_status_usun,
       count(*) filter (where status in ('lead', 'spotkanie', 'umowa')) as leady_spotkania_umowy
from public.pins;
