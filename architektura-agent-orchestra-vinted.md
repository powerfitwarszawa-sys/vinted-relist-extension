# Architektura: agent orchestration dla wtyczki Chrome do automatyzacji Vinted

## Cel

Celem systemu jest zbudowanie rozszerzenia Chrome dla Vinted, które wykonuje akcje w przeglądarce, ale jest sterowane przez warstwę orkiestracji agentów zdolną do planowania pracy, wykonywania tasków, retry po błędach oraz działania przez dłuższy czas bez utraty stanu.[cite:84][cite:96][cite:102][cite:104]

Architektura powinna rozdzielać automatyzację interfejsu użytkownika od logiki planowania i durable execution, ponieważ Manifest V3 opiera się na service workerze uruchamianym tylko wtedy, gdy jest potrzebny, a nie na stale aktywnym background page.[cite:84][cite:96][cite:98]

## Założenia projektowe

System zakłada trzy warstwy: rozszerzenie Chrome jako egzekutor akcji na stronie, backend aplikacyjny jako API i magazyn stanu oraz warstwę orkiestracji agentów do prowadzenia długich workflowów.[cite:84][cite:99][cite:102]

Content scripts są właściwym miejscem do pracy z DOM strony, natomiast service worker nie ma bezpośredniego dostępu do DOM i musi komunikować się przez messaging lub `chrome.scripting`.[cite:96][cite:98][cite:103]

Długie zadania, retry, timeouty i wznowienia po awarii powinny być utrzymywane poza samą wtyczką, ponieważ Temporal jest projektowany właśnie do durable workflows i długotrwałych procesów agentowych.[cite:99][cite:102][cite:104]

## Komponenty

### 1. Chrome Extension (MV3)

Rozszerzenie powinno używać Manifest V3, ponieważ jest to aktualny model platformy Chrome Extensions.[cite:84][cite:96]

Wewnątrz rozszerzenia powinny istnieć następujące moduły:

- `content-scripts/vinted-listing.ts` — odczyt DOM, autofill formularzy, kliknięcia, relisting, pobieranie danych z ofert.[cite:98]
- `background/service-worker.ts` — routing wiadomości, odbiór poleceń z backendu, krótkie kolejki akcji, heartbeat sesji, synchronizacja stanu.[cite:96][cite:98]
- `popup/` — panel start/stop, status bieżącego tasku, wybór profilu, logi ostatnich akcji.[cite:94][cite:95]
- `options/` — konfiguracja kont, throttling, limity, reguły bezpieczeństwa, endpoint backendu.[cite:94][cite:95]

Service worker powinien być traktowany jako lekki kontroler zdarzeń, a nie jako miejsce dla ciężkiej logiki biznesowej, ponieważ MV3 nie gwarantuje ciągłego działania procesu w tle.[cite:96][cite:97]

### 2. API Backend

Backend powinien udostępniać API dla wtyczki, panelu operatorskiego oraz orkiestratora agentów. Najbardziej naturalny stack dla tego projektu to FastAPI + PostgreSQL, bo dobrze pasuje do systemu tasków, kolejek, historii akcji i integracji z agentami.[cite:101][cite:104]

Minimalne moduły backendu:

- `auth-service` — użytkownicy, urządzenia, profile przeglądarki, tokeny sesyjne.
- `task-service` — zadania typu relist, bulk edit, message follow-up, sync inventory.
- `workflow-service` — instancje workflowów, statusy, retry count, blokady i eskalacje.
- `log-service` — eventy techniczne, screenshot references, audit trail.
- `agent-gateway` — adapter do modeli i agent runtime, np. Claude, Kimi, DeepSeek, OpenRouter.[cite:101][cite:105]

### 3. Warstwa orchestration

Warstwa orchestration powinna być oparta o workflow engine zdolny do durable execution, a Temporal jest tu najbardziej naturalnym wyborem według materiałów o durable AI agents i multi-agent architecture.[cite:99][cite:102][cite:104][cite:107]

Temporal pozwala utrzymywać stan workflowu, wznawiać go po awarii, wykonywać retry i kontrolować timeouty bez utraty kontekstu procesu.[cite:102][cite:104]

### 4. Runtime agentów

Runtime agentów powinien być rozdzielony na role, zamiast jednego dużego agenta. Materiały o durable agents i multi-agent flows pokazują sens wzorca planner → executor → verifier.[cite:99][cite:105]

Proponowane role:

