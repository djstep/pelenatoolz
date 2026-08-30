/** Strip HTML tags and decode common entities for plain-text export/timing. */
export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function blockPlainText(content: string, contentHtml?: string | null): string {
  if (contentHtml?.trim()) return stripHtml(contentHtml);
  return content;
}
