"use client";

import type { ScoutCandidateDetail } from "@/features/scout/queries";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { MultiSelect } from "@/shared/ui/multi-select";

type LocationOpt = { id: string; name: string; sublocation: string | null };

function locationLabel(loc: LocationOpt) {
  return loc.sublocation ? `${loc.name} / ${loc.sublocation}` : loc.name;
}

function mediaUrlsFromJson(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (item && typeof item === "object" && "url" in item) {
        return String((item as { url: string }).url);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function ScoutFormFields({
  candidate,
  locations,
}: {
  candidate?: ScoutCandidateDetail;
  locations: LocationOpt[];
}) {
  const selectedLocationIds =
    candidate?.locationLinks.map((l) => l.locationId) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="locationIds">Игровые объекты *</Label>
        <MultiSelect
          id="locationIds"
          name="locationIds"
          defaultValue={selectedLocationIds}
          hint="Локации, которые покрывает эта площадка"
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {locationLabel(loc)}
            </option>
          ))}
        </MultiSelect>
      </div>
      <div>
        <Label htmlFor="title">Название места *</Label>
        <Input id="title" name="title" required defaultValue={candidate?.title} />
      </div>
      <div>
        <Label htmlFor="address">Адрес</Label>
        <Input id="address" name="address" defaultValue={candidate?.address ?? ""} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="cost">Стоимость</Label>
          <Input
            id="cost"
            name="cost"
            type="number"
            min={0}
            defaultValue={candidate?.cost ?? undefined}
          />
        </div>
        <div>
          <Label htmlFor="contactPhone">Телефон контакта</Label>
          <Input
            id="contactPhone"
            name="contactPhone"
            defaultValue={candidate?.contactPhone ?? ""}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="contactName">Контактное лицо</Label>
        <Input
          id="contactName"
          name="contactName"
          defaultValue={candidate?.contactName ?? ""}
        />
      </div>
      <div>
        <Label htmlFor="photoUrls">Фото (URL, по одному на строку)</Label>
        <textarea
          id="photoUrls"
          name="photoUrls"
          rows={3}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          defaultValue={mediaUrlsFromJson(candidate?.photos)}
        />
      </div>
      <div>
        <Label htmlFor="videoUrls">Видео (URL, по одному на строку)</Label>
        <textarea
          id="videoUrls"
          name="videoUrls"
          rows={2}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          defaultValue={mediaUrlsFromJson(candidate?.videos)}
        />
      </div>
      <div>
        <Label htmlFor="notes">Заметки</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          defaultValue={candidate?.notes ?? ""}
        />
      </div>
    </div>
  );
}

export function formatScoutLocations(
  links: ScoutCandidateDetail["locationLinks"],
  locale: string,
  projectId: string,
) {
  return links.map((link) => ({
    id: link.location.id,
    label: locationLabel(link.location),
    href: `/${locale}/projects/${projectId}/locations/${link.location.id}`,
  }));
}
