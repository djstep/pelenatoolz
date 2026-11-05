"use client";

import { useEffect } from "react";
import { Button } from "@/shared/ui/button";

/** Экран вместо страницы, если она или действие на ней упали. Меню проекта остаётся на месте. */
export function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="glass-card mx-auto my-12 max-w-lg space-y-3 p-6">
      <h2 className="font-display text-xl font-bold">Что-то пошло не так</h2>
      <p className="text-sm text-[var(--muted-fg)]">
        Сервер не ответил или не смог выполнить действие. Изменения, которые вы не успели сохранить
        на этой странице, могли пропасть.
      </p>
      <Button type="button" onClick={() => retry()}>
        Повторить
      </Button>
    </div>
  );
}
