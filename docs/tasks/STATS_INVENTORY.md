# Инвентаризация статистики и сводных показателей (для сравнения с FilmToolz)

Дата: 2026-11-10. Ветка: `feat/role-presets`. Только чтение: код и база не менялись.

Обозначения в таблицах:
- **КПП-версия** — учитывает ли показатель версию КПП. Сущности «версия КПП» в схеме нет: КПП (`ShootDay` + `ShootDayScene`) существует в одном живом состоянии. Версии есть только у вызывного (`CallSheet.version`, `CallSheetApprovedVersion`), у сметы (`BudgetVersion`) и у сценария (`ScriptVersion`). Поэтому во всех строках ниже «КПП-версия: нет» по определению; где берётся версия сметы, это указано.
- **Вырез.** — исключаются ли вырезанные сцены (`Scene.cutAt`).
- **Финправа** — скрывается ли показатель без права на финансы.

---

## 1. Обзор проекта

| Экран / блок | Что показано | Из чего считается | Вырез. | Фильтры | Финправа | Экспорт |
|---|---|---|---|---|---|---|
| `/projects/[id]` → «Сцены (либретто)» | Сцены, Объекты, Персонажи (счётчики) | `getOverviewStats` (`features/projects/queries.ts:105`): `scene.count`, `location.count`, `character.count` | сцены — да; объекты/персонажи — не относится | нет | нет; каждая цифра скрывается, если нет доступа к разделу (`filterNavGroups` + `navAccessFromContext`) | нет |
| `/projects/[id]` → «КПП и вызывные» | Съёмочные дни; «Сцены в плане X / Y» | там же: `shootDay.count`, `shootDayScene.count` (строки сцена-день), `scene.count` | да | нет | нет | нет |

Замечание: «Сцены в плане» считает **строки** `ShootDayScene`, а не разные сцены. Если одна сцена стоит в двух днях, она посчитается дважды, и X может быть больше Y.

## 2. Раздел «Отчёты» и производные страницы

| Экран / блок | Что показано | Из чего считается | Вырез. | Фильтры | Финправа | Экспорт |
|---|---|---|---|---|---|---|
| `/reports` (список отчётов смены, `production-reports-index.tsx`) | По дню: число сцен в КПП, «+N в отчёте» (факты сверх плана), факт длительности смены | `listProductionReports` (`features/reports/queries.ts`): `_count.scenes`, `productionReport._count.sceneFacts`, `formatFactDuration(factShiftStart, factShiftEnd)` (`features/reports/types.ts:15`) | нет (`_count` считает все) | нет | нет денег на экране | нет |
| `/reports/[dayId]` (`production-report-workspace.tsx`) | Бейдж «Факт смены HH:MM»; таблица сцен: план (стр. / хрон) и факт хрона по каждой сцене | `formatPagesMinutes(scene.pageCount, planSeconds)` (`schedule/lib/day-summary.ts`); `ProductionReportSceneFact.factSeconds` | — | нет | — | меню «Экспорт» дня (`day-docs-export-menu.tsx`) |
| `/reports/[dayId]` → строки работы (`work-rows-section.tsx`) | По строке актёра / ресурса / транспорта / объекта: отработано, переработка «факт / к оплате», смена ₽, переработка ₽, доп. ₽, км ₽, итого ₽ | хранится в `ProductionReportWorkRow` (`workedMin`, `factOvertimeMin`, `payableOvertimeMin`, `shiftPay`, `overtimePay`, `extrasPay`, `mileagePay`, `totalPay`); считает `computeWorkPay` (`reports/lib/compute-work-pay.ts:229`); подпись — `formatOvertimeCell` | — | нет | **да**: `report-access.ts` — `canFinanceRead` / `canFinanceWrite` по источнику строки, суммы режутся через `pickFinanceFields` | нет |
| `/reports/[dayId]` → итоги по дню | **Нет**: суммы хрона факта по дню, итогов по разделу работ и итога денег за смену на экране нет | — | — | — | — | — |
| `/resource-usage` (`usage-ledger-summary.tsx`) | Сводка по позиции (актёр / ресурс / транспорт / объект): дней, смена, переработка, доп., итого; переключатель «с налогом / без налога»; итоговая строка | `listUsageLedgerSummary` (`payroll/queries-usage-ledger.ts:59`) по `ProductionReportWorkRow` + `extras`; итог — `reduce` в компоненте (`usage-ledger-summary.tsx:84`) | — | фильтр по виду / поиску в компоненте | **да**: в `page.tsx` `canFinanceRead("actors" / "locations" / {categoryId})`, транспорт — `finance:read` | нет |
| `/resource-usage/actors/[actorId]`, `/resources/[itemId]` (`usage-ledger-detail-view.tsx` + `overtime-history-table.tsx`) | По дням: дата, день, отработано, переработка, доп. выплаты, итого | `getUsageLedgerActorDetail` / `...ResourceDetail` → `listActorOvertimeHistory` / `listResourceOvertimeHistory` (`payroll/queries.ts`) | — | нет | **да**: `canFinanceRead` | нет |
| `/finance/reports` («Движение денег», `finance-reports-workspace.tsx`) | Кассовые платежи за период, итоги: сумма, налог, с налогом, число | `getCashFlowReport` (`finance/queries-reports.ts:50`) | — | период, юрлицо, контрагент | **да**: `finance:read` | **да**: `buildCashFlowWorkbook` (`finance/lib/export-reports-xls.ts`) |
| `/finance` (`finance-workspace.tsx:335`) | Приход, расход, баланс | `reduce` по `FinanceOperation.amount` в компоненте | — | фильтр по типу меняет таблицу, но **не итоги** (итоги по всем операциям) | **да**: `finance:read` | нет |
| `/accruals` | Число, сумма, с налогом | `accrualTotals` (`accruals/queries.ts:77`) | — | фильтры страницы | финправа (страница финансовая) | нет |
| `/payments` | Число, сумма, с налогом; «Разбивка X / Y» в форме | `cashPaymentTotals` (`payments/queries.ts:89`); `roundMoney` (`payments/lib/calc.ts`) | — | фильтры страницы | финправа | нет |
| `/audit` | Только пагинация (`totalPages`) | `audit/queries.ts:89` | — | — | — | нет |
| `/post` | Статистики нет (список задач) | — | — | — | — | нет |

