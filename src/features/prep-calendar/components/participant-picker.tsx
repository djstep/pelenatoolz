"use client";

import { useMemo, useState } from "react";
import type {
  CalendarOption,
  CalendarParticipant,
  CalendarParticipantKind,
} from "@/features/prep-calendar/lib/calendar-types";
import { countOf } from "@/shared/lib/plural";
import { AutocompleteInput, type AutocompleteOption } from "@/shared/ui/autocomplete-input";
import { Label } from "@/shared/ui/label";

const KIND_LABELS: Record<CalendarParticipantKind, string> = {
  crew: "Команда",
  actor: "Актёр",
  candidate: "Кандидат",
};

/** Сколько вариантов показывать сразу: длинный список всё равно ищут поиском. */
const MAX_OPTIONS = 30;

export type ParticipantSources = {
  crew: CalendarOption[] | null;
  actors: CalendarOption[] | null;
  candidates: CalendarOption[] | null;
};

function normalize(text: string) {
  return text.toLocaleLowerCase("ru").replace(/ё/g, "е");
}

/** Все варианты, которые этот человек вправе выбирать. */
function allOptions(sources: ParticipantSources) {
  const pick = (kind: CalendarParticipantKind, list: CalendarOption[] | null) =>
    (list ?? []).map((option) => ({ ...option, kind }));
  return [
    ...pick("crew", sources.crew),
    ...pick("actor", sources.actors),
    ...pick("candidate", sources.candidates),
  ];
}

/**
 * Участники события: поиск по команде, актёрам и кандидатам, выбранные — списком с крестиком.
 * Вид, на который нет права, только показывается: его варианты сюда не приходят, а сервер
 * сохранит таких участников как есть.
 */
export function ParticipantPicker({
  sources,
  selected,
  hiddenCandidates,
  onChange,
}: {
  sources: ParticipantSources;
  selected: CalendarParticipant[];
  hiddenCandidates: number;
  onChange: (next: CalendarParticipant[]) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => allOptions(sources), [sources]);
  const editable: Record<CalendarParticipantKind, boolean> = {
    crew: sources.crew !== null,
    actor: sources.actors !== null,
    candidate: sources.candidates !== null,
  };

  const found: AutocompleteOption[] = useMemo(() => {
    const chosen = new Set(selected.map((person) => `${person.kind}:${person.id}`));
    const q = normalize(query.trim());
    return options
      .filter((option) => !chosen.has(`${option.kind}:${option.id}`))
      .filter((option) => normalize(`${option.label} ${option.hint ?? ""}`).includes(q))
      .slice(0, MAX_OPTIONS)
      .map((option) => ({
        value: `${option.kind}:${option.id}`,
        label: option.label,
        hint: [KIND_LABELS[option.kind], option.hint].filter(Boolean).join(" · "),
      }));
  }, [options, query, selected]);

  function add(option: AutocompleteOption) {
    const found = options.find((item) => `${item.kind}:${item.id}` === option.value);
    if (found) {
      onChange([...selected, { kind: found.kind, id: found.id, label: found.label }]);
    }
    setQuery("");
  }

  return (
    <div>
      <Label htmlFor="event-participant-search">Участники</Label>
      {options.length > 0 ? (
        // Поиск — не данные формы: иначе введённый текст считался бы несохранённой правкой.
        <div data-unsaved-ignore>
          <AutocompleteInput
            id="event-participant-search"
            name="participantSearch"
            value={query}
            minChars={0}
            placeholder="Найти человека: команда, актёры, кандидаты"
            emptyText="Никого не нашли"
            options={found}
            onQueryChange={setQuery}
            onSelect={add}
          />
        </div>
      ) : (
        <p className="text-xs text-[var(--muted-fg)]">Нет людей, которых можно выбрать.</p>
      )}
      {selected.length > 0 || hiddenCandidates > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((person) => (
            <li
              key={`${person.kind}:${person.id}`}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs"
            >
              <input type="hidden" name="participant" value={`${person.kind}:${person.id}`} />
              <span className="truncate">{person.label}</span>
              <span className="text-[var(--muted-fg)]">{KIND_LABELS[person.kind]}</span>
              {editable[person.kind] ? (
                <button
                  type="button"
                  aria-label={`Убрать: ${person.label}`}
                  className="ml-0.5 text-[var(--muted-fg)] hover:text-[var(--foreground)]"
                  onClick={() =>
                    onChange(
                      selected.filter(
                        (item) => !(item.kind === person.kind && item.id === person.id),
                      ),
                    )
                  }
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
          {hiddenCandidates > 0 ? (
            <li className="inline-flex items-center rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-fg)]">
              +{countOf(hiddenCandidates, ["кандидат", "кандидата", "кандидатов"])}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
