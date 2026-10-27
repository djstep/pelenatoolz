import {
  buildDayStats,
  buildShootingSlotDetails,
  formatSceneNumber,
  type CastRow,
  type DayDocBundle,
  type PerShiftResourceRow,
  type ResourceTableRow,
  type buildResourceTables,
} from "@/features/day-docs/lib/build-day-doc";
import type { DayAstro } from "@/features/day-docs/lib/city-astro";
import {
  isManualActorTiming,
  isManualResourceTiming,
  type ActorTimingBaselines,
  type ResourceTimingBaselines,
} from "@/features/day-docs/lib/compute-call-timings";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { cn } from "@/shared/lib/cn";
import {
  dayNightLabels,
  formatSecondsMmSs,
  intExtLabels,
} from "@/shared/i18n/domain-labels";

/**
 * Вызывной в виде печатного листа по образцу FilmTools:
 * стр. 1 — шапка дня, руководители, цеха, сбор, актёры и ресурсы;
 * стр. 2 (альбомная) — расписание по таймслотам.
 */

type Props = {
  bundle: DayDocBundle;
  astro: DayAstro | null;
  cast: CastRow[];
  resources: ReturnType<typeof buildResourceTables>;
  perShiftResources: PerShiftResourceRow[];
  timingBaselines: ActorTimingBaselines;
  resourceTimingBaselines: ResourceTimingBaselines;
};

type Day = DayDocBundle["day"];
type Scene = Day["scenes"][number]["scene"];

/** «11 сентября 2026» — без «г.», как в образце. */
function dateLong(value: Date | string) {
  return new Date(value)
    .toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .replace(/\s*г\.$/, "");
}

function weekday(value: Date | string) {
  return new Date(value).toLocaleDateString("ru-RU", { weekday: "long" });
}

function dateNumeric(value: Date | string) {
  return new Date(value).toLocaleDateString("ru-RU");
}