## 3. Либретто

| Экран / блок | Что показано | Из чего считается | Вырез. | Фильтры | Финправа | Экспорт |
|---|---|---|---|---|---|---|
| `/libretto` (`libretto-workspace.tsx:409`) | «Показано N из M сцен · вырезано K»; «Выбрано: N» | `filtered.length`, `scenes.length`, `cutCount`, `selected.size` | да (переключатель «Показать вырезанные») | да | — | **да**: `exportLibrettoXls` (`script/lib/libretto-export-xls.ts`); итоговой строки в файле нет |
| `/libretto` → итоги по фильтру и по выделению | **Нет**: сумм страниц, хрона (план / факт / до монтажа / монтаж), плёнки, числа смен ни по фильтру, ни по выделению не показывается | — | — | — | — | — |
| `/libretto` колонки (`libretto-cell-values.ts`) | Значения на сцену: `planSeconds`, `factSeconds`, `preEditSeconds`, `editSeconds`, `filmFootagePlan/Fact`, `scriptDay`, `status` + дата статуса | поля `Scene` | — | — | — | в экспорте |
| `/libretto/[sceneId]` → «История планирования» (`scene-planning-history.tsx`) | Попытки съёмки сцены по дням со статусом | `SceneShootAttempt` | — | — | — | нет |

## 4. КПП

| Экран / блок | Что показано | Из чего считается | Вырез. | Фильтры | Финправа | Экспорт |
|---|---|---|---|---|---|---|
| `/schedule` шапка | Число дней, назначено сцен | `getScheduleStats` (`schedule/queries.ts:52`) | `assigned` — **нет**, остальные — да | нет | — | — |
| `/schedule` итог дня (`schedule-dnd-board.tsx:375`) | «N сц. · K снято · ММ:СС · P стр.» | `computeDaySummary` + `formatDaySummary` (`schedule/lib/day-summary.ts:64`): страницы = `estimatedPages ?? pageCount`, хрон = `planSeconds`, «снято» = `Scene.status === "SHOT"` | **нет**: вырезанные сцены в дне входят в счётчик, хрон и страницы | нет | — | — |
| `/schedule` карточка сцены | «P стр. / ММ:СС» | `formatPagesMinutes` | — | — | — | — |
| `/schedule` подсказки занятости (кольцо при перетаскивании и метки у сцен) | Актёр занят / свободен на дату | `computePlanningHint`, `computeDaySceneHints` (`actor-availability/lib/planning-hint.ts`): КПП-занятость (`KppBusyMap`) + ручной календарь `ActorAvailabilityDay` | — | — | — | — |
| `/schedule` неспланированные | Список (без итогов) | `listUnscheduledScenes`: без `OFF_PLAN` и вырезанных | да | — | — | — |
| Экспорт КПП (`kpp-export-modal.tsx`, `export-kpp-xls.ts`, `kpp-export-cells.ts:263`) | В строке дня: сумма хрона, сумма страниц | `reduce` по `planSeconds` и **`pageCount`** (без `estimatedPages`) | по данным экспорта (`kpp-export-data.ts` берёт `cutAt`) | конструктор столбцов | — | **да** |

