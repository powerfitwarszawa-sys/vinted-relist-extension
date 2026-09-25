# Blueprint: własna wtyczka Chrome do automatyzacji Vinted

## Cel dokumentu

Ten dokument zbiera trzy rzeczy naraz: analizę funkcjonalną istniejących wtyczek, proponowaną strukturę nowej własnej wtyczki oraz gotowe polecenie projektowe do wykorzystania w AI przy budowie rozszerzenia od zera. Redrip komunikuje m.in. automatyczną republikację, tryb auto w tle, odpowiedzi AI, automatyczne oferty, follow/unfollow i zunifikowany panel konta, co daje dobry punkt odniesienia dla zakresu produktu.[cite:4]

## Analiza funkcjonalna istniejącej wtyczki

### Co da się wyczytać z Redrip bez naruszania kodu źródłowego

Z publicznego opisu Redrip wynika, że produkt jest rozszerzeniem Chrome dla Vinted z sześcioma modułami: automatyczna republikacja, zaplanowany tryb auto, odpowiedzi AI, automatyczne oferty, follow/unfollow i jeden wspólny panel do zarządzania przedmiotami, rozmowami, sprzedażami i ofertami.[cite:4]

Redrip deklaruje również, że działa po zalogowaniu użytkownika do Vinted, wykrywa sesję przez cookies, nie wymaga udostępniania hasła i przechowuje preferencje, szkice i historię lokalnie na urządzeniu użytkownika.[cite:4]

Z tego można wyciągnąć prawdopodobny model techniczny:

- content scripts działające na stronach Vinted,
- service worker w MV3 do zadań tła,
- popup lub overlay UI osadzony w stronie,
- lokalny storage na ustawienia i historię,
- opcjonalne wywołania do AI dla odpowiedzi i opisów.[cite:4]

### Jakie elementy warto odtworzyć funkcjonalnie

Do własnej wersji warto przenieść idee funkcjonalne, a nie kod:

- batch relist w paczkach,
- harmonogram działań co X minut,
- panel do masowych akcji,
- logi wykonania,
- kolejkę tasków,
- tryb bezpieczny z limitami tempa,
- wielokonto jako przyszły etap.[cite:4]

### Czego nie kopiować

Nie należy kopiować kodu źródłowego, nazw modułów 1:1, tekstów marketingowych, layoutu UI, ikon ani struktury implementacji, jeśli pochodzi z własnościowego rozszerzenia. Zamiast tego trzeba zbudować nowy system na podstawie własnej specyfikacji funkcji.[cite:4]

## Zakres własnej wtyczki

Dla konta z około 200 aukcjami najrozsądniejsza jest wtyczka skupiona na trzech rzeczach:

1. relist / republish w partiach,
2. kolejka automatyzacji z logami i retry,
3. prosty panel zarządzania i ustawień.

Na start nie trzeba budować wszystkiego z Redrip czy Dotb. Największą wartość da automatyzacja masowego odnawiania aukcji oraz bezpieczne sterowanie tempem akcji, bo to odpowiada bezpośrednio na problem limitu 50 relistów w darmowych narzędziach.[cite:4]

## Architektura własnej wtyczki

### Założenia ogólne

Nowa wtyczka powinna być zbudowana jako Chrome Extension w standardzie Manifest V3, z rozdzieleniem na content scripts, service worker oraz osobny panel popup/options. Redrip jest pozycjonowany jako rozszerzenie Chrome dla Vinted, więc taki model wdrożenia odpowiada rynkowemu wzorcowi użytkowania.[cite:4]

### Moduły

#### 1. `manifest.json`

Odpowiada za:
- host permissions dla domen Vinted,
- rejestrację content scripts,
- rejestrację service workera,
- deklarację popup i options page,
- minimalne uprawnienia `storage`, `tabs`, `scripting`, `alarms`.

#### 2. `src/content/`

Proponowane pliki:

- `vinted-page-observer.ts` — wykrywanie kontekstu strony, URL i gotowości DOM,
- `listing-selector.ts` — wybór ofert do obróbki,
- `relist-runner.ts` — wykonywanie sekwencji relistingu krok po kroku,
- `form-filler.ts` — wypełnianie pól formularza,
- `dom-parser.ts` — ekstrakcja danych ofert,
- `overlay-ui.tsx` — panel osadzony bezpośrednio w stronie Vinted.

#### 3. `src/background/`

Proponowane pliki:

- `service-worker.ts` — entry point dla backgroundu,
- `message-router.ts` — routing wiadomości między popupem, content scriptami i storage,
- `task-queue.ts` — prosta kolejka zadań,
- `scheduler.ts` — planowanie działań cyklicznych,
- `rate-limiter.ts` — limity tempa i cooldown,
- `session-state.ts` — pamięć aktywnej sesji i bieżącego zadania.

