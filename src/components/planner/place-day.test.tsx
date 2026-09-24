// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { placeDay, placeNextLabel } from "./place-day";

const TODAY = "2026-09-22";

/** Records every request, answering each place with the figures the day is meant to report. */
function stub(...answers: { placed: number; unplacedMinutes: number }[]) {
  const posts: { url: string; body: unknown }[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(input) === "/api/plan/place") return Response.json(answers[Math.min(i++, answers.length - 1)]);
      return Response.json({});
    }),
  );
  return posts;
}

/** Every toast raised while the block runs, and every announcement of a changed day. */
function watch() {
  const toasts: { text: string; action?: { label: string; onClick(): void } }[] = [];
  let changed = 0;
  const onToast = (e: Event) => toasts.push((e as CustomEvent<{ text: string; action?: { label: string; onClick(): void } }>).detail);
  const onChanged = () => (changed += 1);
  window.addEventListener("sb:toast", onToast);
  window.addEventListener("sb:tasks-changed", onChanged);
  return {
    toasts,
    changes: () => changed,
    stop: () => {
      window.removeEventListener("sb:toast", onToast);
      window.removeEventListener("sb:tasks-changed", onChanged);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("placeDay", () => {
  it("names the offer after the day it means", () => {
    expect(placeNextLabel(TODAY, TODAY)).toBe("Place tomorrow");
    expect(placeNextLabel("2026-09-25", TODAY)).toBe("Place on Sat 26");
  });

  it("says what it placed in the three ways the day can go", async () => {
    const w = watch();
    try {
      // Nothing to do, one session placed whole, and a run with a remainder left over.
      for (const answer of [
        { placed: 0, unplacedMinutes: 0 },
        { placed: 1, unplacedMinutes: 0 },
        { placed: 3, unplacedMinutes: 80 },
      ]) {
        stub(answer);
        await placeDay(TODAY, { today: TODAY, onError: vi.fn() });
      }
      expect(w.toasts.map((t) => t.text)).toEqual(["Nothing to place", "Placed 1 session", "Placed 3 sessions, 1h 20m unplaced"]);
      // Every run says the day has moved, whatever it found room for.
      expect(w.changes()).toBe(3);
    } finally {
      w.stop();
    }
  });

  it("offers the next day the remainder, once, and plans the row there before placing it", async () => {
    const posts = stub({ placed: 2, unplacedMinutes: 45 }, { placed: 1, unplacedMinutes: 30 });
    const w = watch();
    try {
      await placeDay(TODAY, { taskId: 7, today: TODAY, offerNext: true, onError: vi.fn() });
      expect(posts).toEqual([{ url: "/api/plan/place", body: { date: TODAY, taskId: 7 } }]);
      expect(w.toasts[0].action?.label).toBe("Place tomorrow");

      await w.toasts[0].action!.onClick();
      await vi.waitFor(() => expect(posts).toHaveLength(3));
      expect(posts.slice(1)).toEqual([
        { url: "/api/plan", body: { date: "2026-09-23", taskId: 7 } },
        { url: "/api/plan/place", body: { date: "2026-09-23", taskId: 7 } },
      ]);
      // Tomorrow still has a remainder, and is not offered the day after: the offer is made once.
      await vi.waitFor(() => expect(w.toasts).toHaveLength(2));
      expect(w.toasts[1].action).toBeUndefined();
    } finally {
      w.stop();
    }
  });

  it("says a whole-day fill on the next day, planning nothing new onto it", async () => {
    const posts = stub({ placed: 1, unplacedMinutes: 20 }, { placed: 1, unplacedMinutes: 0 });
    const w = watch();
    try {
      await placeDay(TODAY, { today: TODAY, offerNext: true, onError: vi.fn() });
      await w.toasts[0].action!.onClick();
      await vi.waitFor(() => expect(posts).toHaveLength(2));
      expect(posts[1]).toEqual({ url: "/api/plan/place", body: { date: "2026-09-23" } });
    } finally {
      w.stop();
    }
  });

  it("reports a request that failed, and a body it could not read, without a toast", async () => {
    const w = watch();
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
      const refused = vi.fn();
      await placeDay(TODAY, { today: TODAY, onError: refused });
      expect(refused).toHaveBeenCalledWith("Could not save that change");
      expect(w.changes()).toBe(0);

      // A place that went through but answered with nothing readable: the sessions are written,
      // so the day is announced; only the toast is lost.
      vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
      const unreadable = vi.fn();
      await placeDay(TODAY, { today: TODAY, onError: unreadable });
      expect(unreadable).toHaveBeenCalledWith("Could not save that change");
      expect(w.changes()).toBe(1);
      expect(w.toasts).toEqual([]);
    } finally {
      w.stop();
    }
  });
});
