"use client";

import { useState } from "react";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_HINT,
  passwordProblem,
} from "@/features/auth/lib/password-rules";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

/**
 * Поле нового пароля с подсказкой: те же правила, что на сервере, срабатывают при вводе.
 * Окончательную проверку делает сервер, здесь только удобство.
 */
export function NewPasswordField({
  label,
  email,
  id = "password",
  name = "password",
}: {
  label: string;
  email?: string;
  id?: string;
  name?: string;
}) {
  const [value, setValue] = useState("");
  const problem = value ? passwordProblem(value, email) : null;
  const hintId = `${id}-hint`;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-describedby={hintId}
      />
      {problem ? (
        <p id={hintId} className="mt-1 text-xs text-[var(--danger)]" data-testid="password-hint">
          {problem}
        </p>
      ) : value ? (
        <p
          id={hintId}
          className="mt-1 text-xs text-[var(--tone-success-strong)]"
          data-testid="password-hint"
        >
          Пароль подходит
        </p>
      ) : (
        <p id={hintId} className="mt-1 text-xs text-[var(--muted-fg)]" data-testid="password-hint">
          {PASSWORD_RULES_HINT}
        </p>
      )}
    </div>
  );
}
