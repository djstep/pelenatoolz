"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useMemo, useOptimistic, useState, useTransition } from "react";
import { reorderCrewAction } from "@/features/crew/actions";
import { CrewLinkModal } from "@/features/crew/components/crew-link-modal";
import { CrewMemberModal } from "@/features/crew/components/crew-member-modal";
import { CrewPullModal } from "@/features/crew/components/crew-pull-modal";
import { CrewSyncModal } from "@/features/crew/components/crew-sync-modal";
import {
  crewCanUseContracts,
  crewContractMark,
  crewFullName,
  crewMainContract,
  crewPhoneHref,
  groupCrewRows,
  matchesCrewSearch,
  NO_DEPARTMENT_TITLE,
  type CrewDepartment,
  type CrewGroup,
  type CrewRights,
  type CrewRow,
} from "@/features/crew/lib/crew-rules";
import { cn } from "@/shared/lib/cn";
import { statusBadgeStyle } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { SegmentControl } from "@/shared/ui/segment-control";
import { Select } from "@/shared/ui/select";
import { toast } from "@/shared/ui/toast";

type View = "active" | "archive";

const NO_DEPARTMENT_FILTER = "none";

function SourceCell({ row }: { row: CrewRow }) {
  const label = row.source === "CONTRACT" ? "из договора" : "вручную";
  if (row.contracts === undefined) return <>{label}</>;
  const main = crewMainContract(row.contracts);
  const mark = crewContractMark(row);
  return (
    <>
      <div>{label}</div>
      {main ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-[var(--muted-fg)]">
          № {main.number}
          <span className="status-badge" style={statusBadgeStyle(main.statusColor)}>
            {main.statusName}
          </span>
          {row.contracts.length > 1 ? `+${row.contracts.length - 1}` : null}
        </div>
      ) : null}
      {mark ? (
        <div className="mt-0.5 text-xs font-semibold text-[var(--danger)]">
          {mark === "deleted" ? "договор удалён" : "договор отклонён"}
        </div>
      ) : null}
    </>
  );
}

function CrewTableRow({
  row,
  rights,
  dragEnabled,
  onOpen,
}: {
  row: CrewRow;
  rights: CrewRights;
  dragEnabled: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !dragEnabled,
  });
  const name = crewFullName(row);
  const tel = crewPhoneHref(row.phone);

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "border-b border-[var(--border)]/60 align-top",
        isDragging && "relative z-10 bg-[var(--surface)] shadow-md",
      )}
    >
      {rights.write ? (
        <td className="w-8 px-2 py-2">
          {dragEnabled ? (
            <button
              type="button"
              className="cursor-grab touch-none px-1 text-[var(--muted-fg)] active:cursor-grabbing"
              aria-label={`Перетащить: ${name}`}
              {...attributes}
              {...listeners}
            >
              ⠿
            </button>
          ) : null}
        </td>
      ) : null}
      <td className="px-3 py-2 font-medium">
        <button type="button" className="text-left hover:text-[var(--accent)]" onClick={onOpen}>
          {name}
        </button>
      </td>
      <td className="px-3 py-2">{row.position || "—"}</td>
      {rights.contacts ? (
        <>
          <td className="whitespace-nowrap px-3 py-2 tabular-nums">
            {tel ? (
              <a href={tel} className="hover:text-[var(--accent)]">
                {row.phone}
              </a>
            ) : (
              row.phone || "—"
            )}
          </td>
          <td className="px-3 py-2">
            {row.email ? (
              <a href={`mailto:${row.email}`} className="hover:text-[var(--accent)]">
                {row.email}
              </a>
            ) : (
              "—"
            )}
          </td>
        </>
      ) : null}
      <td className="px-3 py-2 text-[var(--muted-fg)]">
        <SourceCell row={row} />
      </td>
      <td className="max-w-[160px] truncate px-3 py-2 text-[var(--muted-fg)]" title={row.note ?? ""}>
        {row.note || "—"}
      </td>
    </tr>
  );
}

