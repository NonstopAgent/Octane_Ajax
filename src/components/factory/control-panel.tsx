"use client";

import { Button } from "@/components/ui/button";

type CyclePhase = "nova" | "forge" | null;

type ControlPanelProps = {
  onRunCycle: () => void;
  onRunPixel: () => void;
  onResetDemo: () => void;
  running: boolean;
  cyclePhase: CyclePhase;
  runningPixel: boolean;
  resetting: boolean;
  disabled?: boolean;
};

export function ControlPanel({
  onRunCycle,
  onRunPixel,
  onResetDemo,
  running,
  cyclePhase,
  runningPixel,
  resetting,
  disabled,
}: ControlPanelProps) {
  const busy = running || runningPixel || resetting;

  const cycleLabel = !running
    ? "Run Ajax cycle"
    : cyclePhase === "nova"
      ? "Running Nova…"
      : cyclePhase === "forge"
        ? "Running Forge…"
        : "Cycle running";

  return (
    <section className="factory-panel panel-glow-orange border-l-4 border-l-[var(--accent-orange)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-orange)]">
        Master controls
      </p>
      <h2 className="mt-1 text-lg font-bold">Factory dispatch</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Industrial switches — Nova → Forge → Review → Pixel pipeline.
      </p>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <Button
          variant="primary"
          className="factory-control factory-control-primary h-11 w-full"
          disabled={disabled || busy}
          onClick={onRunCycle}
        >
          {running ? (
            <>
              <Spinner /> {cycleLabel}
            </>
          ) : (
            "Run Ajax cycle"
          )}
        </Button>
        <Button
          variant="secondary"
          className="factory-control factory-control-secondary h-11 w-full"
          disabled={disabled || busy}
          onClick={onRunPixel}
        >
          {runningPixel ? (
            <>
              <Spinner /> Pixel active
            </>
          ) : (
            "Run Pixel"
          )}
        </Button>
        <Button
          variant="ghost"
          className="factory-control factory-control-ghost h-11 w-full"
          disabled={disabled || busy}
          onClick={onResetDemo}
        >
          {resetting ? (
            <>
              <Spinner /> Resetting
            </>
          ) : (
            "Reset factory"
          )}
        </Button>
      </div>
    </section>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}