Счётчиков смен по неделям / блокам, итога по всему КПП (всего хрона, страниц, средней выработки за смену) нет.

## 5. Карточки

| Экран / блок | Что показано | Из чего считается | Вырез. | Фильтры | Финправа | Экспорт |
|---|---|---|---|---|---|---|
| `/characters` (`characters-workspace.tsx`) | По персонажу: сцен, хрон, смен по КПП, смен по сценарию (оценка), объектов, даты КПП | `listCharacters` (`characters/queries.ts:77`: хрон без вырезанных); `getKppShiftCount`, `getEstimatedShiftCount`, `getObjectCount`, `getKppDates` (`characters/lib/character-stats.ts`) | хрон — да; смены и сцены — **нет** | да (`character-filters.ts`: диапазоны по сменам) | нет | нет |
| `/characters/[id]` (`character-detail-view.tsx:148`) | «N сцен · план ММ:СС» | `getCharacter` (`characters/queries.ts:180`) | хрон — да; `scenes.length` — **нет** | — | нет | — |
| `/characters/[id]` → актёр: условия оплаты | ставка, часы смены, переработки, доп. выплаты (карточка, не факт) | `Actor`, `ActorOvertimeRate`, `ActorExtraPayment` (`actors/components/actor-payroll-block.tsx`, `payroll/components/financial-terms-block.tsx`) | — | — | **да** (`pickFinanceFields`) | — |
| `/locations` (`locations-workspace.tsx`) | По объекту: смен по КПП, смен по сценарию | `getKppShiftCount`, `getEstimatedShiftCount`, `getKppDates` (**свои копии** в `locations/lib/location-filters.ts:45`) | **нет** | да | нет | нет |
| `/locations/[id]` (`location-detail-view.tsx:100`) | Сцен, смен, хрон (плитки) | считается прямо в компоненте | хрон — да; сцены и смены — **нет** | — | нет | — |
| `/resources/[categoryId]` (`category-workspace.tsx:60, 171`) | Хрон по позиции | `reduce` в компоненте (два раза в одном файле) | да | — | нет | нет |
| `/resources/.../items/[itemId]` (`item-detail-view.tsx`) | Сцен, не снято сцен, хрон, хрон не снятого | `getResourceItem` (`resources/queries.ts:106–114`); «не снято» = `Scene.status !== "SHOT"` | хрон — да; `sceneCount` — **нет** | — | ставки — да | — |
| `/actors/employment/[dayId]`, `/characters/employment/[dayId]` (`actor-employment-view.tsx:56`) | Ролей в дне, с актёром, без актёра | `buildCastForDay` (`day-docs/lib/build-day-doc.ts`) | да (`activeDayScenes`) | — | — | экспорт дня |
| `/counterparties/[id]`, `/cast`, `/preproduction/casting/[personId]`, `/scout/[candidateId]` | Блоков статистики нет | — | — | — | — | — |

## 6. Отчёт смены: план / факт, переработки

- План / факт **по сцене** есть: план (страницы / хрон из `Scene`), факт хрона `ProductionReportSceneFact.factSeconds`, статус факта, тайминги (подготовка, репетиция, мотор), монтажные строки (`ProductionReportMontageRow`: дубль, статус, хрон дубля как строка `takeRuntime`, файлы камер).
- План / факт **по смене**: плановое время — `ShootDay.callTime/wrapTime/shiftStartTime/motorOnTime/motorOffTime`; факт — `ProductionReport.factShiftStart/End`, `lunchStart/End`. Показана только длительность факта смены; сравнения «план − факт» нет.
- Переработки — по строке работы (`ProductionReportWorkRow`): `workedMin`, `factOvertimeMin`, `payableOvertimeMin`, `unpaidOvertimeMin`, `shiftHoursMin`, режимы `OvertimeCalcMode` / `UnpaidOvertimeMode`, снимок ставок `overtimeRates`. Расчёт — `computeWorkPay` / `applyUnpaidBuffer` / `computeOvertimePayAmount` (`compute-work-pay.ts`).
- Деньги смены уходят в начисления (`Accrual` с `workRowId` + `reportPart`) — `syncReportAccruals` (`reports/lib/sync-accruals.ts:166`).
- Итогов по смене (сумма за день, всего переработки за день) на экране нет; сводка по позициям — только `/resource-usage`.

