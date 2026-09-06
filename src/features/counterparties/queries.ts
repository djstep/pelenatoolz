import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";

export type CompanyListItem = {
  id: string;
  name: string;
  requisites: string | null;
  inn: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
};

export type CounterpartyListItem = {
  id: string;
  name: string;
  type: import("@prisma/client").CounterpartyType;
  contacts: string | null;
  inn: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
};

export async function listCompanies(projectId: string): Promise<CompanyListItem[]> {
  const rows = await prisma.company.findMany({
    where: { projectId },
    include: { _count: { select: { financeOps: true } } },
    orderBy: { name: "asc" },
  });

  const mapped = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      requisites: r.requisites,
      inn: r.inn,
      notes: r.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      usageCount: r._count.financeOps,
    }))
    .sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name, "ru");
    });

  return serializeForClient(mapped) as CompanyListItem[];
}

export async function listCounterparties(
  projectId: string,
): Promise<CounterpartyListItem[]> {
  const rows = await prisma.counterparty.findMany({
    where: { projectId },
    include: { _count: { select: { financeOps: true } } },
    orderBy: { name: "asc" },
  });

  const mapped = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      contacts: r.contacts,
      inn: r.inn,
      notes: r.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      usageCount: r._count.financeOps,
    }))
    .sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name, "ru");
    });

  return serializeForClient(mapped) as CounterpartyListItem[];
}

/** Options for finance pickers — already sorted by usage frequency. */
export async function listCompanyOptions(projectId: string) {
  const rows = await listCompanies(projectId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    usageCount: r.usageCount,
  }));
}

export async function listCounterpartyOptions(projectId: string) {
  const rows = await listCounterparties(projectId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    usageCount: r.usageCount,
    type: r.type,
  }));
}
