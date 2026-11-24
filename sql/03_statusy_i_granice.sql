-- =====================================================================
-- Mapa PV – zmiany z 24.11.2026 (uruchom PO skrypcie 01, PRZED wgraniem nowej aplikacji)
--  1. Tereny z prawdziwych granic gmin/powiatów (GUGiK) – teren może mieć kilka obwodów i „dziury”.
--     Sprawdzanie „czy dom leży w terenie” liczy PostGIS (wbudowany w Supabase) – szybko także dla
--     granic z setkami punktów.
--  2. Nowe statusy: 'lead' (Lead zebrany) i 'spotkanie' (Spotkanie umówione).
--  3. Status 'potencjal' tylko dla administratora: menedżer i handlowiec nie mogą go nadać
--     ani nie widzą pinezek oznaczonych jako potencjał.
-- Skrypt można uruchomić ponownie.
-- =====================================================================

create extension if not exists postgis with schema extensions;

-- ---------- 1. Tereny z granic administracyjnych ----------
-- poly: albo [[lat,lon],...] (narysowany), albo [[[lat,lon],...],[[lat,lon],...]] (kilka obwodów: granica gminy/powiatu)
alter table public.tereny add column if not exists teryt text;
alter table public.tereny add column if not exists geom extensions.geometry(MultiPolygon, 4326);

create or replace function public.pv_obwody(poly jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(poly->0->0) = 'array' then poly else jsonb_build_array(poly) end;
$$;

-- Zamiana poly (lat,lon) na kształt PostGIS. Obwody łączone regułą parzystości:
-- obwód w środku innego obwodu to „dziura” (np. miasto wewnątrz gminy wiejskiej).
create or replace function public.pv_teren_geom(poly jsonb) returns extensions.geometry
language plpgsql immutable set search_path = public, extensions as $$
declare r jsonb; ring geometry; acc geometry;
begin
  for r in select value from jsonb_array_elements(public.pv_obwody(poly)) loop
    if jsonb_array_length(r) < 3 then continue; end if;
    select st_makepolygon(st_addpoint(
             st_makeline(array_agg(st_makepoint((p->>1)::float8, (p->>0)::float8) order by o)),
             st_makepoint((r->0->>1)::float8, (r->0->>0)::float8)))
      into ring from jsonb_array_elements(r) with ordinality as e(p, o);
    ring := st_makevalid(st_setsrid(ring, 4326));
    acc := case when acc is null then ring else st_symdifference(acc, ring) end;
  end loop;
  return st_multi(st_collectionextract(st_makevalid(acc), 3));
end $$;

create or replace function public.pv_teren_bbox() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if jsonb_typeof(new.poly) is distinct from 'array'
     or jsonb_array_length(public.pv_obwody(new.poly)->0) < 3 then
    raise exception 'Teren musi mieć co najmniej 3 punkty';
  end if;
  select min((p->>0)::float8), max((p->>0)::float8), min((p->>1)::float8), max((p->>1)::float8)
    into new.min_lat, new.max_lat, new.min_lon, new.max_lon
    from jsonb_array_elements(public.pv_obwody(new.poly)) r, jsonb_array_elements(r) p;
  new.geom := public.pv_teren_geom(new.poly);
  return new;
end $$;

-- przelicz tereny, które już istnieją
update public.tereny set geom = public.pv_teren_geom(poly);
create index if not exists tereny_geom on public.tereny using gist (geom);

-- Czy punkt leży w którymkolwiek terenie danego użytkownika (teraz przez PostGIS).
create or replace function public.pv_w_terenie(p_user uuid, p_lat float8, p_lon float8) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.tereny t
                 where t.user_id = p_user
                   and st_intersects(t.geom, st_setsrid(st_makepoint(p_lon, p_lat), 4326)));
$$;

-- ---------- 2. Dozwolone statusy ----------
do $$ declare r record; begin
  for r in select conname from pg_constraint
           where conrelid = 'public.pins'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.pins drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.pins add constraint pins_status_check check (status is null or status in
  ('ponownie', 'lead', 'spotkanie', 'umowa', 'nie', 'potencjal', 'usun')) not valid;

-- ---------- 3. Strażnik pinezek: menedżer/handlowiec nie nadają 'usun' ani 'potencjal' ----------
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
      if new.status in ('usun', 'potencjal') and old.status is distinct from new.status then
        raise exception 'Brak uprawnień do tego statusu';
      end if;
    end if;
    new.zmienil := auth.uid();
  elsif tg_op = 'INSERT' and new.zrodlo = 'reczne' then
    new.zmienil := auth.uid();
  end if;
  return new;
end $$;

-- ---------- 4. Reguły dostępu do pinezek: 'potencjal' ukryty jak 'usun' ----------
drop policy if exists pins_select on public.pins;
drop policy if exists pins_insert on public.pins;
drop policy if exists pins_update on public.pins;

create policy pins_select on public.pins for select to authenticated
  using ((select public.pv_rola()) = 'admin'
         or (coalesce(status, '') not in ('usun', 'potencjal') and public.pv_widzi(lat, lon)));
create policy pins_insert on public.pins for insert to authenticated
  with check ((select public.pv_rola()) = 'admin'
              or (zrodlo = 'reczne' and coalesce(status, '') not in ('usun', 'potencjal') and public.pv_widzi(lat, lon)));
create policy pins_update on public.pins for update to authenticated
  using ((select public.pv_rola()) = 'admin'
         or (coalesce(status, '') not in ('usun', 'potencjal') and public.pv_widzi(lat, lon)))
  with check ((select public.pv_rola()) = 'admin' or public.pv_widzi(lat, lon));

-- Sprawdzenie: tereny i liczba punktów ich granic
select p.imie, p.rola, t.nazwa, extensions.st_npoints(t.geom) as punkty_granicy
from public.tereny t join public.profiles p on p.id = t.user_id
order by p.rola, t.nazwa;