function temperature(value: number | null | undefined) {
  if (value == null) return "—";
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Длительность слота «ЧЧ:ММ», как в образце; через полночь тоже считает. */
function slotDuration(start: string, end: string | null) {
  if (!end) return "—";
  let diff = toMinutes(end) - toMinutes(start);
  if (diff < 0) diff += 24 * 60;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dash(value: string | null | undefined) {
  return value?.trim() ? value : "—";
}

/** Ячейка времени: на экране подсвечивает ручную правку, при печати — обычная. */
function TimeCell({
  value,
  computed,
}: {
  value: string | null;
  computed?: string | null;
}) {
  const manual =
    isManualActorTiming(value, computed) || isManualResourceTiming(value, computed);
  return (
    <td
      className={cn(manual && "cs-manual")}
      title={manual && computed ? `Изменено вручную. Расчётное: ${computed}` : undefined}
    >
      {dash(value)}
    </td>
  );
}

function Bar({ children, colSpan }: { children: React.ReactNode; colSpan: number }) {
  return (
    <tr>
      <th colSpan={colSpan} className="cs-bar">
        {children}
      </th>
    </tr>
  );
}

type ResourceSection = { title: string; rows: ResourceTableRow[] };

function ResourceBlock({
  section,
  baselines,
}: {
  section: ResourceSection;
  baselines: ResourceTimingBaselines;
}) {
  return (
    <table className="cs-table cs-table--resources">
      <colgroup>
        <col className="cs-col-name" />
        <col className="cs-col-scenes" />
        <col className="cs-col-time" />
        <col className="cs-col-time" />
        <col className="cs-col-time" />
      </colgroup>
      <thead>
        <Bar colSpan={5}>{section.title}</Bar>
        <tr className="cs-head">
          <th>Наименование</th>
          <th>Сцены</th>
          <th>Прибытие</th>
          <th>Готовность</th>
          <th>Конец смены</th>
        </tr>
      </thead>
      <tbody>
        {section.rows.map((row) => {
          const baseline = baselines[row.key];
          return (
            <tr key={row.key}>
              <td>{row.name}</td>
              <td>{row.sceneNumbers.join(", ") || "—"}</td>
              <TimeCell value={row.arrival} computed={baseline?.arrivalTime} />
              <TimeCell value={row.ready} computed={baseline?.readyTime} />
              <TimeCell value={row.wrap} computed={baseline?.wrapTime} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Посменные ресурсы — те же таблицы, сгруппированные по категории. */
function perShiftSections(rows: PerShiftResourceRow[]): ResourceSection[] {
  const byCategory = new Map<string, ResourceTableRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.categoryName) ?? [];
    list.push({
      key: `${row.categoryName}::${row.itemName}`,
      category: row.categoryName,
      name: row.notes ? `${row.itemName} (${row.notes})` : row.itemName,
      sceneNumbers: [],
      arrival: row.arrival,
      costume: null,
      makeup: null,
      ready: row.ready,
      wrap: row.wrap,
    });
    byCategory.set(row.categoryName, list);
  }
  return [...byCategory.entries()].map(([name, list]) => ({
    title: name,
    rows: list,
  }));
}

function sceneObjects(day: Day) {
  const byName = new Map<string, { address: string | null; scenes: string[] }>();
  for (const row of day.scenes) {
    const num = formatSceneNumber(row.scene);
    for (const link of row.scene.locations) {
      const entry = byName.get(link.location.name) ?? {
        address: link.location.address ?? null,
        scenes: [],
      };
      entry.scenes.push(num);
      byName.set(link.location.name, entry);
    }
  }
  return [...byName.entries()].map(([name, entry]) => ({ name, ...entry }));
}

function TitleLine({ projectTitle, date }: { projectTitle: string; date: Date | string }) {
  return (
    <p className="cs-title">
      Вызывной «{projectTitle}» {dateNumeric(date)}
    </p>
  );
}

function FirstPage({
  bundle,
  astro,
  cast,
  resources,
  perShiftResources,
  timingBaselines,
  resourceTimingBaselines,
}: Props) {
  const { project, day } = bundle;
  const stats = buildDayStats(day);
  const projectTitle = project.fullName || project.name;

  const leaders = day.departmentCalls.filter((d) => d.personName || d.phone);
  const departments = day.departmentCalls.filter((d) => d.callTime);
  const lunch = day.timeSlots.find((slot) => slot.slotType === "LUNCH");
  const objects = sceneObjects(day);
  const shiftStart = day.shiftStartTime || day.callTime;

  const weather = [
    astro?.weatherSummary && !astro.weatherUnavailable
      ? astro.weatherSummary
      : day.weatherNote,
    day.weatherPrecip || (astro?.precipProb ? `осадки ${astro.precipProb}%` : null),
  ]
    .filter(Boolean)
    .join(", ");

  const notes = [day.notes, day.comment].filter(Boolean).join("\n");

  const sections: ResourceSection[] = [
    { title: "Групповка / массовка", rows: resources.extras },
    { title: "Игровой транспорт", rows: resources.vehicles },
    { title: "Реквизит", rows: [...resources.props, ...resources.art] },
    { title: "Трюк", rows: resources.stunts },
    { title: "Операторская техника", rows: resources.camera },
    ...resources.catalog.map((section) => ({
      title: section.categoryName,
      rows: section.rows,
    })),
    ...perShiftSections(perShiftResources),
  ].filter((section) => section.rows.length > 0);

  return (
    <section className="cs-page cs-page--portrait">
      <TitleLine projectTitle={projectTitle} date={day.date} />

      <div className="cs-top">
        {/* Левая колонка: день и руководители группы */}
        <div>
          <table className="cs-table">
            <tbody>
              <tr className="cs-head">
                <td>
                  {dateLong(day.date)}
                  <br />
                  {weekday(day.date)}
                </td>
                <td>Смена № {day.shiftNumber ?? day.dayNumber}</td>
              </tr>
              <tr>
                <td>Хрон дня {stats.timingLabel}</td>
                <td>Сцен {stats.sceneCount}</td>
              </tr>
            </tbody>
          </table>
          {leaders.length > 0 ? (
            <table className="cs-table">
              <thead>
                <Bar colSpan={2}>Руководители группы</Bar>
              </thead>
              <tbody>
                {leaders.map((d) => (
                  <tr key={d.id}>
                    <td>{d.roleLabel}</td>
                    <td>
                      {dash(d.personName)}
                      {d.phone ? (
                        <>
                          <br />
                          {d.phone}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>

        {/* Средняя колонка: ключевые времена и цеха */}
        <div>
          <table className="cs-table">
            <tbody>
              <tr className="cs-head">
                <td>Начало смены</td>
                <td>{dash(shiftStart)}</td>
              </tr>
              <tr className="cs-head">
                <td>Репетиция</td>
                <td>{dash(day.rehearsalTime)}</td>
              </tr>
              <tr className="cs-head">
                <td>Мотор</td>
                <td>{dash(day.motorOnTime)}</td>
              </tr>
              <tr className="cs-head">
                <td>Стоп-мотор</td>
                <td>{dash(day.motorOffTime)}</td>
              </tr>
            </tbody>
          </table>
          {departments.length > 0 ? (
            <table className="cs-table">
              <thead>
                <tr className="cs-head">
                  <th>Название</th>
                  <th>Начало смены</th>
                </tr>
                <Bar colSpan={2}>Цеха</Bar>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>{d.roleLabel}</td>
                    <td>{d.callTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>

        {/* Правая колонка: погода, сбор, адреса, примечание */}
        <div>
          <table className="cs-table">
            <tbody>
              <tr>
                <td colSpan={4} className="cs-left">
                  Погода: {weather || "—"}
                </td>
              </tr>
              <tr>
                <td>t день</td>
                <td>{temperature(astro?.tempMax)}</td>
                <td>Восход</td>
                <td>{dash(astro?.sunrise)}</td>
              </tr>
              <tr>
                <td>t ночь</td>
                <td>{temperature(astro?.tempMin)}</td>
                <td>Закат</td>
                <td>{dash(astro?.sunset)}</td>
              </tr>
            </tbody>
          </table>
          <table className="cs-table">
            <thead>
              <Bar colSpan={2}>Время и место сбора группы</Bar>
            </thead>
            <tbody>
              <tr>
                <td colSpan={2}>
                  {dash(day.crewMeetTime || shiftStart)}
                  {day.crewMeetAddress ? (
                    <>
                      <br />
                      {day.crewMeetAddress}
                    </>
                  ) : null}
                </td>
              </tr>
              <tr>
                <td>Смена</td>
                <td>
                  {shiftStart || day.wrapTime
                    ? `${dash(shiftStart)} – ${dash(day.wrapTime)}`
                    : "—"}
                </td>
              </tr>
              <tr>
                <td>Обед</td>
                <td>
                  {lunch
                    ? `${lunch.startTime}${lunch.endTime ? ` – ${lunch.endTime}` : ""}`
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
          <table className="cs-table">
            <thead>
              <Bar colSpan={1}>Адрес / Объекты</Bar>
            </thead>
            <tbody>
              {objects.length === 0 ? (
                <tr>
                  <td>—</td>
                </tr>
              ) : (
                objects.map((obj) => (
                  <tr key={obj.name}>
                    <td>
                      <strong>{obj.name}</strong> ({obj.scenes.join(", ")})
                      {obj.address ? (
                        <>
                          <br />
                          {obj.address}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {notes ? (
            <table className="cs-table">
              <thead>
                <Bar colSpan={1}>Примечание</Bar>
              </thead>
              <tbody>
                <tr>
                  <td className="cs-note">{notes}</td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </div>
      </div>

      {day.transports.length > 0 ? (
        <table className="cs-table cs-table--transport">
          <thead>
            <Bar colSpan={4}>Спецтранспорт</Bar>
          </thead>
          <tbody>
            {Array.from(
              { length: Math.ceil(day.transports.length / 2) },
              (_, i) => [day.transports[i * 2], day.transports[i * 2 + 1]],
            ).map(([a, b]) => (
              <tr key={a!.id}>
                <td>
                  {a!.name}
                  {a!.notes ? ` (${a!.notes})` : ""}
                </td>
                <td>{dash(a!.callTime)}</td>
                <td>
                  {b ? (
                    <>
                      {b.name}
                      {b.notes ? ` (${b.notes})` : ""}
                    </>
                  ) : null}
                </td>
                <td>{b ? dash(b.callTime) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <table className="cs-table cs-table--cast">
        <thead>
          <Bar colSpan={9}>Актёры</Bar>
          <tr className="cs-head">
            <th>Персонаж</th>
            <th>Имя</th>
            <th>Сцены</th>
            <th>Машина за актёром</th>
            <th>Прибытие</th>
            <th>Костюм</th>
            <th>Грим</th>
            <th>Готовность</th>
            <th>Конец смены</th>
          </tr>
        </thead>
        <tbody>
          {cast.length === 0 ? (
            <tr>
              <td colSpan={9}>В сценах дня нет персонажей</td>
            </tr>
          ) : (
            cast.map((row) => {
              const baseline = row.actorId ? timingBaselines[row.actorId] : undefined;
              return (
                <tr key={`${row.characterName}-${row.actorId ?? "na"}`}>
                  <td>{row.characterName}</td>
                  <td>{row.actorName || "не назначен"}</td>
                  <td>{row.sceneNumbers.join(", ")}</td>
                  <TimeCell value={row.pickup} computed={baseline?.pickupTime} />
                  <td>{dash(row.arrival)}</td>
                  <TimeCell value={row.costume} computed={baseline?.costumeTime} />
                  <TimeCell value={row.makeup} computed={baseline?.makeupTime} />
                  <TimeCell value={row.ready} computed={baseline?.readyTime} />
                  <TimeCell value={row.wrap} computed={baseline?.wrapTime} />
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {sections.map((section) => (
        <ResourceBlock
          key={section.title}
          section={section}
          baselines={resourceTimingBaselines}
        />
      ))}
    </section>
  );
}

/** Подробности сцены в последней колонке расписания. */
function sceneNoteLines(details: ReturnType<typeof buildShootingSlotDetails>) {
  const lines: Array<[string, string]> = [];
  if (details.notes) lines.push(["Примечание", details.notes]);
  const group = [...details.groups, ...details.extras];
  if (group.length) lines.push(["Групповка", group.join(", ")]);
  if (details.stunts.length) lines.push(["Каскадёр / трюк", details.stunts.join(", ")]);
  if (details.makeup.length) lines.push(["Грим", details.makeup.join(", ")]);
  if (details.costumes.length) lines.push(["Костюм", details.costumes.join(", ")]);
  if (details.props.length) lines.push(["Реквизит", details.props.join(", ")]);
  if (details.camera.length) lines.push(["Операторская техника", details.camera.join(", ")]);
  if (details.custom.length) lines.push(["Прочее", details.custom.join(", ")]);
  return lines;
}

function SceneCells({ scene, notes }: { scene: Scene; notes: string | null }) {
  const details = buildShootingSlotDetails(scene, notes);
  const lines = sceneNoteLines(details);
  return (
    <>
      <td className="cs-strong">{details.sceneNumber}</td>
      <td>{scene.planSeconds ? formatSecondsMmSs(scene.planSeconds) : "—"}</td>
      <td>
        {[scene.dayNight ? dayNightLabels[scene.dayNight] : null, details.scriptDay]
          .filter((v) => v != null && v !== "")
          .join(" ") || "—"}
        {scene.intExt ? (
          <>
            <br />
            {intExtLabels[scene.intExt]}
          </>
        ) : null}
      </td>
      <td className="cs-left">{dash(details.location)}</td>
      <td className="cs-left">{dash(details.summary)}</td>
      <td className="cs-left">{details.characters.join(", ") || "—"}</td>
      <td className="cs-left">{details.vehicles.join(", ") || "—"}</td>
      <td className="cs-left">
        {lines.length === 0
          ? "—"
          : lines.map(([label, text]) => (
              <div key={label}>
                <strong>{label}:</strong> {text}
              </div>
            ))}
      </td>
    </>
  );
}

function SchedulePage({ bundle }: { bundle: DayDocBundle }) {
  const { project, day } = bundle;
  const stats = buildDayStats(day);
  const assignments = new Map(day.scenes.map((row) => [row.scene.id, row]));

  return (
    <section className="cs-page cs-page--landscape">
      <TitleLine projectTitle={project.fullName || project.name} date={day.date} />
      <table className="cs-table cs-table--schedule">
        <colgroup>
          <col className="cs-col-clock" />
          <col className="cs-col-clock" />
          <col className="cs-col-clock" />
          <col className="cs-col-num" />
          <col className="cs-col-clock" />
          <col className="cs-col-daynight" />
          <col className="cs-col-object" />
          <col className="cs-col-synopsis" />
          <col className="cs-col-people" />
          <col className="cs-col-vehicles" />
          <col className="cs-col-notes" />
        </colgroup>
        <thead>
          <tr className="cs-bar">
            <th colSpan={3}>
              {dateLong(day.date)}
              <br />
              {weekday(day.date)}
            </th>
            <th>№ сцены</th>
            <th>Хр-ж план</th>
            <th>Реж / Сц. день</th>
            <th>Объект</th>
            <th>Синопсис</th>
            <th>Персонажи</th>
            <th>Игровой транспорт</th>
            <th>Примечание / Каскадёр / Трюк / Операторская техника</th>
          </tr>
        </thead>
        <tbody>
          {day.timeSlots.length > 0
            ? day.timeSlots.map((slot) => {
                const assignment = slot.sceneId ? assignments.get(slot.sceneId) : undefined;
                const scene = assignment?.scene ?? slot.scene;
                const times = (
                  <>
                    <td>{slot.startTime}</td>
                    <td>{dash(slot.endTime)}</td>
                    <td>{slotDuration(slot.startTime, slot.endTime)}</td>
                  </>
                );
                if (slot.slotType === "SHOOTING" && scene) {
                  return (
                    <tr key={slot.id}>
                      {times}
                      <SceneCells scene={scene} notes={assignment?.notes ?? slot.notes} />
                    </tr>
                  );
                }
                return (
                  <tr
                    key={slot.id}
                    className={cn(
                      "cs-slot",
                      slot.slotType === "LUNCH" && "cs-slot--lunch",
                    )}
                  >
                    {times}
                    <td colSpan={8}>
                      {slot.notes?.trim() || timeSlotTypeLabels[slot.slotType]}
                    </td>
                  </tr>
                );
              })
            : day.scenes.map((row) => (
                // Без таймслотов — просто сцены дня по порядку, без времени.
                <tr key={row.id}>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <SceneCells scene={row.scene} notes={row.notes} />
                </tr>
              ))}
          <tr className="cs-bar">
            <td colSpan={4} className="cs-left">
              Итого
            </td>
            <td>{stats.timingLabel}</td>
            <td colSpan={6} />
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function CallSheetDocument(props: Props) {
  return (
    <div className="cs-doc">
      <FirstPage {...props} />
      <SchedulePage bundle={props.bundle} />
    </div>
  );
}
