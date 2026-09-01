"use client";

import { useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

export function ImageUpload({
  projectId,
  name,
  label,
  value,
  onChange,
  disabled,
}: {
  projectId: string;
  name: string;
  label?: string;
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/uploads`, {
        method: "POST",
        body,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Не удалось загрузить файл");
        return;
      }
      onChange(data.url);
    } catch {
      setError("Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {label ? <Label htmlFor={name}>{label}</Label> : null}
      <input type="hidden" name={name} value={value} readOnly />
      {value ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className="h-20 w-20 rounded-lg border border-[var(--border)] object-cover"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Загрузка…" : "Заменить"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || uploading}
              onClick={() => onChange("")}
            >
              Удалить
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Загрузка…" : "Загрузить фото"}
        </Button>
      )}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="или вставьте URL"
        disabled={disabled || uploading}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
