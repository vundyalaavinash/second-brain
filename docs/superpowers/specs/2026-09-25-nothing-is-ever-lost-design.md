# Nothing Is Ever Lost

**Date:** 2026-09-25
**Status:** approved

## 1. Why this comes first

The app is about to hold work that matters rather than six test notes. Every
slice after this one adds a table and a migration. So the safety net goes in
before the things that would test it, not after.

I read what exists rather than assuming. The honest position is that the
foundations are better than I expected and the gaps are specific.

**What already works.** A nightly job takes an online backup of the database
through SQLite's own backup API, copies the attachments directory beside it, and
prunes both to the newest seven. Boot queues it if today's is missing and checks
again every six hours. Migrations run in one place, through `openDatabase`, so
there is no second path that could apply them differently. `foreign_keys = ON`
and `busy_timeout` are set on every connection. None of that needs rebuilding.

**What is missing, and one thing that is already wrong.**

**A backup is never verified.** The job writes a file and prunes the old ones. It
never opens what it wrote. A backup that cannot be opened is not a backup, and
the only moment you discover it is the moment you needed it.

**There is no backup immediately before a migration.** `openDatabase` runs
`migrate()` on every open. A bad migration applied at nine in the morning leaves
last night's file as the newest recovery point, so the day's work is what a
mistake costs.

**Nothing ever checks the database is sound.** No `integrity_check`, no
`foreign_key_check`, not on boot, not on backup, not anywhere.

**There is no way to restore.** No command, no documented procedure. Recovering
means knowing to stop the server, knowing which file, and knowing what to do
about the write-ahead log. At the moment you need that knowledge you will be
least able to reconstruct it.

**Seven days is thin.** A problem noticed in week three has no recovery point.
These files are about two megabytes.

**And the thing that is already wrong.** The backups directory currently holds
`brain-2026-09-24.db-wal`, `brain-2026-09-24.db-shm` and the same pair for one of
the pre-migration snapshots. Something opened those backups read-write — a review
probe, checking a migration against a copy. Two consequences. The prune's pattern
is `^brain-.*\.db$`, which does not match a `-wal` suffix, so those files will
never be cleaned up and will accumulate. And a backup with a stale write-ahead
log beside it is a trap: copy only the `.db` and you may lose committed data that
lives in the log; copy all three and you may restore an inconsistent set. Nobody
has lost anything yet. The mechanism to lose something exists.

## 2. The rule this is built on

**A backup you have not opened is a rumour.** Every safety feature here follows
from that. Writing a file is the easy half; the half that matters is proving the
file would work.

Two more rules that shape the design:

**Nothing destructive happens without the thing it replaces being kept.** A
restore does not delete the database it replaces. It moves it aside with a name
you can find. The worst realistic outcome of a restore is two databases on disk.

**The app tells you when it cannot vouch for itself.** Silence means checked and
sound, not unchecked.

## 3. Verified backups

After the backup job writes its file it opens it as a separate read-only
connection and runs `integrity_check` and a count of one core table. Three
outcomes:

- **Sound.** The file is stamped as verified and the prune runs.
- **Unreadable or failing the check.** The file is deleted, the previous
  backups are left alone, and the failure is recorded loudly. A bad file that
  looks like a backup is worse than a gap, because it is the one you would
  reach for.
- **The check cannot run at all.** Treated as a failure. There is no benefit of
  the doubt here.

The backup is taken with the write-ahead log checkpointed into the main file, so
what lands on disk is one self-contained database with no sidecars. SQLite's
backup API already does this; the verification is what proves it.

## 4. Before every migration

`openDatabase` asks what migrations have already been applied before running any.
When the answer is "some are pending", it takes a snapshot first, named for the
migration it is about to attempt, and only then migrates.

Three properties matter:

- **It runs only when there is something to apply.** The database is opened
  constantly. A snapshot on every open would be both slow and useless.
- **It is checked afterwards.** A migration that completes and leaves the
  database failing `integrity_check` is worse than one that fails outright,
  because it looks like success.
- **It says what it did.** "Snapshot taken before 0016_commitments" in the log,
  so the file's name tells you what it is from without opening it.

Pre-migration snapshots keep their own retention, longer than the nightly ones,
because they mark the exact boundaries where the shape of the data changed.

## 5. Retention that survives noticing late

Three tiers, all on the same files, all cheap:

| Tier | Kept |
| --- | --- |
| Daily | 7 |
| Weekly | 4 |
| Monthly | 6 |

Seven days of daily, then one a week for a month, then one a month for half a
year. About seventeen files at roughly two megabytes each. That is the difference
between "I noticed today" and "I noticed eventually".

The prune also removes orphaned `-wal` and `-shm` files in the backups directory,
because they exist there today, the current pattern cannot see them, and they are
exactly the thing that makes a restore ambiguous.

## 6. Restoring

`scripts/brain.sh` gains three commands.

**`backup`** takes one now and verifies it, so there is a way to say "before I do
this thing".

