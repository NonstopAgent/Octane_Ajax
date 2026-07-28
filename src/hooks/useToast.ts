"use client";

/**
 * Shared toast state (2026-07-25 audit, M11).
 *
 * Replaces four copy-pasted `showToast` closures that shared a latent bug:
 * `window.setTimeout(…, 6000)` was never cancelled, so an earlier toast's
 * timer would clear a LATER toast early, and the timer still fired after
 * unmount. This version cancels the previous timer on every show and on
 * unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ToastState,
  ToastTone,
} from "@/components/factory/toast-banner";

export function useToast(autoHideMs = 6000): {
  toast: ToastState;
  showToast: (tone: ToastTone, message: string) => void;
} {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (tone: ToastTone, message: string) => {
      setToast({ tone, message });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setToast(null), autoHideMs);
    },
    [autoHideMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { toast, showToast };
}
