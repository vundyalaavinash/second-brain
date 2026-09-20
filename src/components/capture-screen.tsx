"use client";

import { useState } from "react";
import type { ContainerRefDTO } from "@/lib/dto";
import { CaptureBox } from "./capture-box";
import { RecentCaptures } from "./recent-captures";
import { PageHeader } from "./ui";

interface Props {
  defaultContainer?: ContainerRefDTO | null;
}

export function CaptureScreen({ defaultContainer }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="w-full px-6 lg:px-8 pt-8 flex flex-col gap-6">
      <PageHeader title="Capture" meta="Notes, links, PDFs, and images land in your Inbox unless you pick a home." />
      <CaptureBox defaultContainer={defaultContainer} onCaptured={() => setRefreshKey((k) => k + 1)} />
      <RecentCaptures refreshKey={refreshKey} />
    </div>
  );
}
