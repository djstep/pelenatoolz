# Отчёт по пакету 4

## A. Помощник

Класс `NotInProjectError` и функция `isNotInProjectError` живут в `src/features/memberships/assert-in-project.ts`. Сообщение по умолчанию: «Объект не найден». `assertInProject` бросает этот класс. Пустая строка в списке id не считается ссылкой и не проверяется.

Сравнение `error.message === "Объект не найден"` заменено на `isNotInProjectError`. Поиск по проекту нашёл три таких места, не пять. Остальные «Объект не найден» в коде — это готовый текст ответа, а не разбор пойманной ошибки.

- `src/features/locations/actions.ts` — добавление фото локации.
- `src/features/screenplay/actions.ts` — `applyLibrettoSyncAction`.
- `src/features/screenplay/actions.ts` — `replyScriptCommentAction`.

Текст, который видит пользователь, тот же.

Добавленные сущности. У всех прямой `projectId`, фильтр `id` плюс `projectId`:

- `Company` — компания.
- `Counterparty` — контрагент.
- `ProjectApprovalStatus` — статус согласования.
- `ProjectLedgerType` — тип ведомости договора (в форме это `ledgerTypeId`).
- `Contract` — договор.
- `CashPayment` — кассовый платёж. У акта поле `paymentId` ссылается на него, не на модель `Payment`.
- `Character` — персонаж.
- `Actor` — актёр.
- `Element` — элемент сцены.
- `CastingCandidate` — кандидат кастинга.
- `ScriptBlock` — блок сценария.

Теги договора в схему не добавлял. В `Contract.tags` это массив строк, не ссылки на записи. Отдельной модели тега нет.

## B–E. Исправления

### B. Договоры и акты

Файл `src/features/contracts/actions.ts`.

| Файл | Действие | Какие ссылки проверены | Статус |
| --- | --- | --- | --- |
| src/features/contracts/actions.ts | createContractAction | компания, контрагент, статус, тип ведомости, если указан | сделано |
| src/features/contracts/actions.ts | updateContractAction | те же ссылки. Сам договор уже искался с `projectId` | сделано |
| src/features/contracts/actions.ts | deleteContractAction | договор уже искался с `projectId` до удаления | уже было, не менял |
| src/features/contracts/actions.ts | createCertificateAction | компания, контрагент, статус из формы, договор и платёж, если указаны | сделано |
| src/features/contracts/actions.ts | updateCertificateAction | те же ссылки. Сам акт уже искался с `projectId` | сделано |
| src/features/contracts/actions.ts | deleteCertificateAction | акт уже искался с `projectId` | уже было, не менял |
| src/features/contracts/actions.ts | attachContractFileAction, attachCertificateFileAction | договор или акт и файл уже ищутся с `projectId` | уже было, не менял |
| src/features/contracts/actions.ts | detach и смена роли файла | удаление и правка уже ограничены проектом | уже было, не менял |

Теги в создание и изменение договора по-прежнему пишутся как текст. Проверять их через `assertInProject` нечего.

У акта платёж — это `CashPayment`. Старый поиск платежа с `projectId` оставлен: если платежа нет, ответ по-прежнему «Платёж не найден». После этого платёж ещё раз проходит `assertInProject`. Компания, контрагент и договор, которые подставляются из этого платежа, тоже проверяются до записи. Если статус в форме пустой, служебный статус по-прежнему берётся внутри проекта, и только после проверок остальных ссылок.

Чужая ссылка даёт `{ error: "Объект не найден" }`, запись не начинается.

### C. Кастинг, пробы, актёры

| Файл | Действие | Какие ссылки проверены | Статус |
| --- | --- | --- | --- |
| src/features/casting/actions.ts | createCastingPersonAction | персонаж, если передан | сделано, до создания человека |
| src/features/casting/actions.ts | updateCastingPersonAction | человек уже ищется с `projectId`. Ссылок на другие сущности нет | уже было, не менял |
| src/features/casting/actions.ts | updateCastingCandidateStatusAction | кандидат уже ищется с `projectId`. Утверждение уходит в `approveCastingCandidate` | сделано в утверждении |
| src/features/casting/actions.ts | addCastingApplicationAction | человек и персонаж уже ищутся с `projectId` | уже было, не менял |
| src/features/casting/actions.ts | deleteCastingPersonAction | удаление уже с `projectId` | уже было, не менял |
| src/features/auditions/actions.ts | createAuditionAction | сцена, если указана; все персонажи одним вызовом. Люди и видеофайл уже проверялись | сделано, до записи кандидатов и пробы |
| src/features/auditions/actions.ts | createAuditionsBatchAction | каждая проба идёт через `createAuditionAction` | сделано тем же путём |
| src/features/auditions/actions.ts | deleteAuditionAction | проба уже ищется с `projectId` | уже было, не менял |
| src/features/actors/actions.ts | createActorAction | персонаж, если указан | сделано |
| src/features/actors/actions.ts | updateActorAction | актёр уже ищется с `projectId`; персонаж, если указан | сделано |
| src/features/actors/actions.ts | deleteActorAction | удаление уже с `projectId` | уже было, не менял |
| src/features/preproduction/lib/approve-casting.ts | approveCastingCandidate | кандидат и его персонаж | сделано |

