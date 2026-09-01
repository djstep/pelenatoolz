import { NextResponse } from "next/server";
import { estimateTravelMinutes } from "@/features/day-docs/lib/travel-time";
import { requireProjectContext } from "@/features/projects/lib/project-context";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:read") && !ctx.can("callsheet:read")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  let body: { from?: string; to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const from = String(body.from ?? "").trim();
  const to = String(body.to ?? "").trim();
  if (!from || !to) {
    return NextResponse.json({ error: "Укажите адреса" }, { status: 400 });
  }

  const result = await estimateTravelMinutes(from, to);
  return NextResponse.json(result);
}