**`verify`** opens every backup in the directory, runs the checks, and prints one
line per file: its date, its size, and whether it is sound. Running this is how
you find out your safety net is real. Nothing else in the design tells you that.

**`restore [file]`** is the one that matters and the one written most carefully:

1. With no argument it lists what is available and stops. It never guesses.
2. It verifies the chosen file **before** touching anything. An unsound backup is
   refused outright.
3. It stops the server, so nothing is writing.
4. It moves the current database aside to `brain-replaced-<timestamp>.db` rather
   than deleting it, along with its sidecars.
5. It copies the backup into place, restores the matching attachments directory
   when one exists for that date, and starts the server.
6. It prints where the replaced database went, in a form you could paste back.

Every step is reversible until the last, and the last keeps what it replaced.

## 7. The app knows its own state

A small section on the Settings surface, or the Activity page until one exists,
reporting: when the last backup ran, whether it verified, how many recovery
points exist and how far back they reach, and the result of the last integrity
check.

One line when all is well. When the last backup failed, or the newest is older
than two days, it says so where it will be seen rather than only in a log nobody
reads.

## 8. Boot checks itself

On start, `integrity_check` and `foreign_key_check`, both fast on a database this
size. A failure is logged loudly, surfaced in the app, and — this is the point —
**does not** trigger anything automatic. No auto-restore, no self-repair. A
program that tries to fix its own corruption unattended is how a recoverable
problem becomes an unrecoverable one. It tells you, and it tells you what command
to run.

## 9. Audio is the disposable part

A meeting's transcript is a few kilobytes of text. Its recording is about 115
megabytes per hour at the rate the helper captures, and several meetings a day
becomes gigabytes a week. Nothing deletes them today, so the only reason the disk
is not filling is that no meeting has been recorded for real yet. That makes this
the right moment to decide, rather than the moment after.

The position is simple: **the transcript is the record and the audio is
scaffolding.** Keep the first forever, keep the second only as long as it might
still be needed.

### 9.1 The rule that cannot be broken

**Audio with no transcript is never deleted.** If transcription failed, was never
run, or produced nothing, the recording is the only copy of what was said and
deleting it destroys the meeting. A retention window is a promise about
disposable data; untranscribed audio is not disposable.

This is checked at the moment of deletion, not assumed from a flag set earlier.

### 9.2 The window

A setting, `meetings.audioRetentionDays`, defaulting to **7**:

| Value | Meaning |
| --- | --- |
| `0` | Release the audio as soon as a transcript exists |
| `1`–`365` | Keep it that many days past the recording's end |
| `null` | Keep it forever |

Seven days out of the box because a week is long enough to notice a bad
transcript and re-run it, and short enough that a busy fortnight does not cost
ten gigabytes.

### 9.3 What happens, and what is said afterwards

The nightly job that already prunes activity and takes the backup gains one more
pass. For each recording past the window with a transcript: delete the file,
record `audioReleasedAt` in the item's meta, and leave everything else alone.

The meeting page then says so plainly — "Audio removed on 3 October; the
transcript is kept" — rather than offering a player for a file that is not there.
A missing file with no explanation reads as a bug; a sentence reads as a policy.

The same pass sweeps orphans: a `.wav` under the meetings directory that no item
points at, left behind by a deleted meeting, goes too.

### 9.4 Seeing it, and doing it now

Wherever the app reports on itself it also reports audio: how many recordings are
held, how much space they take, and when the next release is due. One line, and
it is the line that makes the policy real rather than theoretical.

A meeting whose transcript is good gains a "Remove the audio" action, for
reclaiming a large file now rather than in six days.

### 9.5 Backups are not the problem here

Worth recording because it looks like it should be. The nightly backup copies the
attachments directory; meeting audio lives under `files/meetings`, which it does
not copy. So the seven daily backups do not hold seven copies of every recording.
That is the right arrangement and this design does not change it: audio that is
about to be deleted on purpose has no business being duplicated into a backup
set first.

## 10. What this does not build

- **No cloud or off-machine backup.** Everything stays on this machine. That is a
  real limitation and it is the user's call to make, not mine to make for them.
  §10 names it as the one gap worth closing next.
- **No automatic restore, ever.** See §8.
- **No point-in-time recovery.** Daily granularity plus a pre-migration snapshot
  is proportionate here. A write-ahead-log archive is not.
- **No encryption at rest.** The disk is already encrypted by FileVault on this
  machine, and a second key to lose helps nobody.
- **No archiving of audio anywhere else before it is deleted.** §9 releases the
  recording because the transcript is the record. Quietly copying it somewhere
  first would defeat the point of asking for a retention policy at all.

## 11. The gap this leaves

Every copy is on one disk. A disk failure, a lost laptop or a mistaken `rm -rf`
of the data directory takes the backups with the original. Nothing in this design
survives that.

Closing it means a copy somewhere else, which means deciding where, and that is a
decision about a private second brain that belongs to its owner. The honest thing
is to build the local net properly, name this gap plainly, and ask rather than
quietly ship something that uploads.
