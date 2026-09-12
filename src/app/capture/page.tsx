import { getDb } from "@/db/client";
import { getContainerBySlug } from "@/domain/containers";
import { CaptureScreen } from "@/components/capture-screen";

export const dynamic = "force-dynamic";

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;
  const c = to ? getContainerBySlug(getDb(), to) : undefined;
  const defaultContainer = c && c.status === "active" ? { id: c.id, name: c.name, slug: c.slug, kind: c.kind } : null;
  return <CaptureScreen defaultContainer={defaultContainer} />;
}
