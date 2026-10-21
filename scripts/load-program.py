#!/usr/bin/env python3
"""Load a structured programme into a running Second Brain.

A "programme" is any long-running practice with goals, phases and reps: a 52-week growth plan, a
certification syllabus, a reading year, an onboarding ramp. The shape is deliberately generic --
the file names the containers, goals, tasks and notes, and this maps each onto the primitive the
app already has, so a programme is data rather than a feature.

Everything goes through the HTTP API rather than the database, so every write passes the same
validation and invariants the UI does. It is idempotent by name: run it twice and the second run
adds only what was missing, which is what makes it safe to extend a programme file later.

    scripts/load-program.py programs/example.json
    scripts/load-program.py --dry-run <file>.json               # say what it would do
    scripts/load-program.py --base http://127.0.0.1:3141 <file>

`programs/example.json` documents the shape. Your own programmes are personal and are not kept in
the repo -- by convention they live in ~/Library/Application Support/second-brain/programs/, which
`programs/*.json` in .gitignore is there to keep true.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

TIMEOUT = 30


class ApiError(RuntimeError):
    pass


def call(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{base}{path}", data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:500]
        raise ApiError(f"{method} {path} -> {err.code} {detail}") from err
    except urllib.error.URLError as err:
        raise ApiError(f"{method} {path} -> {err.reason}. Is the server running on {base}?") from err


class Loader:
    def __init__(self, base, dry_run):
        self.base = base
        self.dry_run = dry_run
        self.made = []
        self.skipped = []

    def note(self, what, created):
        (self.made if created else self.skipped).append(what)

    def post(self, path, body):
        if self.dry_run:
            return None
        return call(self.base, "POST", path, body)

    # -- containers ----------------------------------------------------------------
    def containers(self, kind):
        """Active and archived alike -- no status filter. Re-creating something the person
        archived on purpose would be worse than skipping it."""
        rows = call(self.base, "GET", f"/api/containers?kind={kind}")
        return {c["name"]: c for c in rows}

    def container(self, kind, spec, existing):
        name = spec["name"]
        if name in existing:
            self.note(f"{kind} {name!r}", False)
            return existing[name]["id"]
        body = {"kind": kind, "name": name}
        for key in ("description", "goal", "standard", "nextSteps", "deadline", "category"):
            if spec.get(key) is not None:
                body[key] = spec[key]
        row = self.post("/api/containers", body)
        self.note(f"{kind} {name!r}", True)
        # None on a dry run: there is no container to ask about, so its children are reported
        # wholesale rather than diffed against rows that do not exist.
        return row["id"] if row else None

    # -- tasks ---------------------------------------------------------------------
    def tasks(self, container_id, specs):
        if not specs:
            return
        if container_id is None:
            for spec in specs:
                self.note(f"task {(spec['title'] if isinstance(spec, dict) else spec)!r}", True)
            return
        have = {t["title"] for t in call(self.base, "GET", f"/api/tasks?container={container_id}&status=all")["tasks"]}
        for spec in specs:
            title = spec["title"] if isinstance(spec, dict) else spec
            if title in have:
                self.note(f"task {title!r}", False)
                continue
            body = {"title": title, "containerId": container_id}
            if isinstance(spec, dict):
                for key in ("notes", "dueDate", "priority", "estimateMinutes"):
                    if spec.get(key) is not None:
                        body[key] = spec[key]
            self.post("/api/tasks", body)
            self.note(f"task {title!r}", True)

    # -- notes ---------------------------------------------------------------------
    def notes(self, container_id, specs):
        if not specs:
            return
        if container_id is None:
            for spec in specs:
                self.note(f"note {spec['title']!r}", True)
            return
        have = {i["title"] for i in call(self.base, "GET", f"/api/items?container={container_id}&archived=1")}
        for spec in specs:
            if spec["title"] in have:
                self.note(f"note {spec['title']!r}", False)
                continue
            self.post("/api/items", {"type": "note", "title": spec["title"], "body": spec["body"], "containerId": container_id})
            self.note(f"note {spec['title']!r}", True)

    # -- goals ---------------------------------------------------------------------
    def goals(self, specs, by_name):
        if not specs:
            return
        have = {g["title"]: g for g in call(self.base, "GET", "/api/goals")["goals"]}
        for spec in specs:
            title = spec["title"]
            if title in have:
                self.note(f"goal {title!r}", False)
                goal_id = have[title]["id"]
            else:
                body = {"title": title, "horizon": spec.get("horizon", "year"), "targetDate": spec["targetDate"]}
                for key in ("outcome", "notes"):
                    if spec.get(key) is not None:
                        body[key] = spec[key]
                created = self.post("/api/goals", body)
                goal_id = created["id"] if created else None
                self.note(f"goal {title!r}", True)

            # Links are set rather than appended -- the endpoint replaces the whole set, so the
            # file stays the one description of what serves this goal.
            missing = [n for n in spec.get("links", []) if n not in by_name]
            if missing:
                raise ApiError(f"goal {title!r} links to {missing}, which the file does not define")
            wanted = [by_name[n] for n in spec.get("links", [])]
            if wanted and goal_id is not None and all(c is not None for c in wanted):
                call(self.base, "PUT", f"/api/goals/{goal_id}/links", {"containerIds": wanted})

    # -- the whole file ------------------------------------------------------------
    def run(self, plan):
        by_name = {}
        for kind in ("area", "project", "resource"):
            existing = self.containers(kind)
            for spec in plan.get(f"{kind}s", []):
                cid = self.container(kind, spec, existing)
                by_name[spec["name"]] = cid
                self.tasks(cid, spec.get("tasks"))
                self.notes(cid, spec.get("notes"))
        self.goals(plan.get("goals"), by_name)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", help="the programme JSON")
    ap.add_argument("--base", default="http://127.0.0.1:3141", help="where the app is serving")
    ap.add_argument("--dry-run", action="store_true", help="read the app, write nothing")
    args = ap.parse_args()

    with open(args.file, encoding="utf-8") as fh:
        plan = json.load(fh)

    loader = Loader(args.base.rstrip("/"), args.dry_run)
    try:
        loader.run(plan)
    except ApiError as err:
        # Partial loads are safe to retry: everything is keyed by name, so a second run picks up
        # where this one stopped. Said plainly rather than left to a traceback.
        print(f"error: {err}", file=sys.stderr)
        print(f"{len(loader.made)} written before stopping. Fix the cause and run it again.", file=sys.stderr)
        return 1

    verb = "would add" if args.dry_run else "added"
    print(f"{verb} {len(loader.made)}, left {len(loader.skipped)} already there")
    for what in loader.made:
        print(f"  + {what}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