## 7. Занятость актёров и явочный лист

| Экран | Что показано | Из чего | Экспорт |
|---|---|---|---|
| `/schedule/availability` (`availability-calendar.tsx`) | Календарь статусов актёра по датам (до 120 дней за раз); числовых итогов (дней занят / свободен) нет | `ActorAvailabilityRow` / `ActorAvailabilityDay` + КПП-занятость | нет |
| Явочный лист (`day-docs/lib/export-attendance-sheet.ts`, `export-attendance-sheet-xlsx.ts`) | Списки людей по цехам / актёрам / ресурсам, по группам (`unit`); итогов нет | вызывной + КПП дня | **да** (xlsx) |
| Вызывной (`call-sheets/print/print-model.ts:841–850`) | Хрон дня (`dayTiming`), хрон основного юнита (`mainSeconds`) | `reduce` по `planSeconds` | печать / xlsx (`print-xlsx.ts`) |

## 8. Сметы

| Экран / блок | Что показано | Из чего считается | Версия | Фильтры | Финправа | Экспорт |
|---|---|---|---|---|---|---|
| `/smeta` | По цеху: есть ли смета, число строк, итог | `listDepartmentBudgetSummaries` (`smeta/queries.ts:139`) по действующим переменным | текущая | — | доступ к сметам (`smeta-access.ts`) | — |
| `/smeta/[departmentId]` (`budget-items-table.tsx`) | Итоги статьи / подстатьи / цеха; «N строк без суммы — не вошли в итог» | `calcItem`, `sumCalcs`, `sumTotals` (`smeta/lib/item-calc.ts`), Decimal, округление на строке | текущая | — | доступ к цеху | **да**: `items-export-xlsx.ts`, `export-department-xlsx.ts` |
| `/smeta/[dep]/versions`, `/versions/[number]`, `/versions/compare` | Итог версии; разница версий | `BudgetVersion.total`, `BudgetVersionLine`; `budget-diff.ts` | версии сметы | — | доступ к цеху | — |
| `/smeta/summary` («Свод», `items-summary-view.tsx`) | По цехам или по статьям шаблона, до строк; итог по цехам, резерв %, агентские %, итог проекта | `getItemsSummary` (`smeta/items-summary-queries.ts`); `addMoney`, `percentOf` (`summary-money.ts`) | текущая | группировка | `canReadAllSmeta` | **да**: лист «Свод» (`items-export-xlsx.ts:170`), `export-summary-xlsx.ts` |
| `/smeta/plan-fact` (`plan-fact-view.tsx`) | План, начислено, оплачено, остаток, %, перерасход; строки «без плана» / «вне плана» / «Без статьи»; резерв и агентские | `getPlanFact` (`plan-fact-queries.ts:74`) → `loadFacts` (`smeta/facts.ts:25`, `groupBy _sum amountWithTax`) → `buildPlanFact` (`smeta/lib/plan-fact.ts:150`), `planFactNumbers`, `planPercent` | **последняя утверждённая версия** сметы | цех, период | `canOpenSmeta` + видимые цеха | **да**: `export-plan-fact-xlsx.ts` |

## 9. Календарь препродакшена

`/preproduction/calendar` (`prep-calendar/*`): статистики нет — только «+N кандидатов» у события и «Событий: N» у типа (`event-types-workspace.tsx:143`). Экспорт есть: `calendar-export-xlsx.ts`, печать `calendar-export-print.ts`.

Сценарий `/screenplay`: оценка хрона и страниц версии — `estimateScreenplayTiming`, `estimateTotalPages` (`screenplay/lib/timing.ts`, `page-layout.ts`), сводка версии — `version-overview.ts`.

---

## Есть ли в данных то, что нужно для отчётов уровня FilmToolz

