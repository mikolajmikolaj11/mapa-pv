-- =====================================================================
-- Mapa PV – konta testowe: jeden menedżer i jeden handlowiec
-- NAJPIERW dodaj oba konta w Supabase → Authentication → Users → Add user → Create new user
-- (zaznacz „Auto Confirm User”, hasło wybierz sam):
--     menedzer.test@example.com
--     handlowiec.test@example.com
-- Potem uruchom ten skrypt w SQL Editor. Można go uruchamiać wielokrotnie.
-- =====================================================================

-- profile (na wypadek, gdyby konta powstały przed skryptem 01)
insert into public.profiles (id, email)
select id, email from auth.users
where email in ('menedzer.test@example.com', 'handlowiec.test@example.com')
on conflict (id) do nothing;

-- role i hierarchia
update public.profiles set rola = 'manager', imie = 'Menedżer Testowy', manager_id = null
where email = 'menedzer.test@example.com';

update public.profiles set rola = 'handlowiec', imie = 'Handlowiec Testowy',
  manager_id = (select id from public.profiles where email = 'menedzer.test@example.com')
where email = 'handlowiec.test@example.com';

-- przykładowe tereny (później możesz je usunąć i narysować własne w aplikacji):
--   menedżer   – prostokąt wokół powiatu z największą liczbą pinezek
--   handlowiec – prostokąt wokół gminy z największą liczbą pinezek w tym powiecie
delete from public.tereny
where user_id in (select id from public.profiles
                  where email in ('menedzer.test@example.com', 'handlowiec.test@example.com'));

with pow as (select obszar from public.pins where obszar is not null
             group by obszar order by count(*) desc limit 1),
b as (select min(lat) - 0.01 a1, max(lat) + 0.01 a2, min(lon) - 0.015 o1, max(lon) + 0.015 o2
      from public.pins where obszar = (select obszar from pow))
insert into public.tereny (user_id, nazwa, poly)
select m.id, 'TEST – ' || (select obszar from pow),
       jsonb_build_array(jsonb_build_array(a1, o1), jsonb_build_array(a1, o2),
                         jsonb_build_array(a2, o2), jsonb_build_array(a2, o1))
from b, public.profiles m
where m.email = 'menedzer.test@example.com' and b.a1 is not null;

with pow as (select obszar from public.pins where obszar is not null
             group by obszar order by count(*) desc limit 1),
gm as (select gmina from public.pins where obszar = (select obszar from pow) and gmina is not null
       group by gmina order by count(*) desc limit 1),
b as (select min(lat) - 0.003 a1, max(lat) + 0.003 a2, min(lon) - 0.005 o1, max(lon) + 0.005 o2
      from public.pins where obszar = (select obszar from pow) and gmina = (select gmina from gm))
insert into public.tereny (user_id, nazwa, poly)
select h.id, 'TEST – gm. ' || (select gmina from gm),
       jsonb_build_array(jsonb_build_array(a1, o1), jsonb_build_array(a1, o2),
                         jsonb_build_array(a2, o2), jsonb_build_array(a2, o1))
from b, public.profiles h
where h.email = 'handlowiec.test@example.com' and b.a1 is not null;

-- Sprawdzenie
select p.email, p.imie, p.rola, m.imie as menedzer, t.nazwa as teren
from public.profiles p
left join public.profiles m on m.id = p.manager_id
left join public.tereny t on t.user_id = p.id
order by p.rola, p.email;
