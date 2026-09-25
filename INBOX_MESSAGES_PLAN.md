# INBOX_MESSAGES_PLAN.md — moduł P0 „Skrzynka / Wiadomości"

Status dokumentu: **plan do akceptacji** (audyt architektury, bez zmian w kodzie produkcyjnym).
Analiza wykonana na kodzie v0.3.1 (`src/core/*`, `src/background/background.ts`, UI, `scripts/build.cjs`),
testy bramkowe odpalone lokalnie: `typecheck ✓`, `build ✓`, `test 192/192 ✓`.

Zakres wg decyzji projektowej: skan konwersacji (tylko odczyt), szablony, rotacja,
historia wysłanych odpowiedzi, tryby `preview | manual | automatic` (domyślnie `manual`),
cooldowny i limity, wspólny zamek CAPTCHA. **Automatyczne wysyłanie wchodzi ostatnie.**
Nie dodajemy uprawnień ani nie wykonujemy operacji zapisu na Vinted w fazach 1–4.

---

## 1. Audyt istniejącej architektury — co wykorzystujemy

### 1.1 Powtarzalne wzorce (reusable)

| Istniejący element | Gdzie | Zastosowanie w module wiadomości |
| --- | --- | --- |
| Discriminated `ExtensionMessage` + `MessageResponseMap` + `sendMessage<T>` | `src/core/contracts.ts`, `src/shared/messaging.ts` | Nowe typy wiadomości `SCAN_CONVERSATIONS`, `GET_INBOX`, `GET_TEMPLATES`, `SAVE_TEMPLATE`, `RENDER_PREVIEW`, `SEND_MESSAGE`, `GET_MSG_SETTINGS`, `SET_MSG_SETTINGS`, `GET_SAFETY_LOCK`, `CLEAR_SAFETY_LOCK` — rozszerzenie union i mapy, zero `as any` |
| Wrapper storage z defaults + normalizacją starych wpisów | `src/core/storage.ts` (`vbr:settings`, `vbr:backups`) | Osobny moduł `src/core/messages/storage.ts` z kluczami `vbr:*` (wzorzec `getSettings`/`setSettings` z merge) |
| Strukturalne logi z merged zapisem (content ↔ background) | `src/core/logger.ts` (`log`, MAX_LOGS) | Logowanie każdego etapu: skan, render, preflight, wysyłka, błąd, odblokowanie zamka |
| Czyste funkcje bramkowe testowane w Node | `src/core/auto-relist.ts` (`evaluateAutoRelistGate`) | `evaluateMessageSendGate(...)` — czysta, bez `chrome.*`, osobny entry w `build.cjs`, testy na built artifacts |
| Preflight z kodami `block`/`warn` i podsumowaniem | `src/core/relist-preflight.ts` | `message-preflight`: blokada własnej wiadomości, duplikatu treści, braku cooldownu, aktywnego zamka |
| Alarm jako budzik SW, jeden krok na fire, re-entry guard, persist po każdym kroku | `src/core/queue.ts` (`ALARM_NAME = 'vbr-queue-step'`) | Wzorzec dla trybu `automatic` (osobny alarm `vbr-message-step`); ** QueueEngine NIE jest używany bezpośrednio ** — jest typowany pod `Listing`/`RelistResult`, więc dla wiadomości powstaje lekki `MessageRunner` o tym samym kształcie stanu |
| Fail-closed przy restarcie SW w trakcie efektu zewnętrznego | `src/core/queue.ts` (`init` → `running` → uncertain error + pause) | Sam `SEND_MESSAGE` w trakcie restartu = wynik nieznany → wpis `uncertain` w historii, pauza, zero automatycznego retry |
| Codzienny reset liczników (`lastDate`) | `src/core/storage.ts` (`getStats`) | Liczniki godzinowy/dzienny wiadomości (osobny klucz z oknem czasowym) |
| Snapshot skanu z timestampem i bramką świeżości | `src/core/scan-cache.ts` (`vbr:lastScan`, 7 dni) | `vbr:conversations` z `scannedAt`; brak świeżego skanu → tryb automatyczny nie rusza |
| Routing do aktywnej karty Vinted + retry martwego content scriptu | `src/background/background.ts` (`getTargetVintedTab`, `isDeadContentScriptError`, reload+retry) | `SCAN_CONVERSATIONS` idzie tą samą ścieżką; karta docelowa `/messages` |
| Zakres ścieżek w `src/content/selectors.ts` (`isUserListingsPath`, `isListingDetailPath`) | `src/content/page-detector.ts` | Dodanie `isMessagesPath` (`/messages`, `/messages/<id>`) i nowego `PageType: 'messages'` |
| Zakładki dashboardu (`data-tab` + sekcje `dash-tab`) | `src/dashboard/dashboard.html`, `dashboard.ts` | Nowa zakładka **Wiadomości** (lista, filtry, wyszukiwarka) |
| Sekcje `fieldset` w opcjach z zapisem bezpośrednio do storage + `storage.onChanged` | `src/options/*`, `background.syncAutoRelistAlarm` | Szablony CRUD + ustawienia automatyzacji w options; background reaguje na zmianę klucza |
| Rejestr modułów produktu | `src/core/product-modules.ts` (`id: 'messages'`, status `planned`) | Po wdrożeniu status `planned → active/partial`; na razie bez zmian |

