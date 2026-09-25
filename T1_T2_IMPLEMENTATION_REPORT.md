# T1_T2_IMPLEMENTATION_REPORT.md

Etap: **T1 — kontrakty i czysta logika wiadomości** + **T2 — Safety Lock**
Projekt: `powerfitwarszawa-sys/vinted-relist-extension` (v0.3.1, branch `main`)
Data: 2026-09-25

---

## 1. Lista plików

### Kod produkcyjny — `src/core/messages/` (7 plików, 870 linii)

| Plik | Linie | Zawartość |
| --- | ---: | --- |
| `contracts.ts` | 328 | Wszystkie typy modułu (patrz §2), własna `MessageResponseMap` |
| `cooldown.ts` | 193 | `evaluateMessageCooldown` — bramka cooldown/limitów |
| `safety-lock.ts` | 144 | T2: `createSafetyLock`, `isSafetyLockActive`, `canStartMessageOperation`, `releaseSafetyLock` |
| `template-rotation.ts` | 75 | `selectNextTemplate` — czysta rotacja z wstrzykniętym `random` |
| `template-engine.ts` | 68 | `renderMessageTemplate` — czysty render szablonów |
| `message-errors.ts` | 43 | `MessageErrorCode` + `messageFailure` (wspólne kody) |
| `index.ts` | 19 | Publiczny surface modułu (re-eksporty) |

### Testy — `tests/messages/` (5 plików, 849 linii)

