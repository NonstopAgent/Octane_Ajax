import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

type CommandHeaderProps = {
  badge: string;
  badgeTone?: "blue" | "orange" | "warning" | "neutral";
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  sysline?: string;
};

export function CommandHeader({
  badge,
  badgeTone = "blue",
  title,
  description,
  aside,
  sysline = "SYS.AJAX.FLOOR :: ONLINE",
}: CommandHeaderProps) {
  return (
    <header className="command-header">
      <div className="command-header-main">
        <StatusBadge label={badge} tone={badgeTone} />
        <h1 className="command-title">{title}</h1>
        {description && (
          <p className="command-description">{description}</p>
        )}
      </div>
      <div className="command-header-aside">
        {aside}
        {sysline && (
          <p className="command-sysline" aria-hidden>
            {sysline}
          </p>
        )}
      </div>
    </header>
  );
}