### 1.2 Czego NIE reuse'ujemy (i dlaczego)

- **`QueueEngine`** — typowany pod `Listing` + `RelistResult` + preficy relistu. Przebudowa do generyka = duże ryzyko regresji relistu przed E2E. Dla wiadomości: własny lekki runner o tym samym rytmie (alarm → jeden krok → persist).
- **`AppSettings`/`vbr:settings`** — nie dopychamy pól wiadomości do istniejącego obiektu; osobny klucz `vbr:msgSettings`, żeby migracja i rollback dot. relistu pozostały nietknięte.
- **`ListingStatus`** — statusy kolejki relistu to inna dziedzina; konwersacje dostają własny `ConversationReplyStatus`.

### 1.3 Uwagi z audytu (nie blokujące, odnotowane)

- `dashboard.html` footer pokazuje `v0.2.3`, `popup.html` `v0.3.1` — drift wersji (znany pitfall); przy najbliższym bumpie wersji zaktualizować oba.
- `contracts.ts` rośnie (320 linii) — moduł wiadomości proponuje osobny plik kontraktów, żeby utrzymać „dependency-free” dla testów.
- Brak per-modułowego ESLinta dla nowych plików — nowe moduły core pokryć scoped lintem od razu.

---

## 2. Modele danych

Nowy plik: `src/core/messages/contracts.ts` (dependency-free, importowany przez UI, background i testy).

