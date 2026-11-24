# Mapa PV – kontekst projektu (dla nowej rozmowy z Claude)

## Co to jest
Aplikacja webowa (PWA) dla sprzedaży D2D magazynów energii. Pokazuje na mapie domy jednorodzinne z fotowoltaiką,
wykryte automatycznie ze zdjęć lotniczych (model AI liczony osobno) albo dodane ręcznie. Handlowiec nawiguje do domu
(Google Maps), nadaje statusy i ocenia, czy dom faktycznie ma PV (te oceny służą do douczania modelu).

## Technologia
- Hosting: GitHub Pages, repozytorium `mikolajmikolaj11/mapa-pv` (pliki wgrywane ręcznie przez „Upload files”).
- Baza i logowanie: Supabase (projekt `lopqafdglqravoqfccqi`, region Frankfurt), logowanie e-mail + hasło,
  rejestracja wyłączona, użytkownicy dodawani ręcznie w panelu Supabase.
- Mapa: Leaflet + proj4leaflet, układ EPSG:2180, ortofotomapa Geoportalu (WMTS StandardResolution) na żywo,
  nakładka numerów adresowych i ulic (WMS GUGiK KrajowaIntegracjaNumeracjiAdresowej).
- Biblioteki w folderze `lib/` (leaflet, proj4, proj4leaflet, supabase-js UMD). Bez kroku budowania.
- Przy zmianie `app.js`/`config.js` podbij parametr `?v=` w `index.html`, żeby ominąć pamięć podręczną.

## Tabela `public.pins`
id text PK; adres, miejscowosc, gmina text; lat, lon double precision; zrodlo text ('nowe' | 'stare' | 'reczne');
pewnosc text ('pewne' | 'prawdopodobne'); wynik real; obszar text (np. 'pow. konecki'); status text
('ponownie' | 'lead' | 'spotkanie' | 'umowa' | 'nie' | 'potencjal' | 'usun' | null; constraint pins_status_check); notatka text; pv text ('jest' | 'nie' | null);
zmieniono timestamptz; zmienil uuid (kto ostatnio zmienił / dodał ręcznie – ustawia trigger `pv_pins_straznik`).

## Role i tereny (od 2026-11-24, skrypty w `sql/`)
- `public.profiles`: id (= auth.users.id), email, imie, rola ('admin' | 'manager' | 'handlowiec'), manager_id.
  Nowe konto z panelu Supabase dostaje automatycznie profil 'handlowiec' bez menedżera (trigger na auth.users).
- `public.tereny`: id, user_id (komu przydzielony), nazwa, teryt, poly jsonb, bbox (min/max lat/lon) i geom (PostGIS
  MultiPolygon 4326) – bbox i geom liczy trigger z poly. poly = [[lat,lon],…] (narysowany) albo [[[lat,lon],…],…]
  (granica gminy/powiatu z GUGiK ULDK, kilka obwodów, łączone regułą parzystości). Granice upraszczane w aplikacji do ~10 m.
- Przydział terenu w aplikacji: „Gmina / powiat” (stuknięcie w mapę → ULDK GetCommuneByXY / GetCountyByXY) albo „Narysuj”.
- PostGIS (schemat extensions) liczy „czy dom w terenie” (`pv_w_terenie`, ST_Intersects) – ok. 0,2 s na 15 tys. pinezek.
- Hierarchia: administrator → menedżer (admin przydziela mu handlowców i główny teren) → handlowiec (menedżer rysuje mu teren).
- Widoczność pinezek (RLS, funkcja `pv_widzi`): admin – wszystko; menedżer – pinezki w swoim terenie;
  handlowiec – pinezki w swoim terenie ORAZ w terenie swojego menedżera. Menedżer i handlowiec nie widzą pinezek 'usun'
  ani 'potencjal' (Potencjał to status tylko administratora – nadany przez admina ukrywa dom przed zespołem).
- Zespół nie widzi rozróżnienia pewne / prawdopodobne / stare – w aplikacji to jedna kategoria „Do odwiedzenia”.
- Menedżer/handlowiec: mogą zmieniać tylko status, pv, notatkę i dodawać pinezki ręczne na swoim terenie.
  Nie mogą: usuwać (także statusem 'usun'), nadawać 'potencjal', importować, aktualizować powiatu, eksportować, zmieniać lat/lon itp.
- Zarządzanie w aplikacji: Menu → „Zespół i tereny” (admin: role, menedżer handlowca, tereny; menedżer: tereny swoich handlowców).
- Zapytania z SQL Editora (bez zalogowanego użytkownika) nie są ograniczane triggerem.
- Konta testowe: menedzer.test@example.com, handlowiec.test@example.com (`sql/02_konta_testowe.sql`).
- Skrypty SQL po kolei: 01_role_i_tereny, 02_konta_testowe, 03_statusy_i_granice (wszystkie uruchomione 24.11.2026).
- Wygląd: własne ikony SVG (sprite w index.html), panele „szkło” nad mapą, dok akcji po prawej, kafelki statusów.

## Ważne zasady danych
- `pv`, statusy, notatki i pinezki ręczne to praca handlowca – nie mogą być nadpisywane przez importy/aktualizacje.
- „Usuń” tylko ukrywa pinezkę (status 'usun'); rekord zostaje (potrzebny do douczania modelu).
- Do douczania modelu używane są wyłącznie: pv, status 'umowa' (= jest PV) i pinezki ręczne. Eksport w menu aplikacji.
  Format eksportu bez zmian; w polu status mogą się teraz pojawić także 'lead' i 'spotkanie' (bez automatycznego pv).
- „🔁 Aktualizuj powiat z pliku”: usuwa nieruszone pinezki danego `obszar`, których nie ma w nowym pliku; dodaje nowe,
  ale nie w promieniu 30 m od pinezek obsłużonych i 15 m od istniejących.

## Funkcje obecne
Logowanie; mapa z filtrami statusów; karta pinezki (nawigacja Google Maps, statusy, Jest/Nie ma PV, notatka);
GPS (niebieska kropka); lista najbliższych domów; dodawanie pominiętego domu (＋); import pinezek z pliku;
aktualizacja powiatu; eksport ocen do douczania; licznik na górnym pasku; role i tereny (panel „Zespół i tereny”, rysowanie terenów).

## Plany (do omówienia)
Szczegóły widoków menedżera/handlowca (statystyki zespołu, historia „kto co zrobił”), zakładanie kont z aplikacji,
edycja kształtu terenu. Zmiany w bazie robione przez SQL Editor w Supabase.
