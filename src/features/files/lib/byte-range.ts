export type ByteRange = { start: number; end: number };

/**
 * Заголовок `Range` → кусок файла. `null` — отдать файл целиком: заголовка нет, он не понят или
 * просит несколько кусков (стандарт это разрешает). `"unsatisfiable"` — кусок за концом файла, 416.
 */
export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return null;
  const [, first, last] = match;
  if (!first && !last) return null;
  if (size === 0) return "unsatisfiable";

  if (!first) {
    const suffix = Number(last);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return "unsatisfiable";
  if (!last) return { start, end: size - 1 };
  const end = Number(last);
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}