```ts
// ── Konwersacja (odczyt ze skanu, wyłącznie lokalnie) ─────────────
export type ConversationReplyStatus =
  | 'none'        // brak odpowiedzi z naszej strony
  | 'pending'     // czeka na zatwierdzenie / kolejkę
  | 'replied'     // odpowiedź wysłana (potwierdzona)
  | 'skipped'     // reguły ją pominęły (cooldown, własna wiadomość, …)
  | 'error'       // ostatnia próba nieudana
  | 'uncertain';  // restart SW w trakcie wysyłki — wynik nieznany

export interface Conversation {
  id: string;
  userId: string;
  username: string;
  /** Kontekst oferty powiązanej z rozmową (jeśli Vinted poda). */
  itemId?: string;
  itemTitle?: string;
  itemPrice?: number;
  currency?: string;
  lastMessageBody: string;
  /** Epoch ms ostatniej wiadomości w wątku. */
  lastMessageAt: number;
  /** Czy ostatnia wiadomość jest od nas — blokada odpowiedzi na własną. */
  lastMessageFromSelf: boolean;
  unreadCount: number;
  replyStatus: ConversationReplyStatus;
  lastError?: string;
}

export interface PersistedConversations {
  scannedAt: number;
  conversations: Conversation[];
}

// ── Szablon (model z decyzji projektowej, bez zmian) ──────────────
export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
  language?: string;
  tags?: string[];
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Rotacja (model z decyzji projektowej, bez zmian) ──────────────
export interface TemplateRotationState {
  conversationId: string;
  lastTemplateId?: string;
  usedTemplateIds: string[];
  lastSentAt?: string;
}

// ── Historia — rozróżnij rezerwację wyboru od realnego wysłania ───
export interface MessageHistoryEntry {
  id: string;                       // uuid
  conversationId: string;
  userId: string;
  templateId?: string;
  /** Pierwsze 160 znaków renderowanej treści (podgląd w UI). */
  bodyPreview: string;
  /** SHA-256 renderowanej treści — blokada duplikatu. */
  bodyHash: string;
  renderedAt: number;
  sentAt?: number;
  /**
   * reserved → wysyłka w toku (zapis PRZED wysłaniem, patrz algorytm rotacji)
   * sent     → potwierdzony sukces
   * failed   → błąd, wiadomość NIE została uznana za wysłaną
   * uncertain→ restart SW w trakcie; wymaga ręcznej weryfikacji
   */
  status: 'reserved' | 'sent' | 'failed' | 'uncertain';
  mode: 'preview' | 'manual' | 'automatic';
  error?: string;
}

// ── Ustawienia automatyzacji (kontrakt z decyzji projektowej) ─────
export interface MessageAutomationSettings {
  mode: 'preview' | 'manual' | 'automatic';   // domyślnie: 'manual'
  conversationCooldownMinutes: number;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  randomDelayMinSeconds: number;
  randomDelayMaxSeconds: number;
  stopOnCaptcha: boolean;
  stopAfterConsecutiveErrors: number;
  /** Nowe, z audytu: osobny cooldown per rozmówca (nie tylko per wątek). */
  userCooldownMinutes: number;
}

// ── Wspólny zamek bezpieczeństwa (dla relistu I wiadomości) ──────
export interface SafetyLock {
  active: boolean;
  reason?: 'captcha' | 'rate-limit' | 'consecutive-errors' | 'manual-pause';
  message?: string;
  lockedAt?: number;
  /** null = tylko ręczne odblokowanie; epoch ms = automatyczne po czasie. */
  unlockAt?: number | null;
}

// ── Zmienne szablonów — substitucja łańcuchowa, bez eval ──────────
export type TemplateVariables = Partial<
  Record<'username' | 'itemTitle' | 'itemPrice' | 'currency' | 'conversationId', string>
>;
```

### Nowe typy wiadomości (dopisać do `ExtensionMessage` + `MessageResponseMap`)

```ts
| { type: 'SCAN_CONVERSATIONS' }                       // read-only, przez kartę Vinted
| { type: 'GET_INBOX' }                                // ostatni zapisany skan
| { type: 'GET_TEMPLATES' }
| { type: 'SAVE_TEMPLATE'; payload: { template: MessageTemplate } }
| { type: 'DELETE_TEMPLATE'; payload: { id: string } }
| { type: 'RENDER_PREVIEW'; payload: { conversationId: string; templateId?: string } }
| { type: 'SEND_MESSAGE'; payload: { conversationId: string; templateId?: string; mode: 'manual' | 'automatic' } }
| { type: 'SET_CONVERSATION_STATUS'; payload: { id: string; status: ConversationReplyStatus } }
| { type: 'GET_MSG_SETTINGS' } | { type: 'SET_MSG_SETTINGS'; payload: Partial<MessageAutomationSettings> }
| { type: 'GET_MSG_HISTORY' } | { type: 'CLEAR_MSG_HISTORY' }
| { type: 'GET_SAFETY_LOCK' } | { type: 'CLEAR_SAFETY_LOCK' }
```

### Klucze storage (osobne namespace'y, wzorzec `vbr:*`)

`vbr:conversations`, `vbr:templates`, `vbr:msgHistory`, `vbr:msgSettings`,
`vbr:rotation`, `vbr:safetyLock`, `vbr:msgCounters` ({ hourKey, hourCount, dayKey, dayCount }).