#### 4. `src/popup/`

Proponowane widoki:

- dashboard stanu,
- start/stop automatu,
- liczba wybranych aukcji,
- ostatnie logi,
- szybkie akcje typu „relist selected”, „resume”, „pause”.

#### 5. `src/options/`

Ustawienia:

- batch size,
- interwał między akcjami,
- losowe opóźnienia,
- tryb safe / aggressive,
- szablony wiadomości,
- klucz AI lub wyłączenie AI,
- eksport/import konfiguracji.

#### 6. `src/core/`

Wspólne elementy:

- `contracts.ts` — typy wiadomości,
- `storage.ts` — warstwa trwałego stanu,
- `logger.ts` — logowanie lokalne,
- `errors.ts` — wspólne typy błędów,
- `feature-flags.ts` — możliwość stopniowego włączania modułów.

## Proponowana struktura katalogów

```text
vinted-extension/
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ public/
│  ├─ icons/
│  └─ assets/
├─ src/
│  ├─ background/
│  │  ├─ service-worker.ts
│  │  ├─ message-router.ts
│  │  ├─ task-queue.ts
│  │  ├─ scheduler.ts
│  │  ├─ rate-limiter.ts
│  │  └─ session-state.ts
│  ├─ content/
│  │  ├─ vinted-page-observer.ts
│  │  ├─ listing-selector.ts
│  │  ├─ relist-runner.ts
│  │  ├─ form-filler.ts
│  │  ├─ dom-parser.ts
│  │  └─ overlay-ui.tsx
│  ├─ popup/
│  │  ├─ PopupApp.tsx
│  │  ├─ components/
│  │  └─ popup.css
│  ├─ options/
│  │  ├─ OptionsApp.tsx
│  │  ├─ components/
│  │  └─ options.css
│  ├─ core/
│  │  ├─ contracts.ts
│  │  ├─ storage.ts
│  │  ├─ logger.ts
│  │  ├─ errors.ts
│  │  └─ feature-flags.ts
│  └─ ai/
│     ├─ prompts.ts
│     ├─ template-engine.ts
│     └─ response-generator.ts
└─ README.md
```

## MVP funkcjonalne

### MVP v1

Zakres pierwszej wersji:

- wybór wielu aukcji z listy,
- lokalny batch relist,
- kontrola prędkości,
- logi sukcesów i błędów,
- wznawianie po zatrzymaniu,
- dashboard z licznikami.

### MVP v2

- harmonogram co X minut,
- wiadomości do obserwujących / zainteresowanych,
- backup danych ofert,
- eksport logów.

### MVP v3

- AI do odpowiedzi,
- wielokonto,
- zunifikowany panel wiadomości i sprzedaży,
- synchronizacja z backendem.

## Jak analizować cudzą wtyczkę przed pisaniem własnej

Poniższa checklista służy do audytu technicznego już pobranej lokalnie wtyczki, bez kopiowania jej kodu do nowego projektu:

1. Otwórz `manifest.json` i spisz permissions, content scripts, background worker, popup i options.
2. Zidentyfikuj główne entrypointy modułów.
3. Sprawdź, które pliki odpowiadają za overlay lub popup UI.
4. Sprawdź, jak komunikują się moduły: `chrome.runtime.sendMessage`, `chrome.tabs.sendMessage`, `chrome.storage`.
5. Wyszukaj selektory CSS i nazwy endpointów.
6. Sprawdź, czy relist działa przez DOM czy przez requesty.
7. Sprawdź, jak obsługiwane są błędy i retry.
8. Spisz wszystkie funkcje do osobnej tabeli: funkcja, wejście, wyjście, zależności.
9. Usuń z notatek wszystko, co byłoby dosłownym kopiowaniem kodu.
10. Na końcu napisz własny dokument wymagań i dopiero z nim pracuj w AI.

## Tabela wymagań funkcjonalnych

| Moduł | Opis | Priorytet |
|---|---|---|
| Batch relist | Masowe odnawianie wybranych aukcji | Wysoki |
| Scheduler | Automatyczne uruchamianie relistu co X minut | Wysoki |
| Overlay panel | Panel w stronie Vinted do kontroli akcji | Wysoki |
| Local logs | Historia wykonania, błędów i restartów | Wysoki |
| Rate limiter | Ograniczenie tempa działań | Wysoki |
| Resume queue | Wznowienie przerwanej kolejki | Średni |
| Message templates | Szablony wiadomości | Średni |
| AI replies | Automatyczne odpowiedzi z modelu | Niski |
| Multi-account | Obsługa wielu kont | Niski |

## Gotowe polecenie do AI

Poniższy prompt jest przygotowany tak, żeby wkleić go do modelu kodującego jako dokument startowy projektu.