- `PlannerAgent` — rozbija cel biznesowy na taski wykonawcze i ustala kolejność.[cite:105]
- `BrowserExecutorAgent` — tłumaczy task na kroki przeglądarkowe możliwe do wykonania przez wtyczkę.[cite:98][cite:105]
- `VerifierAgent` — sprawdza rezultat na podstawie odpowiedzi, logów i snapshotów.[cite:105]
- `RecoveryAgent` — proponuje alternatywną ścieżkę po błędzie lub zmianie UI.[cite:104][cite:105]
- `PolicyAgent` — kontroluje limity ryzyka, np. tempo akcji, cooldown, maksymalną liczbę prób.[cite:107]

## Przepływ end-to-end

Przykładowy workflow dla zadania „wystaw 50 aukcji z draftów” powinien wyglądać następująco:[cite:102][cite:105]

1. Operator lub harmonogram tworzy zlecenie w backendzie.[cite:104][cite:107]
2. Temporal uruchamia workflow `publish_listings_workflow`.[cite:102][cite:104]
3. `PlannerAgent` rozbija zadanie na paczki, np. po 5 lub 10 ofert.[cite:105]
4. `BrowserExecutorAgent` generuje plan kroków dla danej paczki.[cite:105]
5. Backend wysyła task do konkretnej aktywnej wtyczki Chrome przypisanej do sesji użytkownika.[cite:94][cite:96]
6. Service worker przekazuje polecenie do content scriptu na otwartej karcie Vinted.[cite:96][cite:98]
7. Content script wykonuje kroki na DOM i raportuje wynik, błędy, identyfikatory ofert oraz metadane wykonania.[cite:98]
8. `VerifierAgent` ocenia sukces lub porażkę i aktualizuje workflow.[cite:105]
9. W razie błędu Temporal uruchamia retry, backoff albo ścieżkę recovery.[cite:102][cite:104]
10. Workflow kończy się statusem `done`, `partial_success` albo `manual_review`.[cite:104][cite:107]

## Podział odpowiedzialności

| Warstwa | Odpowiedzialność |
|---|---|
| Chrome content script | DOM automation, odczyt stanu strony, egzekucja pojedynczych kroków.[cite:98] |
| Chrome service worker | Messaging, routing, alarmy, krótkie koordynacje sesji.[cite:96][cite:98] |
| Backend API | Taski, sesje, użytkownicy, logi, konfiguracja.[cite:101][cite:104] |
| Temporal workflows | Durable execution, retry, timeout, harmonogramy, stan procesu.[cite:102][cite:104] |
| Agenci | Planowanie, transformacja tasków, weryfikacja, recovery.[cite:99][cite:105] |
| DB | Stan biznesowy, historia, audyt, wynik tasków. |

## Model danych

Minimalne encje systemu:

- `users`
- `devices`
- `browser_sessions`
- `vinted_accounts`
- `workflows`
- `workflow_steps`
- `tasks`
- `task_attempts`
- `ui_snapshots`
- `action_logs`
- `policies`
- `rate_limits`

Kluczowe relacje powinny łączyć workflow z konkretną sesją przeglądarki i konkretnym task attempt, tak aby po awarii można było wznowić proces bez utraty informacji o miejscu przerwania.[cite:102][cite:104]

## Kontrakt komunikacji

Najbezpieczniejszy model komunikacji to jawne komendy i odpowiedzi JSON między backendem, service workerem i content scriptem.[cite:94][cite:103]

Przykładowe typy wiadomości:

```json
{
  "type": "EXECUTE_LISTING_BATCH",
  "workflowId": "wf_123",
  "taskId": "task_987",
  "payload": {
    "items": ["draft_1", "draft_2"],
    "mode": "publish"
  }
}
```

```json
{
  "type": "TASK_RESULT",
  "workflowId": "wf_123",
  "taskId": "task_987",
  "status": "partial_success",
  "items": [
    {"id": "draft_1", "result": "success", "listingId": "v_123"},
    {"id": "draft_2", "result": "error", "reason": "selector_not_found"}
  ]
}
```

## Orkiestracja agentów

Najlepszy wzorzec to połączenie deterministic workflow engine z niedeterministycznymi wywołaniami modeli wykonywanymi jako activities. Dokumentacja Temporal pokazuje, że kroki agentowe mogą być uruchamiane jako osobne activities, dzięki czemu każdy etap jest utrwalony, replayowalny i retryowalny.[cite:102][cite:105]

Rekomendowany układ workflowów:

- `schedule_inventory_sync`
- `publish_listings_workflow`
- `relist_stale_offers_workflow`
- `auto_offer_followup_workflow`
- `recover_failed_batch_workflow`
- `manual_review_resolution_workflow`[cite:104][cite:107]

