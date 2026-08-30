"use client";

import type { ScriptBlockType } from "@prisma/client";
import { FORMAT_PRESETS } from "@/features/screenplay/lib/format-presets";
import { SCRIPT_BLOCK_LABELS } from "@/features/screenplay/lib/block-types";
import { cn } from "@/shared/lib/cn";

type Props = {
  activeType: ScriptBlockType;
  canWrite: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isFullscreen: boolean;
  onTypeChange: (type: ScriptBlockType) => void;
  onFormat: (command: string, value?: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReformat: () => void;
  onToggleFullscreen: () => void;
};

function ToolbarButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "screenplay-toolbar-btn",
        active && "screenplay-toolbar-btn--active",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[var(--border)]" />;
}

export function ScreenplayFormatToolbar({
  activeType,
  canWrite,
  canUndo,
  canRedo,
  isFullscreen,
  onTypeChange,
  onFormat,
  onUndo,
  onRedo,
  onReformat,
  onToggleFullscreen,
}: Props) {
  return (
    <div className="screenplay-format-toolbar">
      <div className="screenplay-format-toolbar-group">
        <label className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted-fg)]">
          <span className="whitespace-nowrap">Тип</span>
          <select
            value={activeType}
            disabled={!canWrite}
            onChange={(event) =>
              onTypeChange(event.target.value as ScriptBlockType)
            }
            className="glass-input w-[6.5rem] shrink min-w-0 rounded-lg px-1.5 py-1 text-xs"
          >
            {(Object.keys(SCRIPT_BLOCK_LABELS) as ScriptBlockType[]).map(
              (type) => (
                <option key={type} value={type}>
                  {SCRIPT_BLOCK_LABELS[type]}
                </option>
              ),
            )}
          </select>
        </label>
        <ToolbarDivider />
        <label className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted-fg)]">
          <span className="whitespace-nowrap">Формат</span>
          <select
            disabled={!canWrite}
            defaultValue=""
            onChange={(event) => {
              const preset = FORMAT_PRESETS.find(
                (p) => p.id === event.target.value,
              );
              if (preset) onTypeChange(preset.type);
              event.target.value = "";
            }}
            className="glass-input w-[5.5rem] shrink min-w-0 rounded-lg px-1.5 py-1 text-xs"
          >
            <option value="" disabled>
              Пресет…
            </option>
            {FORMAT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="screenplay-format-toolbar-group">
        <ToolbarButton
          title="Жирный"
          disabled={!canWrite}
          onClick={() => onFormat("bold")}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          title="Курсив"
          disabled={!canWrite}
          onClick={() => onFormat("italic")}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          title="Подчёркнутый"
          disabled={!canWrite}
          onClick={() => onFormat("underline")}
        >
          <span className="underline">U</span>
        </ToolbarButton>
        <ToolbarButton
          title="Зачёркнутый"
          disabled={!canWrite}
          onClick={() => onFormat("strikeThrough")}
        >
          <span className="line-through">S</span>
        </ToolbarButton>
        <label
          className="screenplay-toolbar-btn cursor-pointer"
          title="Цвет текста"
        >
          <span className="text-xs">A</span>
          <input
            type="color"
            disabled={!canWrite}
            className="sr-only"
            defaultValue="#e2e8f0"
            onChange={(event) => onFormat("foreColor", event.target.value)}
          />
        </label>
        <label
          className="screenplay-toolbar-btn cursor-pointer"
          title="Цвет выделения"
        >
          <span className="text-xs">▨</span>
          <input
            type="color"
            disabled={!canWrite}
            className="sr-only"
            defaultValue="#fbbf24"
            onChange={(event) => onFormat("hiliteColor", event.target.value)}
          />
        </label>
      </div>

      <div className="screenplay-format-toolbar-group">
        <ToolbarButton title="Отменить" disabled={!canUndo} onClick={onUndo}>
          ↶
        </ToolbarButton>
        <ToolbarButton title="Повторить" disabled={!canRedo} onClick={onRedo}>
          ↷
        </ToolbarButton>
      </div>

      <div className="screenplay-format-toolbar-group">
        <ToolbarButton
          title="Переформатировать типы блоков"
          disabled={!canWrite}
          onClick={onReformat}
        >
          F
        </ToolbarButton>
        <ToolbarButton
          title={
            isFullscreen
              ? "Выйти из полноэкранного режима"
              : "Полноэкранный режим"
          }
          onClick={onToggleFullscreen}
        >
          ⤢
        </ToolbarButton>
      </div>
    </div>
  );
}
