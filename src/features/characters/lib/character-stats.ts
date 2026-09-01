import type { CharacterWithStats } from "@/features/characters/queries";

export function getKppShiftCount(row: CharacterWithStats) {
  const days = new Set<string>();
  for (const link of row.scenes) {
    for (const d of link.scene.shootDayScenes) {
      days.add(d.shootDay.id);
    }
  }
  return days.size;
}

export function getEstimatedShiftCount(row: CharacterWithStats) {
  const days = new Set<string>();
  for (const link of row.scenes) {
    const sd = link.scene.scriptDay;
    if (sd != null) days.add(`${link.scene.episodeNumber}:${sd}`);
  }
  return days.size || row.sceneCount;
}

export function getObjectCount(row: CharacterWithStats) {
  const names = new Set<string>();
  for (const link of row.scenes) {
    for (const loc of link.scene.locations) {
      names.add(loc.location.id);
    }
  }
  return names.size;
}

export function getKppDates(row: CharacterWithStats) {
  const dates: Date[] = [];
  for (const link of row.scenes) {
    for (const d of link.scene.shootDayScenes) {
      dates.push(d.shootDay.date);
    }
  }
  return dates;
}
