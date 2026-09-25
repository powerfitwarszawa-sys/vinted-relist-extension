# T3 — Conversation Scanner (read-only) — raport

**Etap:** T3.1–T3.6 (scan → normalizacja → deduplikacja → snapshot → UI/preview data)
**Status kodu:** COMPLETE — lokalnie, **bez pusha** (oczekuje na osobną zgodę).
**Commit kodu T3:** `87dbdef2f3d3ed82aa10d607782671d617c03b03` (`feat(messages): T3 read-only conversation scanner (scan/normalize/dedupe/snapshot)`)

---

## 1. Lista plików

### Kod (dozwolone katalogi)

| Plik | Linie | Rola |
|---|---:|---|
| `src/core/messages/contracts.ts` | (rozszerzony) | T3 kontrakty: `ConversationScanStatus`, `ConversationDataQuality`, `ConversationScanWarning(+code)`, `ConversationScanResult`, `ConversationPage`, `ConversationDataSource`; rozszerzone `Conversation` |
| `src/core/messages/conversation-normalizer.ts` | 319 | czysta, deterministyczna normalizacja wiersza → `Conversation` |
| `src/core/messages/conversation-dedupe.ts` | 37 | deduplikacja po stabilnym `conversationId` (first-wins) |
| `src/core/messages/conversation-scanner.ts` | 212 | orkiestracja pętli stron, klasyfikacja błędów, `ConversationScanError` |
| `src/core/messages/conversation-snapshot.ts` | 173 | model/serializacja snapshotu pod `vbr:messages:conversation-snapshot` |
| `src/core/messages/index.ts` | (rozszerzony) | eksport publicznej powierzchni modułu |
| `src/content/messages/conversation-api-client.ts` | 140 | klient **wyłącznie GET** (`ReadOnlyConversationClient`) |
| `src/content/messages/conversation-data-source.ts` | 115 | adapter klient → `ConversationDataSource` + mapowanie błędów |
| `src/content/messages/index.ts` | 17 | eksport warstwy content |

### Testy (dozwolone katalogi)

| Plik | Linie | Zakres |
|---|---:|---|
| `tests/messages/conversation-normalizer.test.mjs` | 189 | 50 asercji (T3.5: mapowanie, ID, daty, autor, statusy, aliasy, determinizm) |
| `tests/messages/conversation-dedupe.test.mjs` | 82 | 9 asercji |
| `tests/messages/conversation-scanner.test.mjs` | 231 | 46 asercji (paginacja, klasyfikacja błędów, determinizm) |
| `tests/messages/conversation-snapshot.test.mjs` | 160 | 24 asercje (persistencja, fail-closed, fingerprint) |
| `tests/content/messages/conversation-api-client.test.mjs` | 134 | 17 asercji (URL, statusy, sieć) |
| `tests/content/messages/conversation-data-source.test.mjs` | 131 | 14 asercji (ekstrakcja, paginacja, mapowanie błędów, e2e adapter+scanner) |
| `tests/content/messages/read-only-guard.test.mjs` | 145 | 9 asercji (statyczny + runtime zabezpieczenie GET-only) |
| `tests/messages/build.mjs` | (rozszerzony) | drugi bundle testowy: `content.js` |

### Zmiany poza nowymi plikami

