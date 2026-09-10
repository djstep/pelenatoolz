import { DEFAULT_LEDGER_TYPES } from "@/features/contracts/lib/vat";
import { ensureApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";

export async function ensureLedgerTypes(projectId: string) {
  const count = await prisma.projectLedgerType.count({ where: { projectId } });
  if (count > 0) return;
  await prisma.projectLedgerType.createMany({
    data: DEFAULT_LEDGER_TYPES.map((t) => ({
      projectId,
      name: t.name,
      isSystem: true,
      sortOrder: t.sortOrder,
    })),
    skipDuplicates: true,
  });
}

export async function listLedgerTypes(projectId: string) {
  await ensureLedgerTypes(projectId);
  return prisma.projectLedgerType.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

const contractListInclude = {
  company: { select: { id: true, name: true } },
  counterparty: { select: { id: true, name: true } },
  ledgerType: { select: { id: true, name: true } },
  status: { select: { id: true, name: true, color: true, key: true } },
  files: {
    select: {
      id: true,
      role: true,
      file: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          url: true,
          sizeBytes: true,
        },
      },
    },
  },
  _count: { select: { certificates: true, cashPayments: true, accruals: true } },
} as const;

export async function listContracts(projectId: string) {
  await Promise.all([
    ensureApprovalStatuses(projectId),
    ensureLedgerTypes(projectId),
  ]);
  const rows = await prisma.contract.findMany({
    where: { projectId },
    include: contractListInclude,
    orderBy: [{ date: "desc" }, { number: "asc" }],
  });
  return serializeForClient(rows);
}

export type ContractListItem = Awaited<ReturnType<typeof listContracts>>[number];

export async function getContract(projectId: string, contractId: string) {
  await ensureApprovalStatuses(projectId);
  const row = await prisma.contract.findFirst({
    where: { id: contractId, projectId },
    include: {
      ...contractListInclude,
      certificates: {
        include: {
          status: { select: { id: true, name: true, color: true } },
          payment: {
            select: { id: true, date: true, amountWithTax: true, comment: true },
          },
          files: { select: { id: true } },
        },
        orderBy: { date: "desc" },
      },
      cashPayments: {
        select: {
          id: true,
          date: true,
          amount: true,
          amountWithTax: true,
          comment: true,
        },
        orderBy: { date: "desc" },
      },
      accruals: {
        select: {
          id: true,
          date: true,
          amount: true,
          amountWithTax: true,
          comment: true,
        },
        orderBy: { date: "desc" },
      },
    },
  });
  return row ? serializeForClient(row) : null;
}

const certificateListInclude = {
  company: { select: { id: true, name: true } },
  counterparty: { select: { id: true, name: true } },
  contract: { select: { id: true, number: true, date: true } },
  payment: {
    select: {
      id: true,
      date: true,
      amount: true,
      amountWithTax: true,
      comment: true,
    },
  },
  status: { select: { id: true, name: true, color: true, key: true } },
  files: {
    select: {
      id: true,
      role: true,
      file: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          url: true,
          sizeBytes: true,
        },
      },
    },
  },
} as const;

export async function listCertificates(projectId: string) {
  await ensureApprovalStatuses(projectId);
  const rows = await prisma.certificate.findMany({
    where: { projectId },
    include: certificateListInclude,
    orderBy: [{ date: "desc" }, { number: "asc" }],
  });
  return serializeForClient(rows);
}

/** @deprecated use listCertificates */
export const listActs = listCertificates;

export type CertificateListItem = Awaited<
  ReturnType<typeof listCertificates>
>[number];
export type ActListItem = CertificateListItem;

export async function getCertificate(projectId: string, certificateId: string) {
  const row = await prisma.certificate.findFirst({
    where: { id: certificateId, projectId },
    include: certificateListInclude,
  });
  return row ? serializeForClient(row) : null;
}

/** @deprecated use getCertificate */
export async function getAct(projectId: string, actId: string) {
  return getCertificate(projectId, actId);
}

export async function listPaymentsForCertificateForm(
  projectId: string,
  opts: {
    companyId?: string;
    counterpartyId?: string;
    contractId?: string;
  } = {},
) {
  const rows = await prisma.cashPayment.findMany({
    where: {
      projectId,
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
      ...(opts.counterpartyId ? { counterpartyId: opts.counterpartyId } : {}),
      ...(opts.contractId ? { contractId: opts.contractId } : {}),
    },
    select: {
      id: true,
      date: true,
      amount: true,
      amountWithTax: true,
      comment: true,
      companyId: true,
      counterpartyId: true,
      contractId: true,
    },
    orderBy: { date: "desc" },
    take: 200,
  });
  return serializeForClient(rows);
}

export async function listCertificatesForPayment(
  projectId: string,
  paymentId: string,
) {
  const rows = await prisma.certificate.findMany({
    where: { projectId, paymentId },
    include: {
      status: { select: { id: true, name: true, color: true } },
      contract: { select: { id: true, number: true } },
      files: { select: { id: true } },
    },
    orderBy: { date: "desc" },
  });
  return serializeForClient(rows);
}

export async function listContractTags(projectId: string) {
  const rows = await prisma.contract.findMany({
    where: { projectId },
    select: { tags: true },
  });
  const set = new Set<string>();
  for (const r of rows) for (const t of r.tags) set.add(t);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
}

export async function listContractsForCounterparty(
  projectId: string,
  counterpartyId: string,
) {
  const rows = await prisma.contract.findMany({
    where: { projectId, counterpartyId },
    include: {
      status: { select: { id: true, name: true, color: true } },
      company: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
    take: 50,
  });
  return serializeForClient(rows);
}

export async function listActsForCounterparty(
  projectId: string,
  counterpartyId: string,
) {
  const rows = await prisma.certificate.findMany({
    where: { projectId, counterpartyId },
    include: {
      status: { select: { id: true, name: true, color: true } },
      contract: { select: { id: true, number: true } },
      files: { select: { id: true } },
    },
    orderBy: { date: "desc" },
    take: 50,
  });
  return serializeForClient(rows);
}