В утверждении до транзакции проверяются кандидат и персонаж. Обновление персонажа и самого кандидата идёт с `projectId` в `where`. Массовый отказ остальных кандидатов тоже ограничен этим проектом. Актёр на эту роль ищется в проекте, обновление актёра тоже с `projectId`.

Права не менял. Ставки актёра в создании и правке по-прежнему пишутся только при `canFinanceWrite("actors")`.

### D1. Привязки сцены в либретто

Файл `src/features/script/actions.ts`.

| Файл | Действие | Какие ссылки проверены | Статус |
| --- | --- | --- | --- |
| src/features/script/actions.ts | createSceneAction | локация, персонажи, элементы из формы | сделано, до создания сцены и до создания элементов по имени |
| src/features/script/actions.ts | updateSceneAction | те же ссылки. Сцена уже ищется с `projectId`, в `update` в `where` тоже стоит `projectId` | сделано |
| src/features/script/actions.ts | duplicateSceneAction, bulk, delete, renumber | id сцены уже с `projectId`. Новых ссылок из браузера нет: дубль копирует связи найденной сцены | уже было, не менял |

Позиции ресурсов по-прежнему отсекаются в `saveSceneResourceItems`: в запись попадают только позиции категорий этого проекта. Чужой id позиции не пишется.

Вызов `syncSluglineFromScene` после сохранения сцены теперь передаёт проверенный `projectId`.

### D2. Синхронизация сценария и сцен

Файл `src/features/screenplay/lib/sync.ts`. Вызовы с новым аргументом: `src/features/script/actions.ts`, `src/features/screenplay/actions.ts` и `refreshAllSluglines` в том же `sync.ts`.

| Файл | Действие | Какие ссылки проверены | Статус |
| --- | --- | --- | --- |
| src/features/screenplay/lib/sync.ts | syncSceneFromSlugline | сцена через `assertInProject` до создания локации; `update` сцены с `projectId` | сделано |
| src/features/screenplay/lib/sync.ts | syncSceneScriptContent | добавлен `projectId`, `update` сцены с ним. Вызов один: `syncAllScenesFromBlocks` | сделано |
| src/features/screenplay/lib/sync.ts | syncSluglineFromScene | сцена грузится с `projectId`. Блок шапки правится, только если у него тот же `projectId` и он в текущей версии этого проекта | сделано |
| src/features/screenplay/lib/sync.ts | ensureScenesFromBlocks | все `sceneId` с клиента одним вызовом `assertInProject` | сделано, см. ниже |
| src/features/screenplay/lib/sync.ts | syncSceneCharactersFromBlocks | сцена ищется с `projectId` до создания персонажей и связей | сделано: иначе чужой `sceneId` стирал бы связи персонажей |
| src/features/screenplay/actions.ts | syncSceneSluglineAction | сцена через `assertInProject`, затем синхронизация с `projectId` | сделано |

Сигнатура `syncSluglineFromScene` и `syncSceneScriptContent` получила `projectId` первым аргументом. Других вызовов в проекте нет.

`ensureScenesFromBlocks`, чужой `sceneId`. Функция не обрывается ошибкой. Если среди присланных id есть чужой или несуществующий, одним запросом оставляются только сцены этого проекта. Чужой id считается отсутствующим: для шапки сцены создаётся новая сцена в этом проекте, как и для блока без `sceneId`. Для остальных блоков берётся текущая сцена этой цепочки, а не чужой id. В чужую сцену ничего не пишется. Свои id в том же пакете блоков не выбрасываются.

### D3. Версия сценария

`applyLibrettoSyncAction` уже до чтения и записи вызывает `getScriptVersion(projectId, versionId)`. Эта функция ищет версию с `projectId`. Вторую проверку не добавлял. Поменял только разбор ошибки на `isNotInProjectError`.

Остальные действия в `src/features/screenplay/actions.ts` с `versionId`: загрузка, сохранение, дубль, предпросмотр, экспорт, смена текущей, название, комментарий к версии, блокировка, удаление, список комментариев, ответ на комментарий. У всех версия уже ищется через `getScriptVersion` или `assertInProject` до записи. Не менял, кроме ответа: там только класс ошибки.

`createScriptCommentAction` версию уже проверял, а `startBlockId` и `endBlockId` нет. Оба id проверяются одним вызовом для `ScriptBlock`. Временные id новых несохранённых блоков начинаются с `new-` и в базе ещё не лежат, их не проверяю: это не ссылка на чужой блок. Любой другой id должен быть блоком этого проекта, иначе «Объект не найден» и комментарий не создаётся.

`resolveScriptCommentAction` и `deleteScriptCommentAction` до записи смотрят, что комментарий принадлежит версии этого проекта. Не менял.

### E. Вызывной лист