Każdy workflow powinien używać sygnałów i zapytań do aktualizacji stanu w czasie rzeczywistym, bo Temporal wspiera schedules, signals i queries dla agentów działających 24/7.[cite:107]

## Agent loop

Wewnętrzna pętla jednego workflowu może wyglądać tak:

1. Pobierz następny task.
2. Oceń polityki bezpieczeństwa i rate limits.
3. Wygeneruj plan wykonania.
4. Wyślij plan do aktywnej sesji Chrome.
5. Zbierz wynik i dowody wykonania.
6. Oceń sukces.
7. Jeśli błąd naprawialny, uruchom recovery.
8. Jeśli błąd nienaprawialny, oznacz manual review.
9. Przejdź do kolejnego tasku.[cite:104][cite:105][cite:107]

To jest dokładnie model potrzebny do „agent orchestra i niech pisze”, bo agent nie działa jako pojedyncza rozmowa, tylko jako kontrolowany system wykonawczy z pamięcią procesu.[cite:102][cite:104]

## Bezpieczeństwo i kontrola ryzyka

Rozszerzenie powinno mieć minimalne `host_permissions` tylko do potrzebnych domen, bo w MV3 host permissions są rozdzielone i powinny być zawężane.[cite:98][cite:106]

Należy wprowadzić:

- globalny rate limiter na akcje konta,
- cooldown między publikacjami i wiadomościami,
- circuit breaker po serii błędów,
- manual approval dla wybranych tasków,
- pełny audit log wszystkich decyzji agentów.[cite:104][cite:107]

## Stack technologiczny

### Wtyczka

- TypeScript
- Manifest V3
- React lub Preact dla popup/options
- Zod do walidacji kontraktów
- Dexie lub chrome.storage dla lekkiego stanu lokalnego[cite:84][cite:94][cite:96]

### Backend

- FastAPI
- PostgreSQL
- Redis do krótkich kolejek i cache
- WebSocket lub SSE do statusów live
- MinIO/S3 do screenshotów i artefaktów

### Orchestration

- Temporal Python SDK lub Temporal TypeScript SDK
- Worker dla activities agentowych
- osobny worker dla browser task dispatch[cite:102][cite:104]

### Agenci

- Claude lub Kimi jako planner / verifier
- Kimi / DeepSeek jako executor-support model do generacji planów i refactorów
- MCP adaptery dla narzędzi i źródeł danych, jeśli chcesz standaryzować integracje agentów.[cite:105][cite:107]

## Struktura repozytorium

```text
repo/
├─ apps/
│  ├─ chrome-extension/
│  │  ├─ manifest.json
│  │  ├─ src/background/
│  │  ├─ src/content/
│  │  ├─ src/popup/
│  │  └─ src/options/
│  ├─ api/
│  │  ├─ app/main.py
│  │  ├─ app/modules/
│  │  └─ migrations/
│  └─ operator-panel/
├─ services/
│  ├─ workflow-worker/
│  ├─ agent-runtime/
│  └─ dispatcher/
├─ packages/
│  ├─ contracts/
│  ├─ shared-types/
│  └─ policy-engine/
└─ infra/
   ├─ docker/
   └─ temporal/
```

## Minimalny plan wdrożenia

### Etap 1 — MVP

- wtyczka Chrome MV3,
- content script do formularza wystawiania,
- backend z task queue,
- pojedynczy workflow `publish_listings_workflow`,
- prosty planner i verifier.[cite:84][cite:96][cite:102]

### Etap 2 — Durable automation

- retry policies,
- rate limits,
- recovery agent,
- screenshot evidence,
- manual review queue.[cite:104][cite:107]

### Etap 3 — Multi-agent orchestra

- osobne role agentów,
- schedules 24/7,
- subworkflowy,
- wiele sesji Chrome i wiele kont,
- polityki ryzyka i optymalizacja throughputu.[cite:99][cite:107]

## Rekomendacja końcowa

Najlepsza architektura dla tego projektu to model: **Chrome Extension jako egzekutor UI + FastAPI jako control plane + Temporal jako durable orchestration + zespół agentów planner/executor/verifier/recovery**. Taki podział jest zgodny zarówno z ograniczeniami Manifest V3, jak i z dobrymi praktykami dla długotrwałych workflowów agentowych.[cite:84][cite:96][cite:99][cite:102][cite:104]

Jeżeli celem jest system, który „pisze i robi” przez dłuższy czas, to trzeba traktować agenta jako element workflow engine, a nie jako pojedynczy chat z modelem. Właśnie wtedy powstaje prawdziwa orchestra zdolna do pracy ciągłej, wznowień i kontrolowanego wykonywania zadań.[cite:104][cite:105][cite:107]
