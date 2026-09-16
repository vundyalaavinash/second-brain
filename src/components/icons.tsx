import { Inbox, Flag, Layers, BookMarked, Users, Activity, LayoutList, Archive, Search, Plus, type LucideIcon } from "lucide-react";
import type { IconName } from "./nav";

const ICONS: Record<IconName, LucideIcon> = {
  inbox: Inbox,
  project: Flag,
  area: Layers,
  resource: BookMarked,
  people: Users,
  activity: Activity,
  library: LayoutList,
  archive: Archive,
  search: Search,
  capture: Plus,
};

export function Icon({ name, className = "w-5 h-5" }: { name: IconName; className?: string }) {
  const Cmp = ICONS[name];
  return <Cmp className={className} strokeWidth={1.75} aria-hidden />;
}