- `package.json` — **wyłącznie** łańcuch `scripts.test` (dopięcie 7 nowych testów; zgodnie z precedensem zatwierdzonym w T1/T2 — plik nie figurował na liście „zatrzymaj i zgłoś": manifest, build.cjs, background, dashboard, istniejący klient API).
- `src/core/messages/contracts.ts`, `src/core/messages/index.ts`, `tests/messages/build.mjs` — dozwolone katalogi.

**Nietknięte (potwierdzone przez `git diff --cached --name-only`):** `manifest.json`, `scripts/build.cjs`, `src/background/background.ts`, `src/dashboard/*`, `src/popup/*`, `src/options/*`, `src/content/vinted-api.ts` (istniejący klient API), uprawnienia, wersja.

---

## 2. Kontrakty (T3.1)

```ts
interface ConversationScanResult {
  scanId: string;
  startedAt: string;          // ISO z zegara wstrzykniętego (now)
  finishedAt: string;
  source: 'dom' | 'read-only-api';
  conversations: Conversation[];
  warnings: ConversationScanWarning[];   // 15 kodów, m.in. unsupported-structure
  hasMore: boolean;
  nextCursor?: string;         // wznowienie skanu
  complete: boolean;           // FALSE po błędzie → snapshot NIE zapisywany
}
```

- Wszystkie nowe typy to typed unions, zero `any` (gate lint: `@typescript-eslint` strict).
- `Conversation` (rozszerzenie, bez łamania T1): `scanStatus` (`unread|awaiting-reply|replied|archived|unknown`), `dataQuality` (`complete|degraded|unknown`), `conversationUrl?`, `lastMessageAt?` i `lastMessageFromSelf?` (tri-state — brak danych = `undefined`, nigdy zgadywanie), `replyStatus` uczyniono **opcjonalnym** (skan nie zna cyklu życia odpowiedzi; scalenie z historią = późniejsza faza).
- Osobne osie statusu: `scanStatus` (obserwacja Vinted) vs `replyStatus` (nasz cykl) — świadoma separacja.
- `ConversationDataSource` to jedyna zależność skanera (nie zna HTTP ani DOM).

---

## 3. Źródło danych (T3.2)

- **Zaimplementowane:** `read-only-api` — `GET {baseUrl}/api/v2/conversations[?cursor=&limit=]` przez sesję strony (`credentials: 'include'`), osobny klient w `src/content/messages/conversation-api-client.ts`.
- **Nie importuje** istniejącego, zdolnego do zapisu klienta `src/content/vinted-api.ts` (test statyczny to potwierdza).
- Kształty endpointu (`cursor`/`limit`/`items`/`next_cursor`) to **oczekiwany kontrakt read-only** — do potwierdzenia na żywo w fazie ręcznego E2E; żadne zapytanie nie zostało wysłane podczas rozwoju (wszystkie testy na wstrzykniętym fetchu).
- **Zarezerwowane, niezaimplementowane:** źródło `dom` (typ i pole wyniku istnieją, adapter DOM to praca na późniejszą fazę — wymaga dostępu do strony).

---

## 4. Strategia paginacji

- Pętla po stronach z `cursor`; twarde `maxPages` (domyślnie 50, clamp ≥1) z ostrzeżeniem `max-pages-reached` i `nextCursor` do wznowienia.
- Zabezpieczenia: `pagination-loop` (cursor nie postępuje → stop), `missing-cursor` (`hasMore:true` bez cursora → stop, reskan), zero retry (błąd sesji/rate/CAPTCHA = koniec skanu, `complete:false`).
- `hasMore`/`nextCursor` wyniku = stan ostatniej odczytanej strony.

## 5. Strategia normalizacji

- Czysta funkcja: zero DOM/storage/sieci/zegara (czas tylko w `scanConversations` przez wstrzyknięty `now`).
- Wymagane: stabilne `id` (brak → odrzucenie `missing-id`), rozpoznany kształt (0 trafień w znanych polach → `unsupported-structure`, wiersz NIE wchodzi do snapshotu).
- Daty: parsowalny string → ISO; brak → `missing-date`, nieparsowalny → `invalid-date`; **nigdy** „teraz" jako zamiennik — data `undefined` + `dataQuality:'degraded'`.
- Autor: `sender_id === selfUserId` → tri-state; brak `selfUserId`/nadawcy → `unknown-author` + `lastMessageFromSelf: undefined`.
- Priorytet `scanStatus`: `archived` → `unread` → (`replied` tylko gdy autor = MY) → `awaiting-reply` (autor znany = oni) → `unknown`. **Brak wiadomości/nieznany autor NIGDY nie daje `replied`.**
- Aliasowe kształty (`conversation_id`, `user_id`, `lastMessage`, `unread: bool`, `createdAt`…) tolerowane; nieznane dodatkowe pola ignorowane (forward-compatible), nie degradują jakości.
- Niepełne, ale rozpoznane wiersze: zachowane + ostrzeżenia + `degraded` („częściowa odpowiedź" nie gubi danych).

## 6. Strategia deduplikacji

- Jedna mapa po `conversationId` na CAŁYM skanie (między stronami), first-wins (kolejność stron autorytatywna, deterministyczna), każdy duplikat → ostrzeżenie `duplicate-item` z id. Bez mutacji wejścia.

## 7. Model snapshotu

- Klucz **własny:** `vbr:messages:conversation-snapshot` (niezależny od `vbr:lastScan` relistu).
- Pola: `schemaVersion` (1), `scanId`, `startedAt`, `finishedAt`, `savedAt` (ISO), `source`, `conversationCount`, `hasMore`, `nextCursor?`, `warnings`, `fingerprint`, `conversations`.
- **Zapis tylko przy `complete:true`** — `buildConversationSnapshot` rzuca, `saveConversationSnapshot` zwraca `{ok:false}` i **nie dotyka** istniejącego snapshotu (test: bajt-w-bajt identyczny po nieudanym skanie).
- Odczyt fail-closed: brak/obcy `schemaVersion`/uszkodzony obiekt → `null`.
- Fingerprint: deterministyczny FNV-1a×2 (16 hex) po danych + źródle + kolejności — sygnatura zmiany, **nie** kryptograficzny hash (w projekcie nie było dotąd wzorca kryptograficznego).

## 8. Zabezpieczenie read-only (T3.2)

1. **Typy:** `type ReadOnlyHttpMethod = "GET"` — metoda jest stałą `const READ_METHOD`, klient **nie ma parametru metody**; wpisanie `POST` w opcje jest ignorowane (test runtime to demonstruje).
2. **Statyczny test:** żaden plik `src/core/messages/*.ts` ani `src/content/messages/*.ts` nie zawiera wywołań z metodą zapisu (POST/PUT/PATCH/DELETE) ani `.post/.put/.patch/.delete(`; `fetch()` poza dedykowanym klientem — zero; skaner/adapter nie wspominają `vinted-api`.
3. **Runtime test:** pełny skan przez wrogi transport rzucający przy dowolnej metodzie ≠ GET — przechodzi, wszystkie wywołania = `GET`.
4. Klasyfikacja błędów bez retry: `session-expired`/`rate-limited`/`captcha` → `complete:false`, ostrzeżenie w wyniku, snapshot odmówiony.

## 9. Obsługa błędów i sesji

- Błąd strony w połowie skanu → `complete:false`, zebrane wiersze zachowane „do diagnostyki", **żadnego zapisu snapshotu**, zero retry.
- `ConversationScanError` klasyfikowany strukturalnie (duck-typing po nazwie+code — bezpieczny między bundle'ami content/core, gdzie `instanceof` zawodzi na dwóch kopiach klasy; wykryty i naprawiony w testach).
- Błędy zwykłych wyjątków klasyfikowane regułami: `401|403|session` → `session-expired`, `429|rate` → `rate-limited`, `captcha|datadome` → `captcha`, reszta → `page-fetch-failed`.

## 10. Wyniki bramki (finalne drzewo, ten sam tree co commit)

```text
npm run typecheck                → PASS (exit 0)
npm run build                    → PASS (build.cjs nietknięty, 1.0s)
npm test                         → PASS (exit 0)
   · stare suite: 302/302
   · nowe T3:    169/169 (50+9+46+24+17+14+9)
   · razem:      471/471
npm run lint -- src/core/messages src/content/messages
   → SKRYPT PENNY: exit 1 = 266 problems (163 errors) — DOKŁADNIE ten sam
     wynik co baseline PRZED T3 (backlog legacy src/, spoza zakresu)
   → NOWE KATALOGI osobno (npx eslint src/core/messages src/content/messages):
     exit 0, 0 problemów  ← to jest właściwy wynik dla zakresu T3
```

## 11. Potwierdzenie: zero operacji zapisu

- ✅ Zero wiadomości wysłanych, zero odpowiedzi automatycznych.
- ✅ Zero wywołań POST/PUT/PATCH/DELETE do Vinted — **żaden request HTTP nie opuścił maszyny**: wszystkie testy działają na wstrzykniętym fetchu/`Response`; nie otwierano przeglądarki ani sesji Vinted w tym etapie.
- ✅ Zero nowych uprawnień, `manifest.json`/wersja 0.3.1 nietknięte.
- ✅ Zero zmian w relistowaniu, `background.ts`, dashboardzie.
- ✅ Zero integracji AI, zero follow/unfollow, zero prób obejścia CAPTCHA (wykrycie + stop, bez retry).
- ✅ Snapshot to wyłącznie lokalne `chrome.storage.local`.

## 12. Ograniczenia / dalsza praca

1. **Źródło `dom`** zarezerwowane w typach, niezaimplementowane (wymaga E2E na stronie).
2. **Endpointy read-only** (`/api/v2/conversations`, `cursor`) to oczekiwany kształt — potwierdzić na żywo w fazie E2E.
3. **`scripts/build.cjs` nietknięte** → moduł nie wchodzi do builda produkcyjnego ani `manifest.json`; podpięcie wymaga rozszerzenia zakresu (zgłaszam, nie robię). Testy bundle'ują przez `tests/messages/build.mjs`.
4. **UI/preview jeszcze nie istnieje** — T3 dostarcza dane gotowe dla UI (kolejny etap: widok skrzynki).
5. **Pełny `npm run lint`** nadal nieprzechodzący z powodu pre-existing backlogu (266/163 — identyczne przed i po T3); naprawa = osobny zakres.

---

*Hash commita kodu T3: `87dbdef2f3d3ed82aa10d607782671d617c03b03`. Push wstrzymany do osobnej zgody.*
