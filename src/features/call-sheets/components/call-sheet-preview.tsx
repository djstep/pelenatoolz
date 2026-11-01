"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Лист A4 (210 мм ≈ 794 px) и серые поля вокруг него — ширина экранного вида шаблона. */
const SHEET_WIDTH_PX = 820;
/** Высота до первого замера — примерно один лист. */
const INITIAL_HEIGHT_PX = 1160;

/**
 * Просмотр листа вызывного — тот же HTML, что идёт в печать, в `<iframe src sandbox>`
 * (маршрут `…/call-sheets/[dayId]/sheet`, право проверяет он). В данные страницы HTML не
 * попадает — браузер берёт его один раз, шрифт — отдельным файлом из кэша.
 * Стили листа не смешиваются со стилями сайта, лист белый в обеих темах.
 * `sandbox` без `allow-scripts` — скрипты в листе не выполняются (их там и нет, плюс CSP);
 * `allow-same-origin` нужен только чтобы снаружи узнать высоту листа.
 * Ширина — как у A4, на узком экране лист уменьшается целиком.
 * Новый адрес (после сохранения правок или «Обновить из КПП» меняется `v`) перезагружает просмотр.
 */
export function CallSheetPreview({ src }: { src: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(INITIAL_HEIGHT_PX);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
  }, []);

  const onLoad = useCallback(() => {
    measure();
    // Шрифт грузится отдельным файлом — после него строки могут перестроиться.
    void frameRef.current?.contentDocument?.fonts?.ready.then(measure);
  }, [measure]);

  // Лист мог загрузиться до гидратации — тогда `onLoad` уже прошёл мимо.
  useEffect(() => {
    if (frameRef.current?.contentDocument?.readyState === "complete") onLoad();
  }, [src, onLoad]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? SHEET_WIDTH_PX;
      setScale(Math.min(1, width / SHEET_WIDTH_PX));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="w-full">
      <div
        className="mx-auto overflow-hidden rounded-lg"
        style={{ width: SHEET_WIDTH_PX * scale, height: height * scale }}
      >
        <iframe
          ref={frameRef}
          title="Вызывной лист"
          src={src}
          sandbox="allow-same-origin"
          onLoad={onLoad}
          className="block border-0 bg-white"
          style={{
            width: SHEET_WIDTH_PX,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
    </div>
  );
}
