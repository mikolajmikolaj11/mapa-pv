-- =====================================================================
-- Mapa PV – zmiany z 24.11.2026, część 4 (uruchom PO skrypcie 05, PRZED wgraniem nowej aplikacji)
--  1. Historia domu: każda zmiana statusu, notatki, „Jest/Nie ma PV”, danych klienta i przekazania
--     zapisuje się w tabeli historia (kto, kiedy, co). Na niej liczone są wyniki w czasie.
--  2. Przekazanie leada/spotkania: kolumna przypisany (kto prowadzi klienta). Przekazuje administrator
--     (każdemu) i menedżer (sobie lub swoim handlowcom). Osoba przypisana widzi dom także poza swoim terenem.
--  3. Dzień pracy: tabela dni_pracy („Zaczynam dzień” / „Kończę pracę”). Pozycje GPS przyjmowane są tylko
--     w czasie otwartego dnia pracy i najpóźniej do 21:00. Pozycje starsze niż 7 dni są usuwane.
--  4. Konta: kolumna zablokowany (zablokowane konto nic nie widzi). Konta zakłada funkcja pv-konta.
--  5. Funkcje dla aplikacji: pv_wyniki(od, do) i pv_liczniki() (liczniki administratora).
-- Skrypt można uruchomić ponownie.
-- =====================================================================

-- ---------- Kolumny ----------
alter table public.pins add column if not exists przypisany uuid references auth.users(id) on delete set null;
create index if not exists pins_lat_lon on public.pins (lat, lon);
create index if not exists pins_status on public.pins (status) where status is not null;
alter table public.profiles add column if not exists zablokowany boolean not null default false;

-- zablokowane konto nie ma roli → nie widzi niczego
create or replace function public.pv_rola() returns text
language sql stable security definer set search_path = public as $$
  select rola from public.profiles where id = auth.uid() and not zablokowany;
$$;

-- ---------- Reguły pinezek: osoba przypisana też widzi i edytuje dom ----------
drop policy if exists pins_select on public.pins;
drop policy if exists pins_update on public.pins;
create policy pins_select on public.pins for select to authenticated
  using ((select public.pv_rola()) = 'admin'
         or ((select public.pv_rola()) is not null and coalesce(status, '') not in ('usun', 'potencjal')
             and (przypisany = (select auth.uid()) or public.pv_widzi(lat, lon))));
create policy pins_update on public.pins for update to authenticated
  using ((select public.pv_rola()) = 'admin'
         or ((select public.pv_rola()) is not null and coalesce(status, '') not in ('usun', 'potencjal')
             and (przypisany = (select auth.uid()) or public.pv_widzi(lat, lon))))
  with check ((select public.pv_rola()) = 'admin' or przypisany = (select auth.uid()) or public.pv_widzi(lat, lon));

-- ---------- Strażnik pinezek (jak w 05 + zasady przekazania) ----------
create or replace function public.pv_pins_straznik() returns trigger
language plpgsql security definer set search_path = public as $$
declare pusty constant text := ''; r text := public.pv_rola();
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor: bez ograniczeń

  if tg_op = 'UPDATE' and r is distinct from 'admin' then
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
    -- przekazanie: menedżer – sobie albo swojemu handlowcowi; handlowiec – nie może
    if new.przypisany is distinct from old.przypisany then
      if r is distinct from 'manager' or not (new.przypisany is null or new.przypisany = auth.uid()
           or exists (select 1 from public.profiles where id = new.przypisany and manager_id = auth.uid())) then
        raise exception 'Brak uprawnień do przekazania tego klienta';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and r is distinct from 'admin' and new.przypisany is not null then
    raise exception 'Brak uprawnień do przekazania tego klienta';
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

  -- autor statusu: zmienia się tylko razem ze statusem
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

