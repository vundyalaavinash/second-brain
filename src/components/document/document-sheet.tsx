import type { ReactNode } from "react";

/** The paper sheet an item page's content sits on: a centred column with document margins. */
export function DocumentSheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`on-paper doc-sheet rounded-lg shadow-paper mx-auto w-full max-w-[880px] px-8 lg:px-12 py-10 min-h-[calc(100vh-9rem)] ${className}`}>
      {children}
    </section>
  );
}
