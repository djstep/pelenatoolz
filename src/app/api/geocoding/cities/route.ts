import { searchCities } from "@/features/projects/lib/city-geocoding";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 10) || 10, 20);

  const results = await searchCities(query, limit);
  return Response.json({ results });
}
