import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { requireProjectContext } from "@/features/projects/lib/project-context";

const ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  try {
    const ctx = await requireProjectContext(projectId);
    if (
      !ctx.can("project:write") &&
      !ctx.can("script:write") &&
      !ctx.can("schedule:write")
    ) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Допустимы только изображения" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Максимум 8 МБ" }, { status: 400 });
    }

    const rawExt = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const ext = ALLOWED_EXT.has(rawExt) ? rawExt : "jpg";
    const fileName = `${nanoid()}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", projectId);
    await mkdir(dir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, fileName), buffer);

    return NextResponse.json({ url: `/uploads/${projectId}/${fileName}` });
  } catch {
    return NextResponse.json({ error: "Ошибка загрузки" }, { status: 500 });
  }
}
