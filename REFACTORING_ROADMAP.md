# Plan rozwoju i refaktoryzacji MVP

Ten plan utrzymuje zakres MVP: lokalne, ręcznie uruchamiane relisty jednej garderoby Vinted. Nie obejmuje automatycznych wiadomości, ofert, obserwowania, wielu kont ani zdalnego backendu.

## Zasady realizacji

- Każdy pakiet zmian musi przejść `npm run typecheck`, `npm test` i `npm run build`.
- `npm run lint` jest naprawiany modułami; obecna baza to 188 błędów i 115 ostrzeżeń, bez jednorazowego masowego `--fix`.
- Operacje na Vinted pozostają jawne, lokalne i logowane; refaktoryzacja nie zmienia zachowania relistu bez osobnego zadania.
- Po każdym pakiecie aktualizowane są `TASKS.md`, `WORKFLOW_STATE.md` i odpowiednia część `TEST_PLAN.md`.

## Tor A — funkcjonalność relist MVP

1. **Kontrakt wyniku skanowania** — przekazywać statusy, źródło danych (API/fallback) i liczniki w typowanej odpowiedzi zamiast tylko w tekście logu.
2. **Skanowanie statusów garderoby** — ręcznie potwierdzić `active`, `hidden`, `sold`, `reserved`, `draft`; zachować w logu wynik każdego zapytania i zablokować błędne duplikaty.
3. **Widoczne filtry popupu** — dodać filtr statusu i liczniki do listy popupu, zgodne z panelem Garderoba.
4. **Trwałość ostatniego skanu** — lokalnie zachowywać wynik oraz czas skanu, z wyraźnym komunikatem o nieaktualnych danych. *(ukończone: `vbr:lastScan`, panel świeżości w opcjach, brama 7 dni dla auto-relistu)*
5. **Preflight relistu** — przed dodaniem do kolejki sprawdzić duplikaty, stan źródłowy, otwartą kartę Vinted i ustawiony odstęp.
6. **Polityka wyboru** — po ręcznym E2E dla każdego statusu zdecydować, które nieaktywne pozycje można relistować. Do tego czasu preflight wyświetla wyraźne ostrzeżenie i nie ukrywa ich automatycznie.
7. **Kolejka** — rozdzielić „zatrzymaj po błędzie API” od zwykłego błędu pojedynczej aukcji w czytelnym stanie UI.
8. **Kopie zapasowe** — dopisać datę, status źródłowy i wynik relistu do kopii oraz przetestować eksport/import tylko lokalnych danych. *(w toku: data + wynik + eksport JSON/CSV ukończone; import lokalnych danych pozostaje do decyzji)*
9. **Logi** — dodać filtrowanie poziomu, skrócony opis akcji oraz bezpieczny eksport diagnostyczny.
10. **Relist E2E** — ręcznie potwierdzić jeden relist aktywnej aukcji, nowy ID, kopię zapasową i zachowanie po ponownym uruchomieniu service workera.

## Tor B — interfejs i dostępność

11. **Wspólne tokeny UI** — przenieść kolory, odstępy, promienie i style statusów do jednego zestawu współdzielonego przez popup, dashboard i ustawienia. *(ukończone: `src/shared/tokens.css`, warstwy popup/dashboard mapują na `--ui-*`, opcje w pełni przeniesione)*
12. **Popup statusów** — dodać małe liczniki kategorii, filtr statusu i czytelny komunikat, czy wynik pochodzi z API czy fallbacku DOM.
13. **Dashboard Garderoba** — dodać paski liczników, stan ładowania, stan pusty oraz czytelne rozróżnienie danych ostatniego skanu od kolejki.
14. **Kolejka i błędy** — pokazać powód pauzy, następny element i akcję możliwą do wykonania przez użytkownika.
15. **Modal pojedynczej aukcji** — ograniczyć go do potwierdzenia danych, oznaczyć pola wyłącznie informacyjne i ujednolicić fokus/ESC.
16. **Dostępność** — przejść klawiaturą przez popup/dashboard, uzupełnić etykiety ARIA, kontrast i komunikaty `aria-live`.
17. **Responsywność** — sprawdzić minimalną szerokość popupu i dashboardu przy mniejszych oknach bez ukrywania istotnych kontrolek.
18. **Weryfikacja wizualna** — po każdym pakiecie UI wykonać ręczny przegląd w Chrome po przeładowaniu rozszerzenia.

## Tor C — refaktoryzacja źródeł i jakość

19. **Wspólny moduł statusów** — centralne etykiety, wyznaczanie statusu źródłowego i podsumowania; usunąć duplikaty z popupu, dashboardu i content scriptu. *(w toku)*
20. **Typowane wiadomości** — zastąpić lokalne `as` i ad hoc odpowiedzi wrapperem z `src/shared/messaging.ts` oraz kontraktami z `src/core/contracts.ts`. *(ukończone: popup, dashboard i opcje używają wspólnego wrappera)*
21. **Typowane elementy DOM** — dodać bezpieczne helpery pobierania elementów i stopniowo usunąć `!` oraz luźne rzutowania w popupie, dashboardzie i opcjach. *(ukończone)*
22. **Renderery UI** — wydzielić renderowanie list, kolejki, logów i kopii z dużych plików popup/dashboard bez zmiany zachowania. *(w toku: logiczne zaznaczanie i pełny zestaw rendererów dashboardu zostały wydzielone; pozostał popup)*
23. **Skaner Vinted** — rozdzielić transport API, normalizację odpowiedzi, stronicowanie i mapowanie statusów na małe moduły czysto testowalne.
24. **Selektory Vinted** — zachować wszystkie selektory wyłącznie w `selectors.ts`; dodać testy regresji parserów bez kopiowania kodu z zewnętrznych rozszerzeń.
25. **Kolejka** — wyodrębnić obliczanie widoku statusu i decyzję o pauzie API do funkcji jednostkowych.
26. **Logger i storage** — ograniczyć powtarzane odczyty/zapisy, dodać limit rozmiaru danych i test retencji logów.
27. **Lint: shared/core** — naprawić błędy w `src/shared` i `src/core`, nie zmieniając reguł ani nie wyciszając ich globalnie.
28. **Lint: content** — osobny pakiet dla `content.ts`, `content-init.ts`, skanera i kontrolera overlay.
29. **Lint: UI/background** — osobne pakiety dla popupu, dashboardu, opcji i service workera.
30. **Testy i build** — rozszerzyć build o testowalne moduły core oraz uzupełnić testy właściwych funkcji zamiast kopiowania ich implementacji do plików testowych.

## Kolejność najbliższych pakietów

1. Wspólny moduł statusów oraz typowane podsumowanie skanu.
2. Kontrakt wyniku skanowania i prezentacja pochodzenia danych w popupie/dashboardzie.
3. Filtr statusów oraz liczniki w popupie.
4. Preflight wyboru do relistu i blokada nieaktywnych pozycji.
5. Rozdzielenie rendererów UI i bezpieczne pobieranie elementów DOM.
6. Pierwsza mała partia lint: `src/shared` i `src/core`.
7. Ręczny test skanowania wszystkich dostępnych statusów i relist jednej aktywnej aukcji.
