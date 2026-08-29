"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ProjectType } from "@prisma/client";
import { manualRenumberScenesAction } from "@/features/script/actions";
import type { LibrettoScene } from "@/features/script/lib/libretto-display";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Modal } from "@/shared/ui/modal";

type Row = {
  id: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  locationLabel: string;
  characters: string;
};

export function LibrettoRenumberModal({
  open,
  onClose,
  projectId,
  projectType,
  scenes,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectType: ProjectType;
  scenes: LibrettoScene[];
}) {
  const episodes = useMemo(() => {
    const set = new Set(scenes.map((s) => s.episodeNumber));
    return Array.from(set).sort((a, b) => a - b);
  }, [scenes]);

  const [activeEp, setActiveEp] = useState(episodes[0] ?? 0);
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(
      scenes.map((s) => ({
        id: s.id,
        episodeNumber: s.episodeNumber,
        number: s.number,
        postfix: s.postfix,
        locationLabel:
          s.locations[0]?.location.sublocation
            ? `${s.locations[0].location.name}.${s.locations[0].location.sublocation}`
            : s.locations[0]?.location.name ?? "—",
        characters: s.characters.map((c) => c.character.name).join(", ") || "—",
      })),
    );
    setActiveEp(episodes[0] ?? 0);
  }, [open, scenes, episodes]);

  const visible = rows.filter((r) => r.episodeNumber === activeEp);

  function reset() {
    setRows(
      scenes.map((s) => ({
        id: s.id,
        episodeNumber: s.episodeNumber,
        number: s.number,
        postfix: s.postfix,
        locationLabel:
          s.locations[0]?.location.sublocation
            ? `${s.locations[0].location.name}.${s.locations[0].location.sublocation}`
            : s.locations[0]?.location.name ?? "—",
        characters: s.characters.map((c) => c.character.name).join(", ") || "—",
      })),
    );
  }

  function submit() {
    startTransition(async () => {
      const result = await manualRenumberScenesAction(
        projectId,
        JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            episodeNumber: r.episodeNumber,
            number: r.number,
            postfix: r.postfix,
          })),
        ),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Перенумерация сцен" wide>
      <div className="space-y-4">
        {projectType === "SERIES" && episodes.length > 1 ? (
          <div>
            <p className="mb-2 text-xs text-[var(--muted-fg)]">Быстрый переход к серии</p>
            <div className="flex flex-wrap gap-1">
              {episodes.map((ep) => (
                <Button
                  key={ep}
                  type="button"
                  variant={activeEp === ep ? "primary" : "secondary"}
                  className="min-w-9 px-2"
                  onClick={() => setActiveEp(ep)}
                >
                  {ep}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                {projectType === "SERIES" ? <th className="py-2 pr-2">Серия</th> : null}
                <th className="py-2 pr-2">Сцена</th>
                <th className="py-2 pr-2">Постфикс</th>
                <th className="py-2 pr-2">Локации</th>
                <th className="py-2">Персонажи</th>
              </tr>
            </thead>
            <tbody>
              {(projectType === "SERIES" ? visible : rows).map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]/60">
                  {projectType === "SERIES" ? (
                    <td className="py-2 pr-2">{row.episodeNumber}</td>
                  ) : null}
                  <td className="py-2 pr-2">
                    <Input
                      value={row.number}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((r) =>
                            r.id === row.id ? { ...r, number: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      value={row.postfix}
                      onChange={(e) =>
                        setRows((p) =>
                          p.map((r) =>
                            r.id === row.id ? { ...r, postfix: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="py-2 pr-2 text-[var(--muted-fg)]">{row.locationLabel}</td>
                  <td className="py-2 text-[var(--muted-fg)]">{row.characters}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? "…" : "Перенумеровать"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>Отмена</Button>
          <Button type="button" variant="ghost" onClick={reset}>Сбросить</Button>
        </div>
      </div>
    </Modal>
  );
}