| Plik | Linie | Zakres |
| --- | ---: | --- |
| `cooldown.test.mjs` | 318 | 30 asercji: limity, granice czasu, fail-closed, priorytety, czystość |
| `safety-lock.test.mjs` | 187 | 38 asercji: każdy powód, granice `unlockAt`, zwolnienia, czystość |
| `template-rotation.test.mjs` | 156 | 20 asercji: determinizm, wykluczenia, brak `Math.random` |
| `template-engine.test.mjs` | 155 | 22 asercje: zmienne, powtórzenia, puste, specjalne, nieznane |
| `build.mjs` | 33 | Testowy bundler esbuild (patrz §6 „Uwagi") |

### Konfiguracja
- `package.json` — wyłącznie `scripts.test`: dopięte 5 plików testowych (dozwolone wg zakresu).

**Razem: 13 plików w commicie kodu (1720 linii) + ten raport.**

---

## 2. Opis kontraktów (`src/core/messages/contracts.ts`)

Wymagane typy — wszystkie obecne, bez `any`, identyfikatory `string`, daty ISO-8601:

| Typ | Rola |
| --- | --- |
| `Conversation` + `ConversationReplyStatus` | Stan rozmowy: `none \| pending \| replied \| skipped \| error \| uncertain` |
| `MessageTemplate` | Model szablonu — dokładnie wg specyfikacji (ISO dates, `usageCount`) |
| `TemplateRotationState` | Stan rotacji per rozmowa (`lastTemplateId`, `usedTemplateIds`) |
| `MessageAutomationSettings` | Tryby + limity: cooldown rozmowa/użytkownik, godz./dzien, opóźnienia, `stopOnCaptcha`, `stopAfterConsecutiveErrors` |
| `MessageHistoryEntry` + `MessageHistoryStatus` | Historia: `reserved \| sent \| failed \| uncertain` — `reserved` zapisywany PRZED wysłaniem |
| `MessageTask` + `MessageTaskStatus` | Zadanie (przyszły runner): `queued \| running \| paused \| success \| error \| uncertain` |
| `MessageMode` | `preview \| manual \| automatic` |
| `MessageSafetyLock` + `MessageSafetyLockReason` + `SafetyLockReleaseResult` | Model zamka (T2) + wynik zwolnienia |
| `MessageResponseMap` | Własna mapa odpowiedzi 13 przyszłych typów wiadomości — wzorzec identyczny jak w `src/core/contracts.ts`, gotowa do scalenia z `sendMessage<T>` bez zmian call-site'ów |

Dodatkowo (pomocnicze): `PersistedConversations`-odpowiednik (`InboxResponse`), `RenderedMessage`,
`MessageTemplateVariables`, `TemplateSelectionResult`, `CooldownInput`/`CooldownResult`, `MessageOpResponse`.

**Nienaruszone**: `Listing`, `ListingStatus`, `SellerListingStatus`, `AppSettings`, kontrakty kolejki
relistu — `src/core/contracts.ts` nie został w żaden sposób zmieniony (diff 0 w tym pliku).

Rozdzielenie statusów celowe: status rozmowy, zadania i historii to trzy osobne unie — `uncertain`
obecny w każdej, tam gdzie wynik operacji zewnętrznej może pozostać nieznany.

---

## 3. Opis czystych funkcji

### `renderMessageTemplate(template, variables): RenderedMessage`
- 5 zmiennych: `{{username}}`, `{{itemTitle}}`, `{{itemPrice}}`, `{{currency}}`, `{{conversationId}}` (whitespace w nawiasach dozwolony).
- **Nieznana zmienna → jawnny błąd**: `ok: false`, `error` wymieniający placeholder, placeholder w tekście zostaje, nazwy w `unknownVariables`.
- Zmienna wspierana, ale niepodana (opcjonalna/nieużyta): placeholder **zostaje w tekście**, zgłoszony w `missingVariables`, `ok` nadal `true`.
- Podstawianie jednoprzebiegowe przez callback — wartości ze `$&`, `` $` ``, `$1` zostają literalne; wstawiony tekst nie jest re-skanowany (brak injekcji rekurencyjnej).
- Zero efektów ubocznych: brak DOM/storage/sieci/zegara.

### `selectNextTemplate(templates, state, random): TemplateSelectionResult`
- Pomija wyłączone; nigdy nie zwraca `lastTemplateId`, gdy jest alternatywa; jedyny włączony = ostatni → powtórka zamiast deadlocku.
- Błędy jawne: `no-templates` (pusta pula), `no-enabled-templates` (wszystkie wyłączone).
- `random` wstrzykiwany — **`Math.random()` nigdy nie jest wywoływany w logice** (test ze zepsutym `Math.random` rzucającym wyjątek to potwierdza). NaN/funkcja-niefunkcja/wartości <0 lub ≥1 są klamrowane do bezpiecznego indeksu.
- Funkcja nie mutuje `state` ani tablicy szablonów (zapis wyboru = osobny krok po stronie wywołującego).

### `evaluateMessageCooldown(input): CooldownResult`
- `nowMs` zawsze w argumencie — testy nie czytają zegara systemowego.
- Priorytet (pierwszy trafiony blok raportowany):
  1. `in-flight` (istnieje `reserved` dla rozmowy),
  2. `uncertain-verification-required` (istnieje `uncertain`),
  3. `duplicate-content` (ta sama treść już `sent` w tej rozmowie),
  4. `hourly-limit`, 5. `daily-limit` (liczone z historii, okna 1 h / 24 h, `retryAtMs` = czas zwolnienia okna),
  6. `conversation-cooldown`, 7. `user-cooldown` (`retryAtMs` = ostatni wysłany + cooldown).
- Fail-closed: `nowMs` NaN → blokada; nieznany/psuty ISO `sentAt` wpisu `sent` → blokada rozmowy/użytkownika („unknown time"); `cooldownMinutes` NaN/nielegalne → nieskończony cooldown; limit NaN/ujemny → pojemność 0.
- Wpisy `failed` nie są wysyłką: nie blokują, nie liczą się do limitów, nie triggują duplikatu.
- Brak mutacji wejścia; `history` typu `... | null | undefined` (runtime tolerancja = pusta historia).

---

## 4. Opis Safety Lock (`src/core/messages/safety-lock.ts`, T2)

Powody (wg specyfikacji): `captcha | rate-limit | session-expired | consecutive-errors | manual | uncertain-operation`.

| Funkcja | Zachowanie |
| --- | --- |
| `createSafetyLock(reason, now, until?, metadata?)` | Aktywny lock z ISO `createdAt`; `until` zapisywane jako `unlockAt` **tylko dla powodów czasowych** (`captcha`, `rate-limit`, `session-expired`, `consecutive-errors`) — dla `manual`/`uncertain-operation` wymuszone `null`. Złośliwe `now` nie rzuca wyjątku (fallback ISO epoch 0) |
| `isSafetyLockActive(lock, now)` | Nieaktywny/nieobecny → `false`. Aktywny → `true`, chyba że powód czasowy i `now >= unlockAt` (równe = wygasł). Nieznany zegar (`NaN`) i zepsute `unlockAt` → `true` (fail-closed). Obcy `unlockIn` przy powodzie nietczasowym → ignorowany |
| `canStartMessageOperation(lock, now)` | `!isSafetyLockActive` — aktywny zamek **zawsze** blokuje start, nieaktywny nigdy nie blokuje |
| `releaseSafetyLock(lock, now, actor)` | Zwraca **nowy** obiekt (input nietknięty); idempotentne dla już nieaktywnego; `system` nie zwolni `manual`/`uncertain-operation` (tylko `user`, jawne wywołanie); `now` NaN → odmowa zwolnienia; brak locka → bezpieczny nieaktywny wynik |

Brak wykrywania CAPTCHA, brak wysyłania wiadomości, brak integracji z resztą kodu — czysta logika
zgodnie z zakresem. Detekcja i routing zamka to zadania późniejszych faz.

---

## 5. Wyniki testów

```text
npm run typecheck  → PASS (tsc --noEmit, 0 błędów)
npm run build      → PASS (tsc + esbuild + assets, 1.0s)
npm run test       → PASS 302/302, 0 failed
    istniejące (bez zmian): 100 + 16 + 2 + 9 + 38 + 27 = 192/192
    nowe (T1/T2):           22 + 20 + 30 + 38        = 110/110
npx eslint src/core/messages → 0 problemów
```

Pokrycie wymaganych kategorii testów:
- renderowanie szablonów (22): puste wartości, znaki specjalne, powtórzenia, nieznane placeholdery, unicode, determinizm;
- rotacja (20): deterministyczne losowanie wstrzyknięte, brak natychmiastowego powtórzenia, wyłączone, puste, błędne dane, brak mutacji, brak `Math.random`;
- cooldowny (30): każdy kod blokady, granice czasowe (±1 ms i dokładnie-okno), limity, priorytety, fail-closed, czystość danych;
- Safety Lock (38): każdy powód, granice `unlockAt` (przed/równe/po), `uncertain` bez auto-timeoutu, `system` vs `user`, odmowy, czystość.

---

## 6. Uwagi i odstępstwa (jawne)

1. **`scripts/build.cjs` poza zakresem** → testy nie importują `dist/core/*` jak pozostałe testy w repo.
   Rozwiązanie wyłącznie w `tests/messages/`: `build.mjs` buduje moduł esbuildem do
   `node_modules/.cache/` (gitignored) przed uruchomieniem testów. Produkcjny build nietknięty.
   Gdy moduł zostanie podpięty pod tło/UI, wejścia trafią do `build.cjs` w osobnym zadaniu
   (wymaga to rozszerzenia zakresu — zgłoszone, nie wykonane samowolnie).
2. `CooldownInput.history` ma typ `readonly MessageHistoryEntry[] | null | undefined` —
   tolerancja runtime dla niezainicjowanego storage (traktowane jako pusta, fail-safe).
3. Kolejność priorytetów bramki cooldown jest w §3 i w nagłówku `cooldown.ts` — wpływa na to,
   który kod widzi UI przy wielu naruszeniach naraz.
4. `MessageResponseMap` jest **osobna** (w `messages/contracts.ts`) — scalenie z istniejącą mapą
   w `src/core/contracts.ts` dopiero w fazie T3+ (wymaga zmiany pliku spoza dzisiejszego zakresu).
5. Zgodnie z poleceniem nie zaktualizowano `TASKS.md` / `WORKFLOW_STATE.md` (poza zakresem) —
   do wykonania przy okazji zatwierdzenia etapu.

---

## 7. Hash commita

```text
916439524746a82fec3944e436c8f34b6777c56e   feat(messages): T1 contracts and pure logic + T2 safety lock
                                            (13 plików, +1720 −1)
```
Raport dostarczony commitem osobnym (poniżej). **Push NIE został wykonany** — czeka na zgodę.

Stan repo: lokalne `main` — `157fc63` → `64e5950` → `9164395` (kod) → commit z tym raportem.
`origin/main` bez zmian od `64e5950` (push wstrzymany).

---

## 8. Potwierdzenie ograniczeń

| Wymaganie | Status |
| --- | --- |
| Zmiany wyłącznie w `src/core/messages/**`, `tests/messages/**`, `package.json` (skrypty testowe) | ✅ `git status`: tylko te ścieżki (raport = wymagany deliverable) |
| Brak nowych uprawnień | ✅ `manifest.json` nietknięty (diff pusty) |
| Brak zmian w manifeście / wersji | ✅ wersja 0.3.1 bez zmian |
| Brak operacji na Vinted | ✅ zero wywołań sieci, zero otwierania kart |
| Brak wysyłania wiadomości | ✅ brak jakiejkolwiek ścieżki wysyłki w kodzie |
| Brak automatycznego relistu | ✅ kod relistu nietknięty |
| Brak issue / pull requesta | ✅ |
| Brak pusha | ✅ czeka na zgodę |
| `typecheck / build / tests` PASS | ✅ §5 |
