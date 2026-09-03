"use client";

import { cn } from "@/lib/utils";

interface TypingDotsProps {
  /** Optional label rendered next to the dots, e.g. "sedang mengetik…" */
  label?: string;
  className?: string;
}

/**
 * Three bouncing dots used as the "partner is typing" indicator.
 * Animation keyframes (`typing-bounce`) live in globals.css.
 */
export function TypingDots({ label, className }: TypingDotsProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      {label ? (
        <span className="text-xs italic text-muted-foreground" role="status">
          {label}
        </span>
      ) : null}
    </span>
  );
}
