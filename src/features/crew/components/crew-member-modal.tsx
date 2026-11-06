"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import {
  archiveCrewMemberAction,
  createCrewMemberAction,
  restoreCrewMemberAction,
  updateCrewMemberAction,
  type CrewActionState,
} from "@/features/crew/actions";
import {
  crewCanUseContracts,
  crewContractMark,
  crewFullName,
  crewPhoneHref,
  NO_DEPARTMENT_TITLE,
  type CrewDepartment,
  type CrewRights,
  type CrewRow,
} from "@/features/crew/lib/crew-rules";
import { formatDateShort } from "@/shared/i18n/format-date";
import { statusBadgeStyle } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { toast, useActionToast } from "@/shared/ui/toast";
import { snapshotFields } from "@/shared/ui/unsaved/snapshot";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";

const initial: CrewActionState = {};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-[var(--muted-fg)]">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm">{children || "—"}</dd>
    </div>
  );
}

function ContractsBlock({
  projectId,
  locale,
  member,
}: {
  projectId: string;
  locale: string;
  member: CrewRow;
}) {
  if (member.contracts === undefined) {
    return member.source === "CONTRACT" ? (
      <p className="text-sm text-[var(--muted-fg)]">Из договора</p>
    ) : null;
  }
  const mark = crewContractMark(member);
  const markNote = mark ? (
    <p className="text-sm font-semibold text-[var(--danger)]">
      {mark === "deleted" ? "Договор удалён" : "Договор отклонён"}. Запись остаётся в команде.
    </p>
  ) : null;
  if (member.contracts.length === 0) return markNote;
  return (
    <div className="space-y-1">
      {markNote}
      <div className="text-xs font-semibold text-[var(--muted-fg)]">Договоры</div>
      <ul className="space-y-1 text-sm">
        {member.contracts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            <Link
              href={`/${locale}/projects/${projectId}/counterparties/contracts/${c.id}`}
              className="text-[var(--accent)] hover:underline"
            >
              № {c.number}
            </Link>
            <span className="text-[var(--muted-fg)]">от {formatDateShort(c.date)}</span>
            <span className="status-badge" style={statusBadgeStyle(c.statusColor)}>
              {c.statusName}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadOnlyCard({
  projectId,
  locale,
  member,
  rights,
}: {
  projectId: string;
  locale: string;
  member: CrewRow;
  rights: CrewRights;
}) {
  const tel = crewPhoneHref(member.phone);
  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="Должность">{member.position}</Field>
        <Field label="Цех">{member.departmentName ?? NO_DEPARTMENT_TITLE}</Field>
        {rights.contacts ? (
          <>
            <Field label="Телефон">
              {tel ? <a href={tel}>{member.phone}</a> : member.phone}
            </Field>
            <Field label="Почта">
              {member.email ? <a href={`mailto:${member.email}`}>{member.email}</a> : null}
            </Field>
          </>
        ) : null}
        <Field label="Заметка">{member.note}</Field>
      </dl>
      <ContractsBlock projectId={projectId} locale={locale} member={member} />
    </div>
  );
}

function FormFields({
  member,
  departments,
  rights,
}: {
  member?: CrewRow;
  departments: CrewDepartment[];
  rights: CrewRights;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="crew-lastName">Фамилия *</Label>
        <Input id="crew-lastName" name="lastName" required defaultValue={member?.lastName} />
      </div>
      <div>
        <Label htmlFor="crew-firstName">Имя</Label>
        <Input id="crew-firstName" name="firstName" defaultValue={member?.firstName ?? ""} />
      </div>
      <div>
        <Label htmlFor="crew-middleName">Отчество</Label>
        <Input id="crew-middleName" name="middleName" defaultValue={member?.middleName ?? ""} />
      </div>
      <div>
        <Label htmlFor="crew-position">Должность</Label>
        <Input id="crew-position" name="position" defaultValue={member?.position ?? ""} />
      </div>
      <div>
        <Label htmlFor="crew-department">Цех</Label>
        <Select id="crew-department" name="departmentId" defaultValue={member?.departmentId ?? ""}>
          <option value="">{NO_DEPARTMENT_TITLE}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>
      {rights.contacts ? (
        <>
          <div>
            <Label htmlFor="crew-phone">Телефон</Label>
            <Input id="crew-phone" name="phone" type="tel" defaultValue={member?.phone ?? ""} />
          </div>
          <div>
            <Label htmlFor="crew-email">Почта</Label>
            <Input id="crew-email" name="email" type="email" defaultValue={member?.email ?? ""} />
          </div>
        </>
      ) : null}
      <div className="sm:col-span-2">
        <Label htmlFor="crew-note">Заметка</Label>
        <textarea
          id="crew-note"
          name="note"
          rows={3}
          defaultValue={member?.note ?? ""}
          className="glass-input w-full rounded-lg px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}

/** Карточка человека: без права правки — только просмотр; `member` не задан — новый человек. */
export function CrewMemberModal({
  projectId,
  locale,
  member,
  departments,
  rights,
  open,
  onClose,
  onLink,
  onSync,
}: {
  projectId: string;
  locale: string;
  member?: CrewRow;
  departments: CrewDepartment[];
  rights: CrewRights;
  open: boolean;
  onClose: () => void;
  /** «Связать с договором» и «Обновить из договора»: окна открывает список, поверх карточки. */
  onLink?: () => void;
  onSync?: () => void;
}) {
  const bound = member
    ? updateCrewMemberAction.bind(null, projectId, member.id)
    : createCrewMemberAction.bind(null, projectId);
  const [state, action, pending] = useSafeActionState(bound, initial);
  const [archivePending, startArchive] = useTransition();
  useActionToast(state);
  useActionSuccess(state, onClose);

  // «Обновить из договора» закрывает карточку: при несохранённых правках оно недоступно.
  const formRef = useRef<HTMLFormElement>(null);
  const savedFields = useRef("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (open && formRef.current) savedFields.current = snapshotFields(formRef.current);
  }, [open]);

  function checkDirty() {
    if (formRef.current) setDirty(snapshotFields(formRef.current) !== savedFields.current);
  }

  function toggleArchive() {
    if (!member) return;
    startArchive(async () => {
      const result = member.archived
        ? await restoreCrewMemberAction(projectId, member.id)
        : await archiveCrewMemberAction(projectId, member.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      onClose();
    });
  }

  const title = member ? crewFullName(member) : "Новый человек";

  if (!rights.write) {
    return (
      <Modal open={open} onClose={onClose} title={title} wide>
        {member ? (
          <ReadOnlyCard projectId={projectId} locale={locale} member={member} rights={rights} />
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal
      guardUnsaved
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form="crew-form" disabled={pending || archivePending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel>
            Отмена
          </Button>
          {member ? (
            <Button
              type="button"
              variant="secondary"
              className="ml-auto"
              disabled={pending || archivePending}
              onClick={toggleArchive}
            >
              {member.archived ? "Вернуть из архива" : "В архив"}
            </Button>
          ) : null}
        </div>
      }
    >
      <form
        ref={formRef}
        id="crew-form"
        onSubmit={submitKeepingFields(action)}
        onChange={checkDirty}
        className="space-y-4"
      >
        <FormFields member={member} departments={departments} rights={rights} />
        {member ? (
          <ContractsBlock projectId={projectId} locale={locale} member={member} />
        ) : null}
        {member && crewCanUseContracts(rights) ? (
          <div className="flex flex-wrap items-center gap-2">
            {member.contracts?.length ? (
              <Button type="button" variant="secondary" disabled={dirty} onClick={onSync}>
                Обновить из договора
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onLink}>
              Связать с договором
            </Button>
            {dirty && member.contracts?.length ? (
              <p className="w-full text-xs text-[var(--muted-fg)]">
                Чтобы обновить из договора, сначала сохраните или отмените правки
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
