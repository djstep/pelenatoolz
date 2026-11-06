import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchCities } from "@/features/projects/lib/city-geocoding";

export async function GET(request: Request) {
  // Иначе маршрут стал бы бесплатным посредником к внешнему сервису для кого угодно.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 10) || 10, 20);

  try {
    return NextResponse.json({ results: await searchCities(query, limit) });
  } catch (error) {
    console.error("[geocoding]", error instanceof Error ? error.message : "сбой поиска");
    return NextResponse.json({ error: "Поиск городов недоступен" }, { status: 503 });
  }
}
