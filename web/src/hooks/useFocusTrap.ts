import { useEffect, useRef } from "react";

/**
 * Focus trap for modal overlays (design contract / a11y):
 * - moves initial focus into the container on mount
 * - keeps Tab / Shift+Tab cycling inside
 * - closes on Escape
 * - returns focus to the previously focused element on unmount
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void,
) {
  const ref = useRef<T>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // initial focus: first focusable, else the container itself
    const first = focusables()[0];
    if (first) first.focus();
    else {
      node.setAttribute("tabindex", "-1");
      node.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (!current || current === firstItem || !node.contains(current)) {
          e.preventDefault();
          lastItem.focus();
        }
      } else if (!current || current === lastItem || !node.contains(current)) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreRef.current?.focus?.();
    };
  }, [active]);

  return ref;
}