| Что нужно | Есть в схеме | Где и в каком виде | Используется в расчётах |
|---|---|---|---|
| Плановая выработка за смену | да | `Project.plannedDailyOutputMin` (минуты) | **нет** — только форма настроек проекта |
| Плановое число смен | да | `Project.shootingDaysCount` | только как переменная сметы (`finance/lib/variables.ts`) |
| Плановые даты съёмок | частично | `Project.startDate/endDate`; дни КПП — `ShootDay.date` | плановой даты сцены отдельно нет, только день КПП |
| Длительность серии | да | `Project.episodeRuntimeMin` | **нет** |
| Число серий | да | `Project.episodeCount` | только переменная сметы |
| Серии как сущность с датой сдачи | **нет** | серия = число `Scene.episodeNumber`; у `PostTask` есть `episodeNumber` + `dueDate`, но это задача поста, не серия | — |
| Плановый хрон сцены | да | `Scene.planSeconds` (+ `pageCount`, `ShootDayScene.estimatedPages`) | везде |
| Фактический хрон сцены | да, в двух местах | `Scene.factSeconds` (поле либретто, вручную) и `ProductionReportSceneFact.factSeconds` (из отчёта смены) — между собой не связаны | факт из отчёта — только в отчёте смены |
| Хрон монтажа | да | `Scene.preEditSeconds`, `Scene.editSeconds` (вручную в либретто); `montageMap` — текст | только показ в либретто |
| Плёнка | да | `Scene.filmFootagePlan/Fact`, `Project.filmCoefficient` | только показ |
| Статусы сцен из отчёта смены | да | `ProductionReportSceneFact.status`: `SHOT / NOT_SHOT / RESHOOT_REQUIRED / DELETED`; история — `SceneShootAttempt`; итоговый статус сцены — `Scene.status` (+ `PLANNING`, `OFF_PLAN`) и `statusDate` | счётчики «снято» берут `Scene.status`, а не факт конкретного дня |
| Факт времени актёров / ресурсов | да | `ProductionReportWorkRow.factStart/factEnd`, `workedMin`, `lunchSkipped`; время по плану — `ShootDayActorCall`, `ShootDayResourceUsage`, `ShootDayResourceCall` | в отчёте смены и `/resource-usage` |
| Переработки | да | `factOvertimeMin`, `payableOvertimeMin`, `unpaidOvertimeMin`, ставки по часам (`*OvertimeRate`, снимок в `overtimeRates`) | да |
| Доп. выплаты | да | на смену — `ProductionReportWorkExtra`; по карточке — `ActorExtraPayment`, `ResourceExtraPayment` (с датой) | да |
| Километраж | да | `factKm`, `kmRate`, `mileagePay` | да |
| Теги | частично, текстом | `Location.tags`, `Actor.tags`, `CastingPerson.tags` — строка; `Contract.tags` — массив. У сцен, ресурсов, дней КПП тегов нет | только фильтры / показ |
| Группы (юниты) | да | `ShootDay.unit`, `Accrual.groupUnit`, `CallSheetUnit` | статистика по группам не разделяется (кроме вызывного и явочного) |

---

## Одна метрика — несколько реализаций (кандидаты на общий расчёт)

1. **Итог дня КПП (сцены, снято, хрон, страницы, объекты)** — четыре реализации с разными правилами:
   - `computeDaySummary` (`schedule/lib/day-summary.ts:64`) — **вырезанные сцены входят**;
   - `buildDayStats` (`day-docs/lib/build-day-doc.ts:115`) — вырезанные не входят (по поиску вызывается только из тестов);
   - `getKppFullCellValue` / `kpp-export-cells.ts:265–270` — страницы берутся из `pageCount` без `estimatedPages`;
   - `print-model.ts:841` (`dayTiming`, `mainSeconds`) — свой расчёт хрона вызывного.
   В результате на доске КПП, в экспорте и в вызывном хрон и страницы одного и того же дня могут не совпасть.
