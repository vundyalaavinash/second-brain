# Runbook

For when something is wrong and you are worried. Six situations, in order. Each answer is a
command and what it prints. Run these from the app's directory.

## The app will not start

    npm run status

Prints whether the launch agent is loaded, whether the server answers, and where its log is.

    npm run logs

Tails that log. Look for the last line before it stopped. If it names a bad migration, go to
"A migration went badly" below. Otherwise:

    scripts/brain.sh restart --build

## The app starts but the data looks wrong

    npm run logs

Look for a line starting `[boot] database integrity check`. `passed` means the database itself is
sound and the problem is elsewhere (a real edit, a sync issue). `FAILED` names what is wrong.
Either way:

    npm run verify

Prints one line per backup — its name, when it was written, its size, and `sound` or the first
problem. If a recent one is sound, go to "I want to go back to yesterday" below.

## A migration went badly

    npm run logs

Look for `[db] snapshot before <migration tag>` — the database from the moment before that
migration ran.

    scripts/brain.sh restore

Lists every backup and snapshot, sound or not, and stops. Find the `pre-<tag>-<stamp>.db` line
named in the log.

    scripts/brain.sh restore pre-<tag>-<stamp>.db

Walks the restore procedure below and prints each step as it happens.

## I want to go back to yesterday

    scripts/brain.sh restore

Lists what is available and stops — it never guesses. Find yesterday's `brain-<date>.db`.

    scripts/brain.sh restore brain-<date>.db

Verifies the file, asks for a typed `restore` to confirm, stops the server, moves the current
database aside to `brain-replaced-<timestamp>.db` (never deleted), copies the chosen backup into
place, restores that date's attachments if there are any, and starts the server back up. It prints
the replaced database's path last, in a form you can paste back if this was the wrong file.

## How do I check my backups are real?

    npm run verify

Opens every backup, runs the same checks a restore would, and prints one line each: name, date,
size, and `sound` or the first problem. Exits with an error if any backup fails — this is the one
command that tells you the safety net is real rather than merely present.

    npm run backup

Takes one right now and verifies it, for "before I do this thing".

## Where does everything live on disk?

    npm run status

Prints the data directory on its `data:` line. Inside it:

| Path | What it is |
| --- | --- |
| `brain.db` | The live database |
| `backups/brain-<date>.db` | Nightly backups — daily for a week, then weekly, then monthly, six months back |
| `backups/pre-<tag>-<stamp>.db` | A snapshot taken just before each migration |
| `backups/attachments-<date>` | The attachments directory as of that night's backup |
| `backups/brain-replaced-<timestamp>.db` | A database a restore moved aside, kept, never deleted |
| `attachments/` | The live attachments |
| `logs/app.log` | The server log |

Every one of those is on this machine. There is no copy anywhere else: a disk failure, a lost
laptop, or a mistaken `rm -rf` of the data directory takes the backups with the original. Closing
that gap means a copy on a second machine or in the cloud, which is a decision about where a
private second brain's data goes — worth doing, and not one this runbook makes for you.