Domyślne `msgSettings`: `mode: 'manual'`, `conversationCooldownMinutes: 30`,
`userCooldownMinutes: 120`, `maxMessagesPerHour: 6`, `maxMessagesPerDay: 30`,
`randomDelayMinSeconds: 20`, `randomDelayMaxSeconds: 90`, `stopOnCaptcha: true`,
`stopAfterConsecutiveErrors: 3`.

---

## 3. Proponowany układ plików

```text
src/
  core/
    contracts.ts                 # + nowe typy wiadomości (dopisanie union/mapy)
    safety-lock.ts               # czysty zamek CAPTCHA/rate-limit, współdzielony z relistem
    messages/
      contracts.ts               # Conversation, Template, Rotation, History, Settings
      template-engine.ts         # renderTemplate(body, vars) — czysta, bez eval
      rotation.ts                # pickTemplate(state, templates, lang) — czysta
      cooldown.ts                # evaluateMessageSendGate(...) — czysta bramka
      message-preflight.ts       # block/warn issues, wzorzec relist-preflight
      storage.ts                 # get/set dla kluczy vbr:conversations/templates/msg*
  content/
    inbox-selectors.ts           # WSZYSTKIE selektory wiadomości w jednym miejscu
    inbox-scanner.ts             # read-only skan konwersacji (API strony lub DOM)
  background/
    background.ts                # dopisać case'y w handleMessage + inicjalizacja
    (opcjonalnie) message-runner.ts  # tryb automatic, alarm vbr-message-step
  dashboard/                     # zakładka „Wiadomości" (lista, filtry, wyszukiwarka)
  options/                       # sekcja: szablony CRUD + ustawienia automatyzacji
scripts/build.cjs                # + entry: core/messages/*, core/safety-lock
tests/
  template-engine.test.mjs
  rotation.test.mjs
  cooldown.test.mjs
  safety-lock.test.mjs
```

Uwaga: `src/modules/messages/` (docelowy layout z PRODUCT_MODULES.md) — **nie przenosimy**
istniejących plików; nowy moduł zakładamy jako `src/core/messages/`, a fizyczny ruch
katalogów dopiero przy konkretnej potrzebie (reguła z ARCHITECTURE.md).

---

## 4. Przepływ danych

### 4.1 Skan (faza read-only)

```text
Dashboard „Wiadomości" → sendMessage(SCAN_CONVERSATIONS)
  → background: getTargetVintedTab(sender, 'inbox')     [istniejący routing]
      · brak karty Vinted → otwórz /messages w tle lub zwróć komunikat
  → tabs.sendMessage → content: detectPage() == 'messages'
      · isMessagesPath() + inbox-scanner
      · źródło A (preferowane): fetch API strony /api/v2/conversations z sesją strony
      · źródło B (fallback): widoczne karty DOM (jak visible-dom-fallback w garderobie)
      · KONIECZNIE read-only: zero POST w fazach 1–4
  → background: zapis vbr:conversations {scannedAt, conversations}
  → UI renderuje + timestamp ostatniego skanu
```

### 4.2 Renderowanie podglądu (preview)

```text
UI → RENDER_PREVIEW {conversationId, templateId?}
  → background: wczytaj konwersację + szablony
  → rotation.pickTemplate (jeśli brak templateId i włączone)
  → templateEngine.renderTemplate(body, {username, itemTitle, itemPrice, currency, conversationId})
  → zwróć renderowany tekst — BEZ zapisu historii, BEZ wysyłki
```

### 4.3 Wysyłka (manual — pierwsza akcja zapisu na Vinted)

```text
UI ( użytkownik klika „Wyślij") → SEND_MESSAGE {mode: 'manual'}
  → background, sekwencyjnie:
     1. safetyLock aktywny?            → {ok:false, code:'safety-lock-active'}
     2. evaluateMessageSendGate()      → cooldown per wątek / per rozmówca /
                                         limit godz./dzień / duplikat (bodyHash)
     3. preflight: lastMessageFromSelf → block (osobny override „wyślij mimo to"
                                         tylko w trybie manual, jawny)
     4. ROTATION: pickTemplate → zapis wpisu history {status:'reserved'}
                                         (rezerwacja PRZED wysłaniem)
     5. content: SEND_ON_CONVERSATION — tylko jeśli karta jest na /messages/<id>
        · sukces (potwierdzenie z DOM/API) → status:'sent', sentAt, usageCount+1
        · błąd                          → status:'failed', NIE liczymy jako wysłana
        · SW restart po punkcie 4        → status:'uncertain' przy next init
          (wzorzec QueueEngine.init) → pauza + ręczna weryfikacja
     6. log każdej operacji (logger)
```

