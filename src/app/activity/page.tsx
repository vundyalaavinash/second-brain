import { Suspense } from "react";
import { ActivityPage } from "@/components/activity/activity-page";

export default function Page() {
  return (
    <Suspense>
      <ActivityPage />
    </Suspense>
  );
}
