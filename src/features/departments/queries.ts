import "server-only";

import { MembershipStatus } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";

/** Как показать участника: имя, иначе почта. */
export function memberLabel(user: { name: string | null; email: string | null }) {
  return user.name?.trim() || user.email || "Без имени";
}

export type DepartmentRow = {
  id: string;
  name: string;
  codePrefix: string;
  heads: { membershipId: string; label: string }[];
};

/** Цеха проекта по порядку, с главами. */
export async function listDepartments(projectId: string): Promise<DepartmentRow[]> {
  const rows = await prisma.department.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      codePrefix: true,
      heads: {
        orderBy: { createdAt: "asc" },
        select: {
          membershipId: true,
          membership: { select: { user: { select: { name: true, email: true } } } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    codePrefix: row.codePrefix,
    heads: row.heads.map((h) => ({
      membershipId: h.membershipId,
      label: memberLabel(h.membership.user),
    })),
  }));
}

export type HeadCandidate = { membershipId: string; label: string; roleName: string };

/** Кого можно назначить главой: только активные участники проекта. */
export async function listHeadCandidates(projectId: string): Promise<HeadCandidate[]> {
  const rows = await prisma.projectMembership.findMany({
    where: { projectId, status: MembershipStatus.ACTIVE },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      user: { select: { name: true, email: true } },
      role: { select: { name: true } },
    },
  });
  return rows
    .map((row) => ({
      membershipId: row.id,
      label: memberLabel(row.user),
      roleName: row.role.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

/** Подписи участников для аудита (кого назначили / сняли). */
export async function memberLabelsById(
  projectId: string,
  membershipIds: readonly string[],
): Promise<Map<string, string>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await prisma.projectMembership.findMany({
    where: { projectId, id: { in: [...membershipIds] } },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  return new Map(rows.map((row) => [row.id, memberLabel(row.user)]));
}

/** Цеха, видимые в разделе «Сметы»: все или только перечисленные. */
export async function listDepartmentsForSmeta(
  projectId: string,
  onlyIds: readonly string[] | null,
) {
  return prisma.department.findMany({
    where: {
      projectId,
      ...(onlyIds ? { id: { in: [...onlyIds] } } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, codePrefix: true },
  });
}