---

### PROMPT STARTOWY

Zaprojektuj i zaimplementuj od zera rozszerzenie Chrome Manifest V3 do automatyzacji Vinted. Nie kopiuj żadnego cudzego kodu, nazw, layoutów ani tekstów marketingowych. Zbuduj własne rozwiązanie inspirowane ogólnymi funkcjami dostępnych narzędzi do relistingu Vinted.

#### Cel produktu

Rozszerzenie ma pomagać użytkownikowi zarządzać około 200 aukcjami na jednym koncie Vinted. Priorytetem jest bezpieczny, partiowy relist aukcji, z prostą kolejką zadań, lokalnymi logami i możliwością wznowienia pracy.

#### Wymagania techniczne

- Użyj Chrome Extension Manifest V3.
- Język: TypeScript.
- UI: React albo Preact dla popup i options page.
- Przechowywanie stanu: `chrome.storage.local`.
- Architektura: content scripts + service worker + popup + options.
- Kod ma być modularny, czytelny, gotowy do dalszej rozbudowy.
- Nie używaj zdalnie hostowanego kodu.
- Zadbaj o minimalne permissions.

#### Zakres MVP

1. Wykrywanie stron Vinted i inicjalizacja content scriptu.
2. Overlay UI w stronie z przyciskami: scan listings, select all, relist selected, pause, resume.
3. Parser aukcji z listy użytkownika.
4. Kolejka zadań relistingu w partiach.
5. Konfigurowalny batch size, delay i random jitter.
6. Log sukcesów, błędów i czasu wykonania.
7. Możliwość wznowienia przerwanej kolejki po odświeżeniu strony.
8. Popup z podsumowaniem statusu i ostatnich logów.
9. Options page z ustawieniami szybkości i trybem safe mode.

#### Zasady bezpieczeństwa

- Dodaj rate limiting i cooldown między akcjami.
- Dodaj tryb safe mode z dłuższymi opóźnieniami.
- Każdy krok relistingu musi mieć walidację sukcesu.
- Każdy błąd ma być logowany z kodem błędu i krótkim opisem.
- W przypadku błędu selektora system ma zatrzymać batch i oznaczyć zadanie jako wymagające interwencji.

#### Struktura projektu

Utwórz projekt w takiej strukturze:

```text
vinted-extension/
├─ manifest.json
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ background/
│  ├─ content/
│  ├─ popup/
│  ├─ options/
│  ├─ core/
│  └─ ai/
└─ README.md
```

#### Oczekiwane pliki do wygenerowania

- kompletny `manifest.json`,
- service worker,
- content script z parserem i runnerem relistingu,
- popup app,
- options app,
- warstwa storage,
- logger,
- kontrakty wiadomości,
- README z instrukcją local install w Chrome.

#### Styl implementacji

- Pisz produkcyjny, czysty kod.
- Dodaj typy i walidację danych wejściowych.
- Rozdziel kod UI, logikę domenową i komunikację z Chrome APIs.
- Nie rób monolitycznego jednego pliku.
- Przygotuj podstawy pod przyszłe moduły: AI replies, message templates, multi-account.

#### Kolejność pracy

1. Najpierw pokaż architekturę i plan plików.
2. Potem wygeneruj `manifest.json` i podstawowe kontrakty.
3. Następnie zbuduj background worker i storage.
4. Potem content scripts i overlay.
5. Następnie popup i options.
6. Na końcu README i checklistę testów manualnych.

#### Dodatkowe wymaganie

Po wygenerowaniu kodu podaj listę wszystkich miejsc, które użytkownik musi dostosować po zmianie UI Vinted, np. selektory i walidacje DOM.

---

## Krótszy prompt do dalszych iteracji

Jeżeli chcesz pracować z AI etapami, użyj tego krótszego promptu:

> Buduję własne rozszerzenie Chrome MV3 do Vinted. Chcę własną implementację od zera, bez kopiowania kodu konkurencji. Zacznij od modułu batch relist dla około 200 aukcji, z content scriptami, service workerem, popupem, local storage, logami i rate limitingiem. Najpierw zaproponuj strukturę plików i kontrakty wiadomości, a potem implementuj kod krok po kroku.

## Rekomendacja praktyczna

Dla Twojego przypadku najlepsza strategia to:

- przeanalizować lokalnie 1–2 wtyczki tylko pod kątem funkcji i architektury,
- spisać wymagania,
- dać AI powyższy prompt,
- budować własną wtyczkę od MVP relistu,
- AI replies i resztę dodać później.

Przy około 200 aukcjach najwięcej wartości da Ci własny, stabilny batch relist z dobrym rate limitingiem, a nie kopiowanie całego kombajnu konkurencji.[cite:4]