function CrewGroupBody({
  group,
  rights,
  dragEnabled,
  columnCount,
  onOpen,
}: {
  group: CrewGroup;
  rights: CrewRights;
  dragEnabled: boolean;
  columnCount: number;
  onOpen: (row: CrewRow) => void;
}) {
  return (
    <SortableContext
      items={group.rows.map((r) => r.id)}
      strategy={verticalListSortingStrategy}
    >
      <tbody data-crew-group={group.title}>
        <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
          <th colSpan={columnCount} scope="rowgroup" className="px-3 py-1.5 text-left text-xs font-semibold">
            {group.title}{" "}
            <span className="font-normal tabular-nums text-[var(--muted-fg)]">
              {group.rows.length}
            </span>
          </th>
        </tr>
        {group.rows.map((row) => (
          <CrewTableRow
            key={row.id}
            row={row}
            rights={rights}
            dragEnabled={dragEnabled}
            onOpen={() => onOpen(row)}
          />
        ))}
      </tbody>
    </SortableContext>
  );
}

export function CrewWorkspace({
  projectId,
  locale,
  rows,
  departments,
  rights,
}: {
  projectId: string;
  locale: string;
  rows: CrewRow[];
  departments: CrewDepartment[];
  rights: CrewRights;
}) {
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [view, setView] = useState<View>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pulling, setPulling] = useState(false);
  // Окна поверх карточки: карточка под ними остаётся с тем, что в ней уже введено.
  const [linkId, setLinkId] = useState<string | null>(null);
  const [syncId, setSyncId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Новый порядок виден сразу; после ответа сервера список приходит уже упорядоченным.
  const [ordered, setOrdered] = useOptimistic(rows);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  // Постоянный id: иначе служебные aria-атрибуты dnd-kit на сервере и в браузере расходятся.
  const dndId = useId();

  const archivedCount = ordered.filter((r) => r.archived).length;
  const activeCount = ordered.length - archivedCount;

  const groups = useMemo(() => {
    const visible = ordered.filter(
      (r) =>
        r.archived === (view === "archive") &&
        (departmentFilter === "" ||
          (departmentFilter === NO_DEPARTMENT_FILTER
            ? !r.departmentId
            : r.departmentId === departmentFilter)) &&
        matchesCrewSearch(r, search),
    );
    return groupCrewRows(visible, departments);
  }, [ordered, view, departmentFilter, search, departments]);

  // Порядок считается по всему цеху, поэтому при поиске и в архиве не перетаскиваем.
  const dragEnabled = rights.write && view === "active" && search.trim() === "";
  const columnCount = (rights.write ? 1 : 0) + 4 + (rights.contacts ? 2 : 0);
  const member = ordered.find((r) => r.id === openId);
  const canPull = crewCanUseContracts(rights);

  const pullModal = pulling ? (
    <CrewPullModal
      projectId={projectId}
      departments={departments}
      rights={rights}
      onClose={() => setPulling(false)}
    />
  ) : null;

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const group = groups.find((g) => g.rows.some((r) => r.id === active.id));
    if (!group) return;
    const oldIndex = group.rows.findIndex((r) => r.id === active.id);
    const newIndex = group.rows.findIndex((r) => r.id === over.id);
    // Порядок только внутри цеха: цех меняется в карточке человека.
    if (oldIndex < 0 || newIndex < 0) return;
    const moved = arrayMove(group.rows, oldIndex, newIndex);
    const positions = new Map(moved.map((r, index) => [r.id, index + 1]));
    startTransition(async () => {
      setOrdered(
        ordered.map((r) => {
          const sortOrder = positions.get(r.id);
          return sortOrder === undefined ? r : { ...r, sortOrder };
        }),
      );
      const result = await reorderCrewAction(
        projectId,
        moved.map((r) => r.id),
      );
      if (result.error) toast.error(result.error);
    });
  }

  if (ordered.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-sm text-[var(--muted-fg)]">В команде пока никого нет.</p>
        <div className="flex flex-wrap gap-3">
          {rights.write ? (
            <Button type="button" onClick={() => setCreating(true)}>
              Добавить вручную
            </Button>
          ) : null}
          {canPull ? (
            <Button type="button" variant="secondary" onClick={() => setPulling(true)}>
              Подтянуть из договоров
            </Button>
          ) : null}
        </div>
        {pullModal}
        <CrewMemberModal
          key={creating ? "new" : "closed"}
          projectId={projectId}
          locale={locale}
          departments={departments}
          rights={rights}
          open={creating}
          onClose={() => setCreating(false)}
        />
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-3">
          <Input
            type="search"
            aria-label="Поиск"
            placeholder={rights.contacts ? "ФИО, должность, телефон" : "ФИО, должность"}
            className="w-full sm:w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            aria-label="Цех"
            className="w-full sm:w-52"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="">Все цеха</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
            <option value={NO_DEPARTMENT_FILTER}>{NO_DEPARTMENT_TITLE}</option>
          </Select>
          <SegmentControl
            name="crew-view"
            value={view}
            onChange={setView}
            options={[
              { value: "active", label: `В работе ${activeCount}` },
              { value: "archive", label: `Архив ${archivedCount}` },
            ]}
          />
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {canPull ? (
              <Button type="button" variant="secondary" onClick={() => setPulling(true)}>
                Подтянуть из договоров
              </Button>
            ) : null}
            {rights.write ? (
              <Button type="button" onClick={() => setCreating(true)}>
                Добавить вручную
              </Button>
            ) : null}
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="p-6 text-sm text-[var(--muted-fg)]">Никого не нашли.</p>
        ) : (
          <div className="overflow-x-auto">
            <DndContext
              id={dndId}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <table
                className={cn(
                  "glass-table w-full border-collapse text-left text-sm",
                  rights.contacts ? "min-w-[860px]" : "min-w-[640px]",
                )}
              >
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {rights.write ? <th className="w-8 px-2 py-2" aria-label="Порядок" /> : null}
                    <th className="px-3 py-2">ФИО</th>
                    <th className="px-3 py-2">Должность</th>
                    {rights.contacts ? (
                      <>
                        <th className="px-3 py-2">Телефон</th>
                        <th className="px-3 py-2">Почта</th>
                      </>
                    ) : null}
                    <th className="px-3 py-2">Источник</th>
                    <th className="px-3 py-2">Заметка</th>
                  </tr>
                </thead>
                {groups.map((group) => (
                  <CrewGroupBody
                    key={group.key}
                    group={group}
                    rights={rights}
                    dragEnabled={dragEnabled}
                    columnCount={columnCount}
                    onOpen={(row) => setOpenId(row.id)}
                  />
                ))}
              </table>
            </DndContext>
          </div>
        )}
      </div>

      <CrewMemberModal
        // Новый key на каждое открытие: форма начинает с чистого состояния, без прошлого «успеха».
        key={openId ?? (creating ? "new" : "closed")}
        projectId={projectId}
        locale={locale}
        member={member}
        departments={departments}
        rights={rights}
        open={creating || member != null}
        onClose={() => {
          setCreating(false);
          setOpenId(null);
        }}
        onLink={member ? () => setLinkId(member.id) : undefined}
        onSync={member ? () => setSyncId(member.id) : undefined}
      />
      {pullModal}
      {member && linkId === member.id ? (
        <CrewLinkModal
          projectId={projectId}
          memberId={member.id}
          memberName={crewFullName(member)}
          onClose={() => setLinkId(null)}
        />
      ) : null}
      {member && syncId === member.id ? (
        <CrewSyncModal
          projectId={projectId}
          memberId={member.id}
          memberName={crewFullName(member)}
          rights={rights}
          onClose={() => setSyncId(null)}
          onApplied={() => {
            // Поля карточки заполнены до обновления: сохранить их — значит откатить его.
            setSyncId(null);
            setOpenId(null);
          }}
        />
      ) : null}
    </>
  );
}
