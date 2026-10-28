import { useState } from "react";

/**
 * Выполнить fn во время отрисовки, если значения deps изменились (и при первой отрисовке).
 * Замена эффекта, который только переносит свойства в состояние или сбрасывает поля
 * при открытии окна: React применяет такие изменения до показа, без лишней отрисовки.
 * В fn — только установка состояния этого же компонента.
 */
export function useOnChange(deps: readonly unknown[], fn: () => void) {
  const [prev, setPrev] = useState<readonly unknown[] | null>(null);
  if (
    prev === null ||
    prev.length !== deps.length ||
    deps.some((value, index) => !Object.is(value, prev[index]))
  ) {
    setPrev(deps);
    fn();
  }
}