### 4.4 Automatic (ostatnia faza, dopiero po E2E preview/manual)

```text
chrome.alarms 'vbr-message-step' (jeden krok na fire, re-entry guard)
  → gate: mode=='automatic' && !safetyLock && świeży skan && kolejka relistu idle
  → wybierz następną konwersację replyStatus in ('none','error')
  → ta sama ścieżka co 4.3 z mode:'automatic'
  → po błędzie: consecutiveErrors++; >= stopAfterConsecutiveErrors →
      safetyLock {reason:'consecutive-errors'} + pauza
  → DataDome/429 wykryte → safetyLock {reason:'captcha'|'rate-limit'}, zero retry
  → przycisk „Wstrzymaj automatyzację" w UI → manual-pause lock
```

Wykrywanie CAPTCHA (wspólne dla relistu i wiadomości): content script widzi
wyzwanie DataDome (blokada/overlay/redirect) lub API zwraca 403/429 →
`SET_SAFETY_LOCK {reason:'captcha'}` → background: `queue.pause()` (jeśli running),
zablokuj `SEND_MESSAGE` i `runAutoRelistCycle`, komunikat „Poczekaj 5–15 minut”,
wpis do historii zdarzeń, odblokowanie wyłącznie ręczne (`CLEAR_SAFETY_LOCK`).

---

## 5. Ryzyka

| Ryzyko | Skutek | Mitygacja |
| --- | --- | --- |
| Wysyłka w trakcie restartu SW | Podwójna wiadomość albo zgubiony sukces | Rezerwacja `reserved` przed wysłaniem; restart → `uncertain` + pauza, zero automatycznego retry (fail-closed jak w QueueEngine) |
| DataDome / blokada konta | Utrata sesji, CAPTCHA, w skrajności ban | Domyślnie `manual`; twarde limity (6/h, 30/d); safety lock bez retry; brak prób obchodzenia CAPTCHA |
| Odpowiedź na własną wiadomość / spam do rozmowy | Wygląda jak bot, reporty kupujących | Preflight `lastMessageFromSelf`; cooldown per wątek i per rozmówca; deduplikacja po `bodyHash` |
| Rotacja wybierze wyłączony/zły szablon | Nietreściwa wiadomość | Filtr `enabled` + język przed losem; rezerwacja wyboru przed wysłaniem; przy błędzie brak `usageCount`/historii `sent` |
| Template injection (vars z treścią) | Podszywanie się / JS w szablonie | Wyłącznie substitucja łańcuchowa, zero `eval`/`Function`; nieznane zmienne → puste + warning w logu |
| Endpoint wysyłki Vinted nieznany | Zablokowany spike w fazie 4 | Osobne taski: obserwacja sieci (read-only) zanim napiszemy sender; DOM-fallback tylko na stronie konwersacji |
| Rozrost `contracts.ts` | Regresje typów w reliście | Osobny `src/core/messages/contracts.ts` |
| Prywatność | Treści rozmów lokalnie | Tylko `chrome.storage.local`, brak telemetrii; `CLEAR_MSG_HISTORY` w UI |
| Kolejka relistu vs messaging | Kolizja kart/akcji | Bramka: automatic nie startuje gdy relist queue ≠ idle (wzorzec `evaluateAutoRelistGate`) |

---

## 6. Testy akceptacyjne

### Bramka kodu (każda faza)
`npm run typecheck && npm run build && npm test` — czysto (obecnie 192/192).
Nowe moduły czyste dostają entry w `build.cjs` i testy importujące `dist/core/*`.