Файл `src/features/day-docs/actions.ts`. Съёмочный день по-прежнему ищется в `assertCallSheetWrite` с `projectId`. `locationId` ни одно действие файла не принимает.

| Файл | Действие | Какие ссылки проверены | Статус |
| --- | --- | --- | --- |
| src/features/day-docs/actions.ts | saveTimeSlotsAction | все `sceneId` одним вызовом | сделано, до записи слотов |
| src/features/day-docs/actions.ts | saveActorCallsAction | все `actorId` одним вызовом | сделано, до записи |
| src/features/day-docs/actions.ts | saveResourceUsagesAction | все id позиций одним вызовом. Фильтр «посменная категория» в записи оставлен | сделано |
| src/features/day-docs/actions.ts | applyRecalculateActorTimingsAction | все присланные `actorId` до записи таймингов | сделано |
| src/features/day-docs/actions.ts | addPerShiftResourceAction | позиция уже ищется в посменной категории этого проекта | уже было, не менял |
| src/features/day-docs/actions.ts | removePerShiftResourceAction | удаление уже ограничено днём и категорией проекта | уже было, не менял |
| src/features/day-docs/actions.ts | saveResourceCallsAction | id сущностей нет, только название и категория текстом | не менял |
| src/features/day-docs/actions.ts | applyRecalculateResourceTimingsAction | ключ — название категории и ресурса. Строка ищется внутри дня и проекта, потом обновляется | уже было, не менял |
| src/features/day-docs/actions.ts | шапка, контакты отделов, транспорт, фиксация плана | день уже проверен. Ссылок на чужие сущности нет | уже было, не менял |

### Файлы вне списка задач

`src/features/locations/actions.ts` — замена сравнения текста ошибки на `isNotInProjectError`. Это часть A.

Других файлов не менял. Новые аргументы `projectId` ушли в файлы, которые и так были в задачах D1 и D3.

## F. Опись оставшегося

Места, где запись уже идёт после поиска сущности в этом проекте, не включал.

### Запись по голому id

| Файл:строка | Функция | Модель | Операция |
| --- | --- | --- | --- |
| src/features/smeta/queries.ts:357 | persistBudgetSnapshot | BudgetSheet | upsert |

Вызов из `saveBudgetWorkbookAction`. Id листа приходит в JSON книги из браузера. Смета проекта проверяется, лист нет. В `update` записывается `budgetId` этой сметы: лист другого проекта можно перенести сюда и затереть его данные.

### Чужой внешний ключ

| Файл:строка | Функция | Поле | Откуда приходит |
| --- | --- | --- | --- |
| src/features/finance/actions.ts:98 | createFinanceOpAction | companyId, counterpartyId, actorId | форма |
| src/features/finance/actions.ts:150 | updateFinanceOpAction | companyId, counterpartyId, actorId | форма |
| src/features/screenplay/lib/sync.ts:438 | linkBlocksToExistingScenes | sceneId | JSON блоков в saveScreenplayVersionAction |

В финансовой операции имя компании и контрагента ищется в проекте только для подписи. Если запись чужая, подпись пустая, а сам id всё равно пишется. `actorId` не проверяется совсем. Сама операция при правке ограничена `projectId`, ссылки нет.

В сохранении сценария шапка сцены сопоставляется со сценами проекта по номеру. Если совпадения нет, остаётся `sceneId` из браузера. Его пишут `replaceVersionBlocks` (`src/features/screenplay/lib/versions.ts:124`) и создание новой версии (`versions.ts:219`).

## Замечено, но не тронуто

- Утверждение кастинга пишет актёру `shiftRate` из предложенной ставки. На входе только право `cast:write`, финансового права нет. То же с полем `proposedRate` у человека кастинга.
- `updateCharacterCastSnapshotAction` в `src/features/characters/actions.ts` меняет ставку актёра при праве `cast:write`.
- В вызывном `saveTransportsAction` пишет ставку за км при праве вызывного или расписания, без финансового права.
- В сцене либретто цена ресурса (`unitPrice`) пишется при праве `script:write`.
- У актёров ставки и доплаты по-прежнему пишутся только при `canFinanceWrite("actors")`.
- Утверждение скаута обновляет локацию по id из связи. Сама связь при создании кандидата проверяется на проект, в `where` обновления `projectId` не повторён.
- Позиция ресурса на сцене: чужой id отбрасывается фильтром, всё действие из-за него не отменяется.

## Результаты проверок

- `npx tsc --noEmit`: 0 ошибок.
- `npx eslint` по изменённым файлам: новых ошибок нет. Старые предупреждения не трогал: неиспользуемые `isFormValueBlank` в `src/features/actors/actions.ts`, `allPersonIds` в `src/features/auditions/actions.ts`, `bootstrapScriptBlocks` в `src/features/screenplay/actions.ts`. Предупреждение `prefer-const` про `paymentId` в создании акта больше не возникает: переменная в новом коде не перезаписывается.
- `npm run build`: сборка прошла, включая `prisma generate`. Базу это не меняет.
