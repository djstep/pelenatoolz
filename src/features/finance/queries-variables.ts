import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";
import {
  SYSTEM_FINANCE_VARIABLES,
  type SystemFinanceVariableKey,
} from "@/features/finance/lib/variables";

export type FinanceVariableRow = {
  id: string | null;
  key: string;
  label: string;
  value: number;
  isSystem: boolean;
  sortOrder: number;
  notes: string | null;
  /** True when value comes from Project.* and has not been overridden yet */
  fromProjectDefault: boolean;
  projectDefault: number | null;
  description?: string;
};

export async function listFinanceVariables(
  projectId: string,
): Promise<FinanceVariableRow[]> {
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: {
      episodeCount: true,
      shootingDaysCount: true,
    },
  });
  if (!project) return [];

  const rows = await prisma.projectFinanceVariable.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  const byKey = new Map(rows.map((r) => [r.key, r]));

  const system: FinanceVariableRow[] = SYSTEM_FINANCE_VARIABLES.map((def) => {
    const stored = byKey.get(def.key);
    const projectDefault =
      def.projectField === "shootingDaysCount"
        ? project.shootingDaysCount
        : project.episodeCount;
    if (stored) {
      return {
        id: stored.id,
        key: stored.key,
        label: stored.label,
        value: Number(stored.value),
        isSystem: true,
        sortOrder: stored.sortOrder,
        notes: stored.notes,
        fromProjectDefault: false,
        projectDefault: projectDefault ?? null,
        description: def.description,
      };
    }
    return {
      id: null,
      key: def.key,
      label: def.label,
      value: projectDefault ?? 0,
      isSystem: true,
      sortOrder: def.sortOrder,
      notes: null,
      fromProjectDefault: true,
      projectDefault: projectDefault ?? null,
      description: def.description,
    };
  });

  const custom: FinanceVariableRow[] = rows
    .filter((r) => !r.isSystem)
    .map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      value: Number(r.value),
      isSystem: false,
      sortOrder: r.sortOrder,
      notes: r.notes,
      fromProjectDefault: false,
      projectDefault: null,
    }));

  const merged = [...system, ...custom].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "ru"),
  );

  return serializeForClient(merged) as FinanceVariableRow[];
}

/** Resolved map key → number for budget qty defaults. */
export async function getFinanceVariableMap(
  projectId: string,
): Promise<Record<string, number>> {
  const list = await listFinanceVariables(projectId);
  const map: Record<string, number> = {};
  for (const v of list) map[v.key] = v.value;
  return map;
}

export async function resolveFinanceVariableValue(
  projectId: string,
  key: string | null | undefined,
): Promise<number | null> {
  if (!key) return null;
  const map = await getFinanceVariableMap(projectId);
  return map[key] ?? null;
}

export function systemKeyFromLabel(
  key: SystemFinanceVariableKey,
): (typeof SYSTEM_FINANCE_VARIABLES)[number] {
  return SYSTEM_FINANCE_VARIABLES.find((v) => v.key === key)!;
}
