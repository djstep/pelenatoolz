"use client";

import { useState } from "react";
import { ImageUpload } from "@/shared/ui/image-upload";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";

export function LocationPhotoAddForm({
  projectId,
  action,
  pending,
  error,
}: {
  projectId: string;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  const [url, setUrl] = useState("");

  return (
    <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-[16rem] flex-1">
        <ImageUpload
          projectId={projectId}
          name="url"
          label="Фото"
          value={url}
          onChange={setUrl}
          disabled={pending}
        />
      </div>
      <div>
        <Input
          name="caption"
          placeholder="Подпись"
          className="max-w-[12rem]"
          disabled={pending}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending || !url.trim()}>
        {pending ? "…" : "Добавить фото"}
      </Button>
      {error ? (
        <span className="w-full text-sm text-[var(--danger)]">{error}</span>
      ) : null}
    </form>
  );
}
