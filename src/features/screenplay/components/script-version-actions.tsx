"use client";

import { cn } from "@/shared/lib/cn";

type ActionIconId = "duplicate" | "compare" | "lock" | "unlock" | "delete";

type Action = {
  id: string;
  label: string;
  icon: ActionIconId;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
};

type Props = {
  actions: Action[];
  disabled?: boolean;
};

function ActionIcon({ icon }: { icon: ActionIconId }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (icon) {
    case "duplicate":
      return (
        <svg {...common}>
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
        </svg>
      );
    case "compare":
      return (
        <svg {...common}>
          <path d="M6 3.5v9" />
          <path d="M10 3.5v9" />
          <path d="M3.5 8H6" />
          <path d="M10 8h2.5" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="4" y="7" width="8" height="6" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
      );
    case "unlock":
      return (
        <svg {...common}>
          <rect x="4" y="7" width="8" height="6" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" />
        </svg>
      );
    case "delete":
      return (
        <svg {...common}>
          <path d="M3.5 5h9" />
          <path d="M6.5 5V4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1" />
          <path d="M5 5l.5 7.5h5L11 5" />
        </svg>
      );
  }
}

export function ScriptVersionActions({ actions, disabled = false }: Props) {
  if (actions.length === 0) {
    return <span className="text-xs text-[var(--muted-fg)]">—</span>;
  }

  return (
    <div className="script-version-actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={disabled || action.disabled}
          title={action.label}
          aria-label={action.label}
          className={cn(
            "script-version-action-btn",
            action.active && "script-version-action-btn--active",
            action.danger && "script-version-action-btn--danger",
          )}
          onClick={(event) => {
            event.stopPropagation();
            action.onClick();
          }}
        >
          <ActionIcon icon={action.icon} />
        </button>
      ))}
    </div>
  );
}

export type { Action as ScriptVersionActionItem };