### Faza 1 — kontrakty (czyste funkcje, zero UI)
- `renderTemplate`: podstawia wszystkie 5 zmiennych; nieznana zmienna → '' + brak wyjątku; treść z `${...}`/`{{...}}` spoza listy nietknięta; zero wykonania kodu (assert na braku efektów ubocznych).
- `pickTemplate`: filtruje `exclude`; nigdy nie zwraca `lastTemplateId` gdy istnieje alternatywa; jedyny szablon ≠ ostatni → zwraca go; pula pusta → `undefined`; deterministyczny seed w testach.
- `evaluateMessageSendGate`: cooldown wątku, cooldown rozmówcy, limit godz., limit dnia, duplikat `bodyHash`, własna wiadomość, aktywny safety lock — każdy kod `block` z jasnym powodem.
- `safety-lock`: aktywny blokuje; `unlockAt` w przeszłości → auto-odbiór tylko dla `rate-limit`, `captcha` zawsze ręczny.

### Faza 2 — skaner (read-only)
- Manual E2E: otwórz `/messages`, skan zwraca listę (id, username, ostatnia wiadomość, data, unread), zapis `vbr:conversations` z `scannedAt`, powtórny skan nie duplikuje.
- Fallback DOM zadziała gdy API niedostępne (log z przyczyną).
- **Zero żądań zapisu** — audyt w Network: wyłącznie GET.

### Faza 3 — UI
- Zakładka Wiadomości: filtry (wszystkie/nieprzeczytane/oczekujące/odpowiedziane/błędy), wyszukiwarka po username, link „Otwórz rozmowę”, ręczne odświeżenie, timestamp ostatniego skanu, pusty stan.
- Szablony w options: CRUD + walidacja pustego body.

### Faza 4 — preview + manual (pierwsza wysyłka)
- Preview renderuje i **nie** tworzy wpisu historii.
- Manual: jedno kliknięcie = jedna wysyłka; `reserved → sent` po potwierdzeniu; błąd → `failed` (nigdy `sent`); druga próba w cooldown → block z powodem.
- Własna ostatnia wiadomość → block (i ścieżka override tylko w manual).
- Zrestartuj SW między `reserved` a potwierdzeniem → przy starze `uncertain` + pauza, brak retry.
- Po wysyłce: `usageCount`/`lastUsedAt` zaktualizowane, log obecny.

### Faza 5 — automatic (osobna akceptacja, po PASS fazy 4)
- Opcjonalne, domyślnie `manual`; alarm wykonuje dokładnie jeden krok na fire.
- Limity: po `maxMessagesPerHour` cykl się kończy z jasnym logiem pominięcia.
- Seria `stopAfterConsecutiveErrors` → lock `consecutive-errors` + pauza.
- Wykrycie CAPTCHA → lock, zero dalszych prób, komunikat 5–15 min.
- „Wstrzymaj automatyzację” działa w 1 kliknięcie; relist queue nigdy nieprzerwany.

---

## 7. Lista zadań w kolejności implementacji

> Kolejność zgodna z decyzją: kontrakty → skaner → UI → preview/manual → automatic.
> Każde zadanie kończy się `typecheck + build + test` i aktualizacją WORKFLOW_STATE.md.

