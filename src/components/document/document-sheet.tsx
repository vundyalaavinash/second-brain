import type { ReactNode } from "react";

/** The panel an item page's content sits on: a centred column with document margins. */
export function DocumentSheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`doc-sheet bg-layer-1 rounded-lg border border-hairline mx-auto w-full max-w-[880px] px-8 lg:px-12 py-10 min-h-[calc(100vh-9rem)] ${className}`}>
      {children}
    </section>
  );
}
