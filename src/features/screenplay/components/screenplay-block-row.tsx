"use client";

import { ScriptBlockType } from "@prisma/client";
import { useCallback, useEffect, useRef } from "react";
import {
  blockTypeClassName,
  nextBlockTypeOnEnter,
  SCRIPT_BLOCK_LABELS,
  type ScreenplayBlock,
} from "@/features/screenplay/lib/block-types";
import { stripHtml } from "@/features/screenplay/lib/plain-text";
import { cn } from "@/shared/lib/cn";

const SINGLE_LINE_TYPES = new Set<ScriptBlockType>([
  "SLUGLINE",
  "CHARACTER",
  "SCENE_CAST",
  "TRANSITION",
  "SUPER",
  "FOLDER",
  "SCENE_GROUP",
]);

type Props = {
  block: ScreenplayBlock;
  index: number;
  active: boolean;
  canWrite: boolean;
  hasOpenComments: boolean;
  onFocus: () => void;
  onChange: (patch: Partial<ScreenplayBlock>) => void;
  onInsertAfter: (type: ScriptBlockType) => void;
  onRemove: () => void;
  onTypeChange: (type: ScriptBlockType) => void;
  onCharacterBlur?: (name: string) => void;
  onSluglineBlur?: (content: string) => void;
  characterOptions?: string[];
  locationOptions?: string[];
  editorRef?: (node: HTMLDivElement | null) => void;
};

function adjustHeight(el: HTMLElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function ScreenplayBlockRow({
  block,
  index,
  active,
  canWrite,
  hasOpenComments,
  onFocus,
  onChange,
  onInsertAfter,
  onRemove,
  onTypeChange,
  onCharacterBlur,
  onSluglineBlur,
  characterOptions,
  locationOptions,
  editorRef,
}: Props) {
  const editableRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDetailsElement | null>(null);

  const syncFromDom = useCallback(() => {
    const el = editableRef.current;
    if (!el) return;
    const html = el.innerHTML;
    const text = stripHtml(html);
    onChange({ content: text, contentHtml: html === text ? null : html });
    adjustHeight(el);
  }, [onChange]);

  useEffect(() => {
    const el = editableRef.current;
    if (!el || document.activeElement === el) return;
    const html = block.contentHtml ?? block.content;
    if (el.innerHTML !== html) {
      el.innerHTML = html || "";
      adjustHeight(el);
    }
  }, [block.content, block.contentHtml, block.id]);

  useEffect(() => {
    adjustHeight(editableRef.current);
  }, [block.type]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      menuRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canWrite) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onInsertAfter(nextBlockTypeOnEnter(block.type));
      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const types = Object.keys(SCRIPT_BLOCK_LABELS) as ScriptBlockType[];
      const nextType = types[(types.indexOf(block.type) + 1) % types.length]!;
      onTypeChange(nextType);
      return;
    }

    if (event.key === "Backspace") {
      const el = editableRef.current;
      const text = stripHtml(el?.innerHTML ?? "");
      const selection = window.getSelection();
      const atStart =
        selection?.anchorOffset === 0 &&
        selection?.focusOffset === 0 &&
        selection?.anchorNode === el?.firstChild;

      if (!text.trim() && (atStart || !el?.textContent)) {
        event.preventDefault();
        onRemove();
      }
    }
  };

  const singleLine = SINGLE_LINE_TYPES.has(block.type);

  return (
    <div
      className={cn(
        "screenplay-block-row group relative",
        active && "screenplay-block-row--active",
        hasOpenComments && "screenplay-block-row--commented",
      )}
      data-block-index={index}
      data-block-id={block.id}
      data-scene-id={
        block.type === "SLUGLINE" && block.sceneId ? block.sceneId : undefined
      }
    >
      {canWrite ? (
        <div className="screenplay-block-gutter screenplay-block-gutter--left">
          <details ref={menuRef} className="screenplay-block-menu">
            <summary
              className="screenplay-block-menu-trigger"
              title="Управление блоком"
              onClick={(event) => event.stopPropagation()}
            >
              ⋮
            </summary>
            <div className="screenplay-block-menu-panel">
              <label className="screenplay-block-menu-label">
                Тип блока
                <select
                  value={block.type}
                  onChange={(event) =>
                    onTypeChange(event.target.value as ScriptBlockType)
                  }
                  className="glass-input mt-1 w-full rounded-lg px-2 py-1 text-xs"
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
              <button
                type="button"
                className="mt-2 w-full rounded-lg px-2 py-1 text-left text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10"
                onClick={() => {
                  menuRef.current?.removeAttribute("open");
                  onRemove();
                }}
              >
                Удалить блок
              </button>
            </div>
          </details>
        </div>
      ) : null}

      <div className="screenplay-block-body">
        <div
          ref={(node) => {
            editableRef.current = node;
            editorRef?.(node);
          }}
          contentEditable={canWrite}
          suppressContentEditableWarning
          spellCheck
          role="textbox"
          aria-label={SCRIPT_BLOCK_LABELS[block.type]}
          className={cn(
            blockTypeClassName(block.type),
            "screenplay-block-input w-full border-none bg-transparent outline-none",
            singleLine && "screenplay-block-input--single",
          )}
          data-placeholder={SCRIPT_BLOCK_LABELS[block.type]}
          onFocus={onFocus}
          onInput={syncFromDom}
          onBlur={() => {
            syncFromDom();
            if (block.type === "CHARACTER") {
              onCharacterBlur?.(block.content);
            }
            if (block.type === "SLUGLINE") {
              onSluglineBlur?.(block.content);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
        />
        {block.type === "CHARACTER" && characterOptions ? (
          <datalist id={`chars-${block.id}`}>
            {characterOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        ) : null}
        {block.type === "SLUGLINE" && locationOptions ? (
          <datalist id={`locs-${block.id}`}>
            {locationOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        ) : null}
      </div>
    </div>
  );
}
