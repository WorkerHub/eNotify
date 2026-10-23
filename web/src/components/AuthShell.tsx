import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Centered auth card — shared by login/register/forgot/2fa/verify-email/setup
 * (design contract §5: 400px width, shadow-2, display-level logo area).
 */
export function AuthShell({
  title,
  subtitle,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className={cn("w-full max-w-[400px] motion-enter", className)}>
        <div className="rounded-lg border bg-card p-8 shadow-2">
          <div className="mb-8 text-center">
            <h1 className="text-display">{title}</h1>
            {subtitle && (
              <p className="mt-2 text-body-sm text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Inline form error that slides in (200ms, contract §5 auth). */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-body-sm text-destructive motion-safe:animate-[form-error-in_200ms_var(--ease-out)]"
    >
      {children}
    </p>
  );
}
