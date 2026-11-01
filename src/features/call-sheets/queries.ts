import "server-only";

import { MembershipStatus } from "@prisma/client";
import type { TemplateForCopy } from "@/features/call-sheets/lib/template-rules";
import { memberLabel } from "@/features/departments/queries";
import { CALL_SHEET_SCHEME_LOCATION_SELECT } from "@/features/locations/lib/location-fields";
import { prisma } from "@/shared/db/prisma";

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;
/** Транзакция базы. */
export type Tx = TransactionCallback extends (client: infer T) => Promise<unknown> ? T : never;
/** Клиент базы или транзакция. */
type Db = Pick<
  Tx,
  "callSheetTemplateLeader" | "callSheetTemplateCrewCall" | "callSheetTemplateBaseItem"
>;

export type TemplateEditorData = {
  leaders: {
    position: string;
    shortTitle: string;
    membershipId: string;
    personName: string;
    phone: string;
    /** Участник строки вышел из проекта — его имя для пометки; иначе null. Не сохраняется. */
    leftMemberName?: string | null;
  }[];
  crewCalls: { departmentId: string; label: string; callTime: string }[];
  baseItems: { name: string; callTime: string; notNeeded: boolean }[];
};

/** Шаблон для экрана настроек: строки по порядку, пустые поля — пустые строки. */
export async function getCallSheetTemplate(projectId: string): Promise<TemplateEditorData> {
  const [leaders, crewCalls, baseItems] = await Promise.all([
    prisma.callSheetTemplateLeader.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { membership: { select: { status: true, user: { select: { name: true } } } } },
    }),
    prisma.callSheetTemplateCrewCall.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.callSheetTemplateBaseItem.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return {
    leaders: leaders.map((row) => ({
      position: row.position,
      shortTitle: row.shortTitle ?? "",
      membershipId: row.membershipId ?? "",
      personName: row.personName ?? "",
      phone: row.phone ?? "",
      leftMemberName:
        row.membership && row.membership.status !== MembershipStatus.ACTIVE
          ? memberLabel({ name: row.membership.user.name, email: null })
          : null,
    })),
    crewCalls: crewCalls.map((row) => ({
      departmentId: row.departmentId ?? "",
      label: row.label ?? "",
      callTime: row.callTime ?? "",
    })),
    baseItems: baseItems.map((row) => ({
      name: row.name,
      callTime: row.callTime ?? "",
      notNeeded: row.notNeeded,
    })),
  };
}

export type TemplateMemberOption = {
  membershipId: string;
  label: string;
  roleName: string;
  hasPhone: boolean;
};

/** Кого можно выбрать руководителем: активные участники проекта. */
export async function listTemplateMemberOptions(
  projectId: string,
): Promise<TemplateMemberOption[]> {
  const rows = await prisma.projectMembership.findMany({
    where: { projectId, status: MembershipStatus.ACTIVE },
    select: {
      id: true,
      user: { select: { name: true, email: true, phone: true } },
      role: { select: { name: true } },
    },
  });
  return rows
    .map((row) => ({
      membershipId: row.id,
      label: memberLabel(row.user),
      roleName: row.role.name,
      hasPhone: Boolean(row.user.phone?.trim()),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

/** Шаблон с текущими ФИ и телефонами участников и названиями цехов — для копии в вызывной. */
export async function loadTemplateForCopy(
  db: Db,
  projectId: string,
): Promise<TemplateForCopy> {
  const [leaders, crewCalls, baseItems] = await Promise.all([
    db.callSheetTemplateLeader.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        position: true,
        shortTitle: true,
        membershipId: true,
        personName: true,
        phone: true,
        membership: {
          select: {
            projectId: true,
            status: true,
            user: { select: { name: true, phone: true } },
          },
        },
      },
    }),
    db.callSheetTemplateCrewCall.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        departmentId: true,
        label: true,
        callTime: true,
        department: { select: { name: true, projectId: true } },
      },
    }),
    db.callSheetTemplateBaseItem.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { name: true, callTime: true, notNeeded: true },
    }),
  ]);
  return {
    leaders: leaders.map((row) => {
      const m = row.membership;
      const active = m && m.projectId === projectId && m.status === MembershipStatus.ACTIVE;
      return {
        position: row.position,
        shortTitle: row.shortTitle,
        membershipId: row.membershipId,
        personName: row.personName,
        phone: row.phone,
        member: active ? { name: m.user.name, phone: m.user.phone } : null,
      };
    }),
    crewCalls: crewCalls.map((row) => ({
      departmentId: row.department?.projectId === projectId ? row.departmentId : null,
      label: row.label,
      departmentName:
        row.department?.projectId === projectId ? row.department.name : null,
      callTime: row.callTime,
    })),
    baseItems,
  };
}

