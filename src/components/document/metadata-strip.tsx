import type { ReactNode } from "react";

/** A single-line strip of metadata groups (type, home, tags, people, created). Separate
 * groups with `<span className="w-px h-3 bg-paper-rule" aria-hidden />`. */
export function MetadataStrip({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-paper-muted">{children}</div>;
}
