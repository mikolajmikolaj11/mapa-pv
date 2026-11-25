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
zmieniono timestamptz; ukryta_admin boolean (pinezka „usunięta” przez administratora – ukryta tylko u niego);
klient_imie, klient_nazwisko, klient_telefon, produkt text; termin timestamptz (dane klienta przy lead/spotkanie/umowa);
autor_statusu uuid (kto nadał obecny status – ustawia trigger, nie da się podrobić);
przypisany uuid (kto prowadzi klienta po przekazaniu; widzi dom także poza swoim terenem);
zmienil uuid (kto ostatnio zmienił / dodał ręcznie – ustawia trigger `pv_pins_straznik`).

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
- Zespół nie widzi rozróżnienia pewne / prawdopodobne – w aplikacji to jedna kategoria „Do odwiedzenia”.
  U administratora zrodlo 'stare' liczy się jako „Nowe – pewne” (bez osobnego filtra).
- Zespół widzi imiona swojego menedżera i administratorów (profiles_select), żeby przy wpisach było widać autora.
- Menedżer/handlowiec: mogą zmieniać tylko status, pv, notatkę i dodawać pinezki ręczne na swoim terenie.
  Nie mogą: usuwać (także statusem 'usun'), nadawać 'potencjal', importować, aktualizować powiatu, eksportować, zmieniać lat/lon itp.
- Zarządzanie w aplikacji: Menu → „Zespół i tereny” (admin: role, menedżer handlowca, tereny; menedżer: tereny swoich handlowców).
- Zapytania z SQL Editora (bez zalogowanego użytkownika) nie są ograniczane triggerem.
- Konta testowe: menedzer.test@example.com, handlowiec.test@example.com (`sql/02_konta_testowe.sql`).
- Skrypty SQL po kolei: 01_role_i_tereny, 02_konta_testowe, 03_statusy_i_granice, 04_klienci_i_ukrywanie.
- Skrypt 05_grafik_i_sledzenie: autor_statusu, wymagany termin spotkania, tabela pozycje + funkcja pv_ostatnie_pozycje().
- Śledzenie: `public.pozycje` (user_id, lat, lon, dokladnosc, czas). Zapisuje tylko menedżer i handlowiec (własne),
  z otwartej aplikacji: co 5 min albo po 40 m (nie częściej niż co 45 s), kolejka przy braku internetu.
  Widzi: siebie; menedżer – swoich handlowców; admin – wszystkich (pv_moze_zarzadzac). Admin nie jest śledzony.
  Ograniczenie: przeglądarka nie wysyła pozycji, gdy aplikacja jest zamknięta lub telefon zablokowany.
  Menu → Śledzenie zespołu: lista osób (ostatnia pozycja), Trasa dnia (km, godziny), Wszyscy na mapie (odświeżanie co min).
- Menu → Grafik: spotkania (status 'spotkanie') wg dni, Nadchodzące / Minione, filtr osoby.
- Menu → Wyniki zespołu (admin, menedżer): tabela osób z liczbą leadów / spotkań / umów wg autor_statusu;
  stuknięcie liczby otwiera listę tej osoby. Filtr „Osoba” w Sprzedaży i Grafiku (osoba albo cały zespół menedżera).
