# T4A — Snapshot/Storage — raport

**Etap:** T4A (storage adapter → schema versioning → migration/read validation → atomic write → preservation)
**Zakres realizacji:** `src/core/messages/**`, `tests/messages/**`, `package.json` (tylko `scripts.test`), ten raport.
**Status:** COMPLETE — lokalnie, **bez pusha** (osobna decyzja użytkownika).
**Commit kodu T4A:** `83bb05aa6b9ab8e141978854fa8b5d7b944197ad`
**Brak zmian w:** `src/core/storage.ts`, `background.ts`, `dashboard.ts`, `manifest.json`, `scripts/build.cjs` — **nie było potrzeby rozszerzenia zakresu** (nowe moduły są w pełni samowystarczalne).

---

## 1. Lista plików

| Plik | Zmiana | Rola |
|---|---|---|
| `src/core/messages/snapshot-storage.ts` | nowy (~130) | `SnapshotStorageAdapter` (read/write), `createMemorySnapshotStorage` (bez Chrome), `createChromeSnapshotStorage` (produkcja), `SnapshotStorageError` |
| `src/core/messages/snapshot-schema.ts` | nowy (~370) | `CONVERSATION_SNAPSHOT_SCHEMA_VERSION=1`, `ConversationSnapshot`, `validateStoredSnapshot`, `migrateStoredSnapshot` |
| `src/core/messages/snapshot-fingerprint.ts` | nowy (~50) | kanoniczny (sortowane klucze) FNV-1a×2 — patrz §7 |
| `src/core/messages/conversation-snapshot.ts` | refaktór | build + save/get z wstrzykiwalnym adapterem (3. param), delegacja walidacji/migracji do schema |
| `src/core/messages/index.ts` | rozszerzony | eksport nowej powierzchni |
| `tests/messages/snapshot-schema.test.mjs` | nowy | 72 asercje: wersja, walidacja, uszkodzone payloady, migracja, fail-closed |
| `tests/messages/snapshot-storage.test.mjs` | nowy | 31 asercji: adapter bez Chrome, atomowość, preservacja, brak mutacji |
| `package.json` | rozszerzony | +2 testy w `scripts.test` |

## 2. Kryteria → realizacja (wymagane testy)

| Kryterium | Test(y) | Wynik |
|---|---|---|
| poprawny zapis i odczyt | storage: round-trip przez memory adapter (scanId, wiersze, savedAt) | ✅ |
| wersja schematu | schema: `VERSION===1`, builder stampuje 1; storage: payload w store ma 1 | ✅ |
| walidacja danych | schema: 24 typy uszkodzeń → `null` (typy, ISO, source, count, warnings, wiersze, NaN, pusty cursor…); walidacja nie mutuje wejścia, zwraca świeży obiekt, wyrzuca klucze śmieci | ✅ |
| migracja | legacy bez `schemaVersion` oraz `schemaVersion:0` → v1: count przeliczony (kłamliwe 999→2), fingerprint przeliczony, `savedAt`←`finishedAt`, brakujące pola wypełnione uczciwie (`unknown`/`degraded`/`''`/0), walidacja v1 po migracji | ✅ |
| uszkodzony payload | string/number/null/array/true/{}/{v1 tylko} → `null`, zero crashy | ✅ |
| niekompletny snapshot | `complete:false` → `{ok:false}`, zero write-calli (bramka przed I/O) | ✅ |
| zachowanie poprzedniego po błędzie | (a) transport rzuca „disk full" → poprzedni bajt-w-bajt; (b) niekompletny skan na zasianym store → poprzedni; odczyt nadal zwraca snapshot A | ✅ |
| pusty snapshot | 0 rozmów, `complete:true` → zapis+odczyt OK (`count 0`); legacy pusty → migracja OK (pusty ≠ uszkodzony) | ✅ |
| brak cichego resetu | zepsuty payload w store → get `null`, store **niekasowany/nieprzepisany**; nieznana wersja → `null`, store nietknięty; pusty store → `null` (brak ≠ reset); read nigdy nie pisze | ✅ |
| brak mutacji danych wejściowych | deep-frozen wynik → zapis OK i byte-identyczny po nim; mutacja wyniku PO zapisie nie wpływa na store (głęboka kopia) | ✅ |
| adapter testowy bez Chrome API | cały plik storage: `typeof chrome === 'undefined'` na starcie i na końcu, dane tylko w memory adapterze; domyślny (chrome) save/get w Node → `{ok:false}`/`null` bez crasha | ✅ |
| fail-closed dla nieznanej wersji | `999, 2, -1, 1.5, '1', true, '', 0.001` → `null` w `migrateStoredSnapshot` ORAZ `validateStoredSnapshot` | ✅ |