-- ---------- 1. Historia domu ----------
create table if not exists public.historia (
  id          bigint generated always as identity primary key,
  pin_id      text not null references public.pins(id) on delete cascade,
  czas        timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  rodzaj      text not null,            -- dodano | status | notatka | pv | dane | przekazanie
  status_przed text,
  status_po    text,
  opis        text,
  przypisany  uuid
);
create index if not exists historia_pin on public.historia (pin_id, czas desc);
create index if not exists historia_czas on public.historia (czas) where rodzaj = 'status';

create or replace function public.pv_historia_zapis() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); t timestamptz := least(coalesce(new.zmieniono, now()), now());
begin
  if tg_op = 'INSERT' then
    if new.zrodlo = 'reczne' then
      insert into public.historia (pin_id, czas, user_id, rodzaj, opis) values (new.id, t, u, 'dodano', 'Dodano dom ręcznie');
    end if;
    if new.status is not null then
      insert into public.historia (pin_id, czas, user_id, rodzaj, status_po) values (new.id, t, u, 'status', new.status);
    end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.historia (pin_id, czas, user_id, rodzaj, status_przed, status_po) values (new.id, t, u, 'status', old.status, new.status);
  end if;
  if new.notatka is distinct from old.notatka and coalesce(new.notatka, '') <> '' then
    insert into public.historia (pin_id, czas, user_id, rodzaj, opis) values (new.id, t, u, 'notatka', left(new.notatka, 500));
  end if;
  if new.pv is distinct from old.pv then
    insert into public.historia (pin_id, czas, user_id, rodzaj, opis) values (new.id, t, u, 'pv', new.pv);
  end if;
  if (new.klient_imie, new.klient_nazwisko, new.klient_telefon, new.produkt, new.termin)
     is distinct from (old.klient_imie, old.klient_nazwisko, old.klient_telefon, old.produkt, old.termin)
     and new.status is not distinct from old.status then
    insert into public.historia (pin_id, czas, user_id, rodzaj, opis) values (new.id, t, u, 'dane', 'Zmieniono dane klienta');
  end if;
  if new.przypisany is distinct from old.przypisany then
    insert into public.historia (pin_id, czas, user_id, rodzaj, przypisany) values (new.id, t, u, 'przekazanie', new.przypisany);
  end if;
  return null;
end $$;
drop trigger if exists pv_historia_zapis on public.pins;
create trigger pv_historia_zapis after insert or update on public.pins
  for each row execute function public.pv_historia_zapis();

-- stan początkowy: obecne statusy jako pierwszy wpis historii (tylko raz)
insert into public.historia (pin_id, czas, user_id, rodzaj, status_po, opis)
select p.id, coalesce(p.zmieniono, now()), p.autor_statusu, 'status', p.status, 'stan przed włączeniem historii'
from public.pins p
where p.status is not null and not exists (select 1 from public.historia h where h.pin_id = p.id);

alter table public.historia enable row level security;
drop policy if exists historia_select on public.historia;
-- historię domu widzi każdy, kto widzi ten dom
create policy historia_select on public.historia for select to authenticated
  using (exists (select 1 from public.pins p where p.id = historia.pin_id));
grant select on public.historia to authenticated;
revoke all on public.historia from anon;

-- Wyniki w okresie: ile różnych domów dana osoba oznaczyła jako lead / spotkanie / umowa
create or replace function public.pv_wyniki(p_od timestamptz, p_do timestamptz)
returns table (user_id uuid, status text, n bigint)
language sql stable security invoker set search_path = public as $$
  select h.user_id, h.status_po, count(distinct h.pin_id)
  from public.historia h
  where h.rodzaj = 'status' and h.status_po in ('lead', 'spotkanie', 'umowa')
    and h.czas >= p_od and h.czas < p_do and h.user_id is not null
  group by 1, 2;
$$;
grant execute on function public.pv_wyniki(timestamptz, timestamptz) to authenticated;

