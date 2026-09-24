import { getDb } from "@/db/client";
import { Crumb } from "@/components/shell/crumb";
import { HomePage } from "@/components/home/home-page";
import { homePayload } from "@/lib/home";

export const dynamic = "force-dynamic";

/**
 * Where the day stands. The payload is built on the server and handed to the page whole, so the
 * first paint is the real day rather than a shell that fills in. `crumbsFor("/")` is empty by
 * design, so Home supplies its own tail the way a container page does.
 */
export default function Home() {
  return (
    <>
      <Crumb title="Home" />
      <HomePage initial={homePayload(getDb(), new Date())} />
    </>
  );
}
