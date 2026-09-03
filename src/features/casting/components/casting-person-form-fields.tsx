"use client";

import { useState } from "react";
import {
  PHYSICAL_PARAM_LABELS,
  STANDARD_PHYSICAL_PARAM_KEYS,
} from "@/features/preproduction/lib/snapshots";
import { ImageUpload } from "@/shared/ui/image-upload";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

type PersonLike = {
  lastName: string;
  firstName?: string | null;
  middleName?: string | null;
  birthDate?: Date | string | null;
  education?: string | null;
  filmography?: string | null;
  phone?: string | null;
  email?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  photoUrl?: string | null;
  physicalParams?: unknown;
  skills?: string[];
  proposedRate?: { toString(): string } | null;
  proposedTerms?: string | null;
  notes?: string | null;
};

type CharacterOpt = { id: string; name: string };

export function PersonFormFields({
  projectId,
  person,
  characters,
  showCharacterPicker,
}: {
  projectId: string;
  person?: PersonLike;
  characters?: CharacterOpt[];
  showCharacterPicker?: boolean;
}) {
  const [photoUrl, setPhotoUrl] = useState(person?.photoUrl ?? "");
  const physical =
    person?.physicalParams && typeof person.physicalParams === "object"
      ? (person.physicalParams as Record<string, string>)
      : {};

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {showCharacterPicker && characters ? (
        <div>
          <Label htmlFor="characterId">Персонаж (роль)</Label>
          <Select id="characterId" name="characterId" defaultValue="">
            <option value="">— позже —</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="lastName">Фамилия *</Label>
          <Input id="lastName" name="lastName" required defaultValue={person?.lastName} />
        </div>
        <div>
          <Label htmlFor="firstName">Имя</Label>
          <Input id="firstName" name="firstName" defaultValue={person?.firstName ?? ""} />
        </div>
        <div>
          <Label htmlFor="middleName">Отчество</Label>
          <Input id="middleName" name="middleName" defaultValue={person?.middleName ?? ""} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="phone">Телефон</Label>
          <Input id="phone" name="phone" defaultValue={person?.phone ?? ""} />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={person?.email ?? ""} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="birthDate">Дата рождения</Label>
          <Input
            id="birthDate"
            name="birthDate"
            type="date"
            defaultValue={
              person?.birthDate
                ? String(person.birthDate).slice(0, 10)
                : ""
            }
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="education">Образование</Label>
          <Input
            id="education"
            name="education"
            defaultValue={person?.education ?? ""}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="filmography">Фильмография</Label>
        <textarea
          id="filmography"
          name="filmography"
          rows={3}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          defaultValue={person?.filmography ?? ""}
          placeholder="Фильмы, сериалы, спектакли…"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="agentName">Агент</Label>
          <Input id="agentName" name="agentName" defaultValue={person?.agentName ?? ""} />
        </div>
        <div>
          <Label htmlFor="agentPhone">Телефон агента</Label>
          <Input id="agentPhone" name="agentPhone" defaultValue={person?.agentPhone ?? ""} />
        </div>
        <div>
          <Label htmlFor="agentEmail">Email агента</Label>
          <Input
            id="agentEmail"
            name="agentEmail"
            type="email"
            defaultValue={person?.agentEmail ?? ""}
          />
        </div>
      </div>

      <ImageUpload
        projectId={projectId}
        name="photoUrl"
        label="Фото"
        value={photoUrl}
        onChange={setPhotoUrl}
      />

      <div>
        <p className="mb-2 text-sm font-medium">Физические параметры</p>
        <div className="grid gap-2 md:grid-cols-2">
          {STANDARD_PHYSICAL_PARAM_KEYS.map((key) => (
            <div key={key}>
              <Label htmlFor={`phys_${key}`}>{PHYSICAL_PARAM_LABELS[key] ?? key}</Label>
              <Input
                id={`phys_${key}`}
                name={`phys_${key}`}
                defaultValue={physical[key] ?? ""}
              />
            </div>
          ))}
          <div>
            <Label htmlFor="phys_custom_key">Другое (ключ)</Label>
            <Input id="phys_custom_key" name="phys_custom_key" placeholder="например: тату" />
          </div>
          <div>
            <Label htmlFor="phys_custom_value">Значение</Label>
            <Input id="phys_custom_value" name="phys_custom_value" />
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="skills">Умения (через запятую)</Label>
        <Input
          id="skills"
          name="skills"
          defaultValue={person?.skills?.join(", ") ?? ""}
          placeholder="вождение, вокал, английский…"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="proposedRate">Ставка за смену (заявленная)</Label>
          <Input
            id="proposedRate"
            name="proposedRate"
            type="number"
            min={0}
            defaultValue={person?.proposedRate ? Number(person.proposedRate) : undefined}
          />
        </div>
        <div>
          <Label htmlFor="proposedTerms">Условия / примечания</Label>
          <Input id="proposedTerms" name="proposedTerms" defaultValue={person?.proposedTerms ?? ""} />
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Заметки</Label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          defaultValue={person?.notes ?? ""}
        />
      </div>
    </div>
  );
}
