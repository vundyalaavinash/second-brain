import { redirect } from "next/navigation";

/** Today became Home; the route stays so older links and bookmarks still land. */
export default function TodayPage() {
  redirect("/");
}