2. **Хрон по набору сцен без вырезанных** — одна и та же формула `reduce(cutAt ? 0 : planSeconds)` в шести местах: `characters/queries.ts:77` и `:180`, `resources/queries.ts:106` и `:113`, `resources/components/category-workspace.tsx:60` и `:171`, `locations/components/location-detail-view.tsx:105`; плюс `screenplay/lib/timing.ts:47`.
3. **Число смен / дат по КПП и оценка смен по сценарию** — `getKppShiftCount`, `getEstimatedShiftCount`, `getKppDates` скопированы один в один: `characters/lib/character-stats.ts` и `locations/lib/location-filters.ts:45–75`; третья копия — прямо в `location-detail-view.tsx:103`. Вырезанные сцены нигде не исключаются, хотя хрон рядом их исключает.
4. **Число сцен у карточки** — `scenes.length` / `sceneLinks.length` / `_count.scenes` (персонаж, объект, ресурс) — с вырезанными, а хрон в той же карточке — без них.
5. **Счётчики КПП для обзора и шапки КПП** — `getOverviewStats` (`projects/queries.ts:105`) и `getScheduleStats` (`schedule/queries.ts:52`) делают одни и те же запросы; в `getScheduleStats` `assigned` — с вырезанными, `plannedScenes` — без.
6. **«Снято / не снято»** — по `Scene.status` в `computeDaySummary`, `buildDayStats`, `resources/queries.ts:110`; факт дня (`ProductionReportSceneFact.status`) в счётчиках не участвует.
7. **Сумма доп. выплат строки** — `sumExtrasPay` (`payroll/lib/parse-extra-payments.ts:56`) и своя копия `extrasGross` / `extrasNet` в `payroll/queries-usage-ledger.ts:189–197`; ещё одна сумма «без налога» — `sync-accruals.ts:129`.
8. **Итоги списка денег (число, сумма, с налогом)** — `accrualTotals` (`accruals/queries.ts:77`) и `cashPaymentTotals` (`payments/queries.ts:89`) — одинаковые функции.
9. **Налог** — `withTax` / `taxAmountFromBase` / `reverseFromGross` (`reports/lib/compute-work-pay.ts`), `computeTaxAmounts` (`accruals/lib/labels.ts:16`), `stripTax` / `pickTaxModeAmount` (`payroll/lib/tax-display.ts`), `computeContractVat` (`contracts/lib/vat.ts`), налог в смете (`item-calc.ts`).
10. **Округление денег** — `round2` в пяти файлах (`sync-accruals.ts:83`, `contracts/lib/vat.ts:63`, `smeta/lib/budget-diff.ts:74`, `main-sheet.ts:202`, `plan-fact.ts:115`, `version-snapshot.ts:18`) + `roundMoney` (`payments/lib/calc.ts:5`). Смета считает в Decimal, отчёт смены / `/resource-usage` / `/finance` / начисления — в обычных числах JS.
11. **Форматирование денег** — `formatMoney` (`reports/lib/compute-work-pay.ts:340`), `formatMoney` (`smeta/lib/line-draft.ts:145`), `formatRub` (`smeta/lib/money.ts:2`), `formatPay` (`payroll/lib/tax-display.ts:32`), `money(...)` в списках начислений / платежей / финансов.
12. **Время ЧЧ:ММ → минуты, длительность** — `toMin` / `minutesBetween` (`compute-work-pay.ts:71–76`), `toMin` (`day-docs/lib/time-utils.ts:12`), `toMin` (`build-day-doc.ts:532`), `formatDuration` (`call-sheets/print/print-model.ts:356`), `formatFactDuration` (`reports/types.ts:15`).

---

## Замечено попутно (не чинилось)

- `/finance`: итоги «приход / расход / баланс» не меняются при фильтре по типу — они всегда по всем операциям.
- `/finance/reports`: границы периода берутся по UTC (`queries-reports.ts:13`), а не по часовому поясу проекта — платёж около полуночи может попасть не в тот день.
- `buildDayStats` выглядит неиспользуемым вне тестов, а на доске КПП работает `computeDaySummary` с вырезанными сценами — расхождение со строкой «Сцена вырезана: … не попадает в итоги хронометража» в `scene-editor.tsx:226`.
- Факт хрона есть и в либретто (`Scene.factSeconds`), и в отчёте смены (`ProductionReportSceneFact.factSeconds`) — один в другой не переносится.

## Чего нет совсем (для сравнения с FilmToolz)

- Итоги по фильтру и по выделению в либретто (страницы, хрон, смены).
- Итог всего КПП и выработка за смену «план / факт» (поле `plannedDailyOutputMin` есть, но не используется).
- Сводка «снято / осталось» по проекту и по сериям, прогноз окончания.
- Серии как сущность (дата сдачи, хрон серии против `episodeRuntimeMin`).
- Итоги отчёта смены по дню (деньги, переработки, хрон факта).
- Графики: ни одного графика в проекте нет.
- Отчёты по тегам.
