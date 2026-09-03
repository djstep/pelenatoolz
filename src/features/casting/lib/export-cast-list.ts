import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
} from "docx";
import type { CastListExportBundle } from "@/features/casting/lib/cast-list-export-data";
import {
  candidateAgeYears,
  formatPhysicalParams,
} from "@/features/casting/lib/cast-list-export-data";
import type {
  CastListActorFieldId,
  CastListCandidateExportConfig,
  CastListCharacterFieldId,
  CastListExportTapeItem,
  CastListSort,
} from "@/features/casting/lib/cast-list-export-fields";
import {
  CAST_LIST_ACTOR_FIELDS,
  CAST_LIST_CHARACTER_FIELDS,
} from "@/features/casting/lib/cast-list-export-fields";
import { castingStatusLabels } from "@/features/preproduction/lib/status-labels";
import { formatDateShort } from "@/shared/i18n/format-date";

function appBaseUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function personUrl(
  locale: string,
  projectId: string,
  personId: string,
) {
  return `${appBaseUrl()}/${locale}/projects/${projectId}/preproduction/casting/${personId}`;
}

function auditionUrl(
  locale: string,
  projectId: string,
  auditionId: string,
) {
  return `${appBaseUrl()}/${locale}/projects/${projectId}/preproduction/auditions/${auditionId}`;
}

async function fetchImageBytes(
  url: string | null | undefined,
): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const abs =
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `${appBaseUrl()}${url}`;
    const res = await fetch(abs);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function sortCandidates(
  candidates: CastListExportBundle["candidates"],
  sort: CastListSort,
) {
  const copy = [...candidates];
  const statusOrder = Object.keys(castingStatusLabels);
  copy.sort((a, b) => {
    switch (sort) {
      case "nameDesc":
        return b.person.label.localeCompare(a.person.label, "ru");
      case "ratingDesc":
        return (b.rating ?? -1) - (a.rating ?? -1);
      case "status":
        return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
      case "createdAt":
        return a.createdAt.getTime() - b.createdAt.getTime();
      case "nameAsc":
      default:
        return a.person.label.localeCompare(b.person.label, "ru");
    }
  });
  return copy;
}

function characterFieldLabel(id: CastListCharacterFieldId) {
  return CAST_LIST_CHARACTER_FIELDS.find((f) => f.id === id)?.label ?? id;
}

function actorFieldLabel(id: CastListActorFieldId) {
  return CAST_LIST_ACTOR_FIELDS.find((f) => f.id === id)?.label ?? id;
}

