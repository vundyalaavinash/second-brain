import { redirect } from "next/navigation";

/** The Planner replaced Today; the route stays so older links and bookmarks still land. */
export default function TodayPage() {
  redirect("/planner");
}
