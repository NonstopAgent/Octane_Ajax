import { type ReactNode } from "react";

type PanelProps = {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  glow?: "blue" | "orange" | "none";
};

const glowClass = {
  blue: "panel-glow-blue",
  orange: "panel-glow-orange",
  none: "",
};

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  glow = "none",
}: PanelProps) {
  return (
    <section
      className={`factory-panel ${glowClass[glow]} ${className}`.trim()}
    >
      {(title || subtitle || action) && (
        <header className="mb-4 flex items-start justify-between gap-4 border-b border-[var(--border-dim)] pb-3">
          <>
            {title && (
              <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 text-base font-medium text-[var(--foreground)]">
                {subtitle}
              </p>
            )}
          </>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