function actorFieldValue(
  field: CastListActorFieldId,
  candidate: CastListExportBundle["candidates"][number],
): string | null {
  const p = candidate.person;
  switch (field) {
    case "photo":
    case "fullName":
      return null;
    case "age": {
      const age = candidateAgeYears(p.birthDate);
      return age != null ? String(age) : null;
    }
    case "education":
      return p.education;
    case "filmography":
      return p.filmography;
    case "physicalParams": {
      const text = formatPhysicalParams(p.physicalParams);
      return text || null;
    }
    case "skills":
      return p.skills.length ? p.skills.join(", ") : null;
    case "phone":
      return p.phone;
    case "email":
      return p.email;
    case "agent": {
      const parts = [p.agentName, p.agentPhone, p.agentEmail].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    case "status":
      return candidate.statusLabel;
    case "rating":
      return candidate.rating != null ? String(candidate.rating) : null;
    case "notes":
      return candidate.notes || p.notes;
    default:
      return null;
  }
}

export type BuildCastListArgs = {
  bundle: CastListExportBundle;
  characterFieldIds: CastListCharacterFieldId[];
  actorFieldIds: CastListActorFieldId[];
  sort: CastListSort;
  candidateConfigs: CastListCandidateExportConfig[];
};

function resolveComments(
  candidate: CastListExportBundle["candidates"][number],
  cfg: CastListCandidateExportConfig | undefined,
) {
  if (!cfg || !cfg.commentsManual) return candidate.comments;
  const set = new Set(cfg.commentIds ?? []);
  return candidate.comments.filter((c) => set.has(c.id));
}

function resolveTapes(
  cfg: CastListCandidateExportConfig | undefined,
): CastListExportTapeItem[] {
  return cfg?.tapes ?? [];
}

export async function buildCastListDocx(args: BuildCastListArgs): Promise<Buffer> {
  const { bundle, characterFieldIds, actorFieldIds, sort, candidateConfigs } =
    args;
  const cfgById = new Map(candidateConfigs.map((c) => [c.candidateId, c]));
  const sorted = sortCandidates(bundle.candidates, sort);
  const projectName = bundle.project.fullName || bundle.project.name;
  const body: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `Каст-лист — ${projectName}`,
          bold: true,
          size: 28,
        }),
      ],
    }),
  ];

  for (const fieldId of characterFieldIds) {
    let value: string | null = null;
    if (fieldId === "name") value = bundle.character.name;
    else if (fieldId === "description") value = bundle.character.description;
    else if (fieldId === "roleRequirements")
      value = bundle.character.roleRequirements;
    else if (fieldId === "roleType") value = bundle.character.roleTypeLabel;

    if (!value) continue;
    body.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: `${characterFieldLabel(fieldId)}: `,
            bold: true,
            size: 20,
          }),
          new TextRun({ text: value, size: 20 }),
        ],
      }),
    );
  }

  for (const candidate of sorted) {
    const cfg = cfgById.get(candidate.id);
    const photoUrl = cfg?.photoOverrideUrl || candidate.person.photoUrl;
    const personHref = personUrl(
      bundle.locale,
      bundle.project.id,
      candidate.person.id,
    );

    body.push(
      new Paragraph({
        spacing: { before: 280, after: 80 },
        children: [
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: candidate.person.label,
                bold: true,
                size: 24,
                color: "0563C1",
                underline: {},
              }),
            ],
            link: personHref,
          }),
        ],
      }),
    );

    if (actorFieldIds.includes("photo") && photoUrl) {
      const bytes = await fetchImageBytes(photoUrl);
      if (bytes) {
        body.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new ImageRun({
                type: "jpg",
                data: bytes,
                transformation: { width: 96, height: 96 },
              }),
            ],
          }),
        );
      }
    }

    for (const fieldId of actorFieldIds) {
      if (fieldId === "photo" || fieldId === "fullName") continue;
      const value = actorFieldValue(fieldId, candidate);
      if (!value) continue;
      body.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: `${actorFieldLabel(fieldId)}: `,
              bold: true,
              size: 18,
            }),
            new TextRun({ text: value, size: 18 }),
          ],
        }),
      );
    }

    const tapes = resolveTapes(cfg);
    if (tapes.length) {
      body.push(
        new Paragraph({
          spacing: { before: 100, after: 40 },
          children: [new TextRun({ text: "Пробы", bold: true, size: 18 })],
        }),
      );
      for (const tape of tapes) {
        if (tape.kind === "audition") {
          const aud = candidate.auditions.find((a) => a.id === tape.auditionId);
          const label = aud
            ? `${aud.kindLabel} · ${formatDateShort(aud.date)}${aud.time ? ` ${aud.time}` : ""}`
            : "Проба";
          const href = auditionUrl(
            bundle.locale,
            bundle.project.id,
            tape.auditionId,
          );
          body.push(
            new Paragraph({
              spacing: { after: 30 },
              children: [
                new ExternalHyperlink({
                  children: [
                    new TextRun({
                      text: label,
                      size: 18,
                      color: "0563C1",
                      underline: {},
                    }),
                  ],
                  link: href,
                }),
              ],
            }),
          );
        } else {
          const note = tape.note?.trim();
          body.push(
            new Paragraph({
              spacing: { after: 30 },
              children: [
                new ExternalHyperlink({
                  children: [
                    new TextRun({
                      text: note || tape.url,
                      size: 18,
                      color: "0563C1",
                      underline: {},
                    }),
                  ],
                  link: tape.url,
                }),
                ...(note
                  ? [new TextRun({ text: ` — ${tape.url}`, size: 16 })]
                  : []),
              ],
            }),
          );
        }
      }
    }

    const comments = resolveComments(candidate, cfg);
    if (comments.length) {
      body.push(
        new Paragraph({
          spacing: { before: 100, after: 40 },
          children: [
            new TextRun({ text: "Комментарии", bold: true, size: 18 }),
          ],
        }),
      );
      for (const cm of comments) {
        body.push(
          new Paragraph({
            spacing: { after: 30 },
            children: [
              new TextRun({
                text: `${cm.authorName}, ${formatDateShort(cm.createdAt)}: `,
                bold: true,
                size: 16,
              }),
              new TextRun({ text: cm.body, size: 16 }),
            ],
          }),
        );
      }
    }
  }

  const doc = new Document({ sections: [{ children: body }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

export function buildCastListPrintHtml(args: BuildCastListArgs): string {
  const { bundle, characterFieldIds, actorFieldIds, sort, candidateConfigs } =
    args;
  const cfgById = new Map(candidateConfigs.map((c) => [c.candidateId, c]));
  const sorted = sortCandidates(bundle.candidates, sort);
  const projectName = bundle.project.fullName || bundle.project.name;

  let html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Каст-лист — ${escapeHtml(projectName)}</title>
<style>
  body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:800px;margin:0 auto}
  h1{font-size:20px} h2{font-size:16px;margin:24px 0 8px}
  .meta{margin:4px 0;font-size:13px} .label{font-weight:600}
  .card{border:1px solid #ccc;border-radius:10px;padding:14px;margin:16px 0}
  img.photo{width:96px;height:96px;object-fit:cover;border-radius:8px}
  a{color:#0563C1} ul{margin:6px 0 0;padding-left:18px}
  @media print{.noprint{display:none}}
</style></head><body>
<button class="noprint" onclick="window.print()">Печать / PDF</button>
<h1>Каст-лист — ${escapeHtml(projectName)}</h1>`;

  for (const fieldId of characterFieldIds) {
    let value: string | null = null;
    if (fieldId === "name") value = bundle.character.name;
    else if (fieldId === "description") value = bundle.character.description;
    else if (fieldId === "roleRequirements")
      value = bundle.character.roleRequirements;
    else if (fieldId === "roleType") value = bundle.character.roleTypeLabel;
    if (!value) continue;
    html += `<div class="meta"><span class="label">${escapeHtml(characterFieldLabel(fieldId))}:</span> ${escapeHtml(value)}</div>`;
  }

  for (const candidate of sorted) {
    const cfg = cfgById.get(candidate.id);
    const photoUrl = cfg?.photoOverrideUrl || candidate.person.photoUrl;
    const personHref = personUrl(
      bundle.locale,
      bundle.project.id,
      candidate.person.id,
    );

    html += `<div class="card"><h2><a href="${escapeAttr(personHref)}">${escapeHtml(candidate.person.label)}</a></h2>`;

    if (actorFieldIds.includes("photo") && photoUrl) {
      html += `<p><img class="photo" src="${escapeAttr(photoUrl.startsWith("http") ? photoUrl : `${appBaseUrl()}${photoUrl}`)}" alt=""/></p>`;
    }

    for (const fieldId of actorFieldIds) {
      if (fieldId === "photo" || fieldId === "fullName") continue;
      const value = actorFieldValue(fieldId, candidate);
      if (!value) continue;
      html += `<div class="meta"><span class="label">${escapeHtml(actorFieldLabel(fieldId))}:</span> ${escapeHtml(value)}</div>`;
    }

    const tapes = resolveTapes(cfg);
    if (tapes.length) {
      html += `<p class="label">Пробы</p><ul>`;
      for (const tape of tapes) {
        if (tape.kind === "audition") {
          const aud = candidate.auditions.find((a) => a.id === tape.auditionId);
          const label = aud
            ? `${aud.kindLabel} · ${formatDateShort(aud.date)}${aud.time ? ` ${aud.time}` : ""}`
            : "Проба";
          const href = auditionUrl(
            bundle.locale,
            bundle.project.id,
            tape.auditionId,
          );
          html += `<li><a href="${escapeAttr(href)}">${escapeHtml(label)}</a></li>`;
        } else {
          const note = tape.note?.trim();
          html += `<li><a href="${escapeAttr(tape.url)}">${escapeHtml(note || tape.url)}</a>${note ? ` <span>${escapeHtml(tape.url)}</span>` : ""}</li>`;
        }
      }
      html += `</ul>`;
    }

    const comments = resolveComments(candidate, cfg);
    if (comments.length) {
      html += `<p class="label">Комментарии</p><ul>`;
      for (const cm of comments) {
        html += `<li><strong>${escapeHtml(cm.authorName)}, ${escapeHtml(formatDateShort(cm.createdAt))}:</strong> ${escapeHtml(cm.body)}</li>`;
      }
      html += `</ul>`;
    }

    html += `</div>`;
  }

  html += `</body></html>`;
  return html;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string) {
  return escapeHtml(s);
}