- Menu: sekcja „Pokaż na mapie” jest zwijana (stan zapamiętany).
- Skrypt 06_historia_praca_konta (24.11.2026):
  * `historia` (pin_id, czas, user_id, rodzaj: dodano|status|notatka|pv|dane|przekazanie, status_przed/po, opis, przypisany) –
    zapisuje trigger pv_historia_zapis; widzi ją każdy, kto widzi dom. Karta domu → „Historia domu”.
  * Wyniki zespołu liczone z historii: pv_wyniki(p_od, p_do) = ile różnych domów osoba oznaczyła jako lead/spotkanie/umowa
    w okresie (Ten tydzień / Ten miesiąc / Poprzedni mies. / Wszystko) + skuteczność lead→spotkanie, spotkanie→umowa.
  * Przekazanie (pins.przypisany): admin – każdemu; menedżer – sobie lub swoim handlowcom; handlowiec nie może.
    Wynik zostaje u zbierającego (autor_statusu). Grafik handlowca pokazuje spotkania, które prowadzi (przypisany albo autor).
  * `dni_pracy` (user_id, start, koniec, auto): „Zaczynam dzień / Kończę pracę”; automatyczny koniec o 21:00 (pv_koniec_dnia).
    Pozycje GPS przyjmowane tylko w oknie dnia pracy (RLS pozycje_insert); widoczne i przechowywane 7 dni
    (trigger pv_pozycje_sprzatanie kasuje starsze).
  * profiles.zablokowany – zablokowane konto nic nie widzi (pv_rola zwraca null).
  * pv_liczniki() – liczniki kategorii dla administratora.
- Praca bez zasięgu: zmiany pinezek (status, notatka, PV, dane klienta, przekazanie, dodanie domu) zapisują się w telefonie
  (localStorage pv_queue) i wysyłają same po powrocie internetu; pozycje GPS w pv_tq. Ostatni zapis wygrywa.
- Administrator wczytuje tylko widoczny obszar mapy (od przybliżenia MINZ = 4) + wszystkie leady/spotkania/umowy;
  liczniki z pv_liczniki(); eksport do modelu i „Aktualizuj powiat” pobierają pełne dane. Zespół wczytuje cały swój teren.
- Eksport sprzedaży (admin): Sprzedaż → „Pobierz do Excela” – plik CSV (średniki, UTF-8) z leadami/spotkaniami/umowami
  wg filtra osoby: dane klienta, adres, zebrał(a), prowadzi, menedżer, link do mapy. Niezależny od eksportu dla modelu.
- Konta z aplikacji (admin, panel Zespół): Dodaj konto, Nowe hasło, Zablokuj/Odblokuj – przez Edge Function `pv-konta`
  (kod: supabase/functions/pv-konta/index.ts). Wdrożenie: Supabase → Edge Functions → Deploy a new function → Via Editor,
  nazwa pv-konta, wklej kod, Deploy; w ustawieniach funkcji wyłącz „Verify JWT” (funkcja sama sprawdza, czy woła administrator).
  Funkcja używa klucza z SUPABASE_SECRET_KEYS (albo SUPABASE_SERVICE_ROLE_KEY) – klucz nigdy nie trafia do aplikacji.
- Menu → Leady zebrane / Spotkania umówione / Umowy: listy domów wg aktualnego statusu (dane klienta, adres,
  Zadzwoń, Jedź, wyszukiwarka); spotkania sortowane po terminie.
- Wygląd: własne ikony SVG (sprite w index.html), panele „szkło” nad mapą, dok akcji po prawej, kafelki statusów.

## Ważne zasady danych
- `pv`, statusy, notatki i pinezki ręczne to praca handlowca – nie mogą być nadpisywane przez importy/aktualizacje.
- „Usuń” (tylko administrator): jeśli dom nie ma oceny PV, aplikacja najpierw pyta „Czy jest tu fotowoltaika?
  Jest PV / Nie ma PV / Nie wiem” i zapisuje odpowiedź w pv (od 25.11.2026). Następnie ustawia ukryta_admin = true: pinezka znika tylko u administratora, zespół dalej ją widzi.
  Rekord zostaje. Dawne statusy 'usun' przeniesiono na ten znacznik (skrypt 04). Aktualizacja powiatu traktuje
  ukryte pinezki jako obsłużone. Eksport wypisuje je jak dawniej ze statusem 'usun' (gdy nie mają innego statusu).
- Wymagane dane klienta (pilnuje trigger pv_pins_straznik i formularz w aplikacji):
  lead – imię, telefon (min. 9 cyfr), notatka; nazwisko opcjonalne.
  spotkanie – jak lead + termin spotkania (wymagany, trafia do Grafiku).
  umowa – imię, nazwisko, sprzedany produkt; telefon i notatka opcjonalne.
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