## 3. Architektura

```
saveConversationSnapshot(result, ms, storage?)
  1. bramka complete:false        → {ok:false}   (storage nietknięte)
  2. build                        → payload
  3. validateStoredSnapshot(...)  → null → {ok:false} (backup przed bugiem buildera)
  4. JEDEN storage.write(key,…)   → atomowo; wyjątek → {ok:false}, poprzedni zostaje

getConversationSnapshot(storage?)
  read → migrateStoredSnapshot(raw):
     brak wersji | 0 → migracja legacy (wymaga rozpoznawalnych pól; brak id w wierszu → ODRZUCENIE CAŁOŚCI — bez cichego wycinania wierszy)
     1 → validateStoredSnapshot (świeży obiekt, recompute fingerprint)
     inne → null (fail-closed)
```

- **Atomowość:** jeden klucz, jedno `write`; serializacja (memory: `JSON.stringify`) poprzedza przypisanie — nieudana serializacja/transport = brak zmian w store. Chrome: pojedyncze `set()` na kluczu (semantyka atomowa).
- **Adapter:** `SnapshotStorageAdapter {read, write}` — testy w 100% na memory adapterzie/spy, zero Chrome API; produkcja = `chrome.storage.local` (zachowanie T3 bez zmian dla wywołujących bez 3. parametru).
- **Migracja read-time, bez write-back:** odczyt jest pozbawiony efektów ubocznych; zapis w aktualnej wersji dzieje się przy kolejnym save.

## 4. Znaleziony i naprawiony bug (istotny)

`fingerprintConversations` był **wrażliwy na kolejność kluczy** obiektu (`JSON.stringify` w kolejności budowy), a walidator przebudowuje wiersze w kanonicznej kolejności pól → recompute fingerprintu różnił się od zapisanego i **poprawny payload był odrzucany** (save odmawiał, read → `null`). Naprawa: **kanoniczna serializacja** (rekurencyjne sortowanie kluczy) w `snapshot-fingerprint.ts` — fingerprint zależy od **wartości** i kolejności wierszy (tablica = kolejność skanu), nie od kolejności budowy obiektu. Wykryte przez testy regresyjne T3 + nowe T4A.

## 5. Bramka (finalne drzewo = drzewo commitu)

```text
npm run typecheck           → PASS (exit 0)
npm run build               → PASS (build.cjs nietknięty)
npm test                    → PASS (exit 0)
   stare suite:               302/302
   T3 (rozmowy):             169/169
   T4A (schema + storage):   103/103   (72 + 31)
   RAZEM:                    574/574
npm run lint -- src/core/messages
   skrypt pełny → exit 1: 266 problems (163 errors) = IDENTYCZNY baseline
                       sprzed T4A (backlog legacy src/, spoza zakresu)
   moje katalogi → npx eslint src/core/messages src/content/messages: exit 0
```

## 6. Potwierdzenie ograniczeń zakresu

- ✅ Zero requestów (nawet GET nie było potrzebne — warstwa storage jest czysto lokalna), zero wiadomości, zero odpowiedzi automatycznych.
- ✅ Zero nowych uprawnień / zmian manifestu / zmian wersji (0.3.1), zero podpinania do builda produkcyjnego, zero zmian w relistowaniu.
- ✅ Niedozwolone pliki (`src/core/storage.ts`, `background.ts`, `dashboard.ts`, `manifest.json`, `scripts/build.cjs`) **nietknięte** — nie było konieczności zgłaszania rozszerzenia zakresu.
- ✅ Brak sekretów; brak issue/PR; push wstrzymany.

## 7. Ograniczenia / dalsza praca

1. **UI/preview nieobjęte** — T4A to wyłącznie warstwa storage (kolejna część T4 wg decyzji użytkownika).
2. **Wartość fingerprintu zmieniła się** względem T3 (kanoniczna serializacja) — bez wpływu na dane, bo nic nie zostało wysłane/zapisane produkcyjnie; stare lokalne snapshoty dev → `null` + reskan (fail-closed, nie reset).
3. **Migracja v1→v2** nie istnieje (nie ma v2) — maszyneria (`migrateStoredSnapshot`) jest gotowa na dodanie kroku.
4. Domyślny adapter w Node bez Chrome zwraca `{ok:false}`/`null` (fail-closed) — testy używają wstrzykiwanego adaptera.
5. `npm run lint` (pełny) nadal blokowany pre-existing backlogiem — identyczny zakres naprawy jak wcześniej (osobny task).

---

*Hash commita kodu T4A: `83bb05aa6b9ab8e141978854fa8b5d7b944197ad`. Push wstrzymany do osobnej zgody.*
