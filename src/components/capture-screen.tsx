"use client";

import { useState } from "react";
import type { ContainerRefDTO } from "@/lib/dto";
import { CaptureBox } from "./capture-box";
import { RecentCaptures } from "./recent-captures";

interface Props {
  defaultContainer?: ContainerRefDTO | null;
}

export function CaptureScreen({ defaultContainer }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="w-full max-w-3xl mx-auto p-6 flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight">Capture</h1>
        <span className="font-mono text-[10px] text-fg-faint">notes · links · pdf · images</span>
      </header>
      <CaptureBox defaultContainer={defaultContainer} onCaptured={() => setRefreshKey((k) => k + 1)} />
      <RecentCaptures refreshKey={refreshKey} />
    </div>
  );
}