-- Liczniki dla administratora (aplikacja wczytuje u niego tylko widoczny obszar mapy)
create or replace function public.pv_liczniki()
returns table (kat text, n bigint)
language sql stable security invoker set search_path = public as $$
  select case when ukryta_admin then 'usun'
              when status is not null then status
              when zrodlo = 'reczne' then 'reczne'
              when zrodlo = 'stare' or pewnosc = 'pewne' then 'nowe_p'
              else 'nowe_m' end, count(*)
  from public.pins group by 1;
$$;
grant execute on function public.pv_liczniki() to authenticated;

-- ---------- 3. Dzień pracy i śledzenie ----------
create table if not exists public.dni_pracy (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  start   timestamptz not null default now(),
  koniec  timestamptz,
  auto    boolean not null default false     -- true = zakończony automatycznie o 21:00
);
create index if not exists dni_pracy_user on public.dni_pracy (user_id, start desc);

-- 21:00 czasu polskiego w dniu rozpoczęcia pracy
create or replace function public.pv_koniec_dnia(p_start timestamptz) returns timestamptz
language sql stable as $$
  select (((p_start at time zone 'Europe/Warsaw')::date + time '21:00') at time zone 'Europe/Warsaw');
$$;

-- nowy dzień zamyka poprzedni niezamknięty (najpóźniej o 21:00 jego dnia)
create or replace function public.pv_dzien_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.start := now();
  new.koniec := null;
  update public.dni_pracy set koniec = least(now(), public.pv_koniec_dnia(start)), auto = true
  where user_id = new.user_id and koniec is null;
  return new;
end $$;
drop trigger if exists pv_dzien_start on public.dni_pracy;
create trigger pv_dzien_start before insert on public.dni_pracy
  for each row execute function public.pv_dzien_start();

alter table public.dni_pracy enable row level security;
drop policy if exists dni_insert on public.dni_pracy;
drop policy if exists dni_update on public.dni_pracy;
drop policy if exists dni_select on public.dni_pracy;
create policy dni_insert on public.dni_pracy for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.pv_rola()) in ('manager', 'handlowiec'));
create policy dni_update on public.dni_pracy for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy dni_select on public.dni_pracy for select to authenticated
  using (user_id = (select auth.uid()) or public.pv_moze_zarzadzac(user_id));
grant select, insert, update on public.dni_pracy to authenticated;
revoke all on public.dni_pracy from anon;

-- pozycje: tylko w czasie dnia pracy (od „Zaczynam dzień” do „Kończę pracę”, najpóźniej 21:00)
drop policy if exists pozycje_insert on public.pozycje;
create policy pozycje_insert on public.pozycje for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.pv_rola()) in ('manager', 'handlowiec')
              and czas <= now() + interval '5 minutes'
              and exists (select 1 from public.dni_pracy d
                          where d.user_id = (select auth.uid()) and pozycje.czas >= d.start
                            and pozycje.czas <= coalesce(d.koniec, public.pv_koniec_dnia(d.start))));
-- widać tylko ostatnie 7 dni
drop policy if exists pozycje_select on public.pozycje;
create policy pozycje_select on public.pozycje for select to authenticated
  using (czas > now() - interval '7 days' and (user_id = (select auth.uid()) or public.pv_moze_zarzadzac(user_id)));

-- automatyczne kasowanie pozycji starszych niż 7 dni (przy każdym zapisie nowych pozycji)
create index if not exists pozycje_czas on public.pozycje (czas);
create or replace function public.pv_pozycje_sprzatanie() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.pozycje where czas < now() - interval '7 days';
  return null;
end $$;
drop trigger if exists pv_pozycje_sprzatanie on public.pozycje;
create trigger pv_pozycje_sprzatanie after insert on public.pozycje
  for each statement execute function public.pv_pozycje_sprzatanie();
delete from public.pozycje where czas < now() - interval '7 days';

-- Sprawdzenie
select (select count(*) from public.historia) as wpisy_historii,
       (select count(*) from public.pozycje) as pozycje_gps,
       (select count(*) from public.profiles where zablokowany) as konta_zablokowane;