1. **T1 — Kontrakty i czysta logika.** `src/core/messages/contracts.ts`, `template-engine.ts`, `rotation.ts`, `cooldown.ts`, `safety-lock.ts`, `storage.ts`; rozszerzenie `ExtensionMessage`/`MessageResponseMap`; entry w `build.cjs`; testy jednostkowe. Bez UI, bez wysyłki.
2. **T2 — Bramki bezpieczeństwa przed jakimkolwiek zapisem.** `message-preflight` + integracja `safetyLock` z istniejącym ścieżkami błędu relistu (401/403/429 → lock), przycisk statusu lock w UI (tylko odczyt/clear). Refaktor minimalny, wspólny dla obu modułów.
3. **T3 — Skaner konwersacji (read-only).** `inbox-selectors.ts` (`isMessagesPath`), `inbox-scanner.ts`, route `SCAN_CONVERSATIONS`/`GET_INBOX` w background, zapis `vbr:conversations`. Manual E2E read-only + audyt Network (zero POST).
4. **T4 — UI skrzynki.** Zakładka „Wiadomości” w dashboardzie (lista, filtry, wyszukiwarka, otwarcie rozmowy, odświeżenie, timestamp), badge nieprzeczytanych. Wciąż zero wysyłki.
5. **T5 — Szablony i podgląd.** CRUD w options, `RENDER_PREVIEW`, zmienne szablonowe, rotacja w podglądzie. Testy E2E podglądu.
6. **T6 — Wysyłka manual (pierwszy zapis).** Spike: ustalić mechanizm wysyłki Vinted (obserwacja sieci read-only) → `SEND_ON_CONVERSATION` w content, `SEND_MESSAGE` w background z pełnym łańcuchem bramek, historia `reserved/sent/failed`. **Domyślny tryb `manual`.** Pełny E2E: 1 rozmowa, 1 wiadomość, historia, cooldown, restart SW.
7. **T7 — Historia i statusy w UI.** Widok historii wiadomości, ustawienia automatyzacji w options (wszystkie pola kontraktu), liczniki godz./dzien.
8. **T8 — Tryb automatic (ostatni).** `MessageRunner` na alarmie `vbr-message-step`, `stopOnCaptcha`, `stopAfterConsecutiveErrors`, „Wstrzymaj automatyzację”, bramka vs. kolejka relistu. Wymaga osobnej akceptacji + ewentualnie uprawnienia `notifications` (dodawać wyłącznie za zgodą użytkownika).
9. **T9 — Aktualizacja metadanych.** `product-modules.ts` (`messages`: planned → partial/active), `PRODUCT_MODULES.md`, `WORKFLOW_STATE.md`, wersja w manifest/package/HTML/README synchronizacja (przy okazji: fix `v0.2.3` w dashboard.html).

NIE w tym zakresie: AI (klucz OpenAI), oferty/faworyci, follow, crosslisting Leboncoin, multi-konto, powiadomienia `chrome.notifications` (osobna zgoda), jakiekolwiek automatyczne wysyłki przed PASS T6.

---

## 8. Status E2E relistu (weryfikacja analityczna)

```text
STATUS: NOT VERIFIED
```

**Dowody (analiza kodu i testów, zgodnie z poleceniem):**
- `WORKFLOW_STATE.md` — Current task: „run one controlled real-listing E2E… Logged-in Chrome E2E remains manual.”
- `TASKS.md:39` — pozycja otwarta: „Blocked pending manual E2E on logged-in Vinted…”; `TASKS.md:60,76,87,110` — kroki manualne wciąż nieodhaczone.
- `PRODUCT_MODULES.md:118` — „Real detail-page relist E2E confirmation is still pending.”
- Automaty: `npm test` → **192/192 pass**, ale wszystkie to testy Node na mockach (`dist/core/*`) — pokrywają kolejkę, bramki, cooldowny, priorytety; **nie dotykają realnej strony Vinted**.
- Odnotowane wyniki częściowe z realnej sesji (TEST_PLAN.md): skan zwrócił 20 ofert z `vinted.pl/member/107890191`; 5 błędów E2E naprawionych (slug URL, selektor przycisku, alarm zamiast setTimeout). To dowód skanu, NIE dowód pełnego łańcucha relistu.

**Minimalny test do PASS (checklist z decyzji projektowej):**
```text
1 oferta → scan → backup → relist → verification (nowy ID) → history
→ second run → no duplicate    [+ pause/resume kolejki]
```
Dopiero po pozytywnym wyniku tej checklisty status zmienia się na `PASS`
i ruszają prace przekraczające dotychczasową bramkę (T6+ i dalsze moduły).

---

## 9. Zgody / ograniczenia na czas tego zadania

- Nie zmieniono kodu produkcyjnego (tylko odczyt + uruchomienie istniejącej bramki testowej).
- Nie dodano uprawnień manifestu.
- Nie wykonano żadnych operacji zapisu na Vinted (skan read-only dopiero w T3, za zgodą).
- Żadna wiadomość nie została wysłana ani zaplanowana do wysłania.