export type CallSheetBlocks = {
  id: string;
  templateAppliedAt: Date;
  tempDay: string | null;
  tempNight: string | null;
  importantNote: string | null;
  actorRestrictions: string | null;
  schemeLocationId: string | null;
  schemeLocation: {
    id: string;
    name: string;
    sublocation: string | null;
    latitude: number | null;
    longitude: number | null;
    /** Для листа схемы объекта. */
    address: string | null;
    directions: string | null;
    parking: string | null;
    onSiteNotes: string | null;
    points: { number: string; name: string; description: string | null }[];
  } | null;
  leaders: {
    id: string;
    position: string;
    shortTitle: string | null;
    membershipId: string | null;
    personName: string | null;
    phone: string | null;
  }[];
  crewCalls: { id: string; departmentId: string | null; label: string; callTime: string | null }[];
  baseItems: { id: string; name: string; callTime: string | null; notNeeded: boolean }[];
};

/** Вызывной дня (если создан) с блоками из шаблона и полями листа. Только чтение. */
export async function getCallSheetForDay(
  projectId: string,
  shootDayId: string,
): Promise<CallSheetBlocks | null> {
  return prisma.callSheet.findFirst({
    where: { projectId, shootDayId },
    select: {
      id: true,
      templateAppliedAt: true,
      tempDay: true,
      tempNight: true,
      importantNote: true,
      actorRestrictions: true,
      schemeLocationId: true,
      schemeLocation: {
        // Только открытые поля объекта (ставки объекта в вызывной не идут).
        select: {
          ...CALL_SHEET_SCHEME_LOCATION_SELECT,
          points: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { number: true, name: true, description: true },
          },
        },
      },
      leaders: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          position: true,
          shortTitle: true,
          membershipId: true,
          personName: true,
          phone: true,
        },
      },
      crewCalls: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, departmentId: true, label: true, callTime: true },
      },
      baseItems: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, callTime: true, notNeeded: true },
      },
    },
  });
}

export type CallSheetStatusData = {
  status: "DRAFT" | "IN_REVIEW" | "APPROVED";
  version: number;
  revision: number;
  approvedAt: Date | null;
  approvedByName: string | null;
  /** Утверждённые версии, новые сверху; снимки не загружаются. */
  versions: {
    version: number;
    approvedAt: Date;
    approvedByName: string | null;
    modelHash: string;
  }[];
};

/** Статус, версия, номер правки и утверждённые версии вызывного дня. Только чтение. */
export async function getCallSheetStatus(
  projectId: string,
  shootDayId: string,
): Promise<CallSheetStatusData | null> {
  const row = await prisma.callSheet.findFirst({
    where: { projectId, shootDayId },
    select: {
      status: true,
      version: true,
      revision: true,
      approvedAt: true,
      approvedBy: { select: { name: true, email: true } },
      approvedVersions: {
        orderBy: { version: "desc" },
        select: {
          version: true,
          approvedAt: true,
          modelHash: true,
          approvedBy: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    status: row.status,
    version: row.version,
    revision: row.revision,
    approvedAt: row.approvedAt,
    approvedByName: row.approvedBy ? memberLabel(row.approvedBy) : null,
    versions: row.approvedVersions.map((v) => ({
      version: v.version,
      approvedAt: v.approvedAt,
      approvedByName: v.approvedBy ? memberLabel(v.approvedBy) : null,
      modelHash: v.modelHash,
    })),
  };
}
