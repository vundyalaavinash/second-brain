import type { IconName } from "./nav";

const PATHS: Record<IconName, string> = {
  inbox: "M3 13l2-8h14l2 8v6H3z M3 13h5l1 2h6l1-2h5",
  project: "M5 21V4h11l-1 4 1 4H5",
  area: "M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5",
  resource: "M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4z M20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z",
  people: "M16 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2 M9.5 11a4 4 0 100-8 4 4 0 000 8z M21 21v-2a4 4 0 00-3-3.9 M15 3.1a4 4 0 010 7.8",
  library: "M4 6h16 M4 12h16 M4 18h10",
  archive: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-4.3-4.3",
  capture: "M12 5v14 M5 12h14",
};

export function Icon({ name, className = "w-[18px] h-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
