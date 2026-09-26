# Distill

**Date:** 2026-09-26
**Status:** approved

## 1. Why this comes now

A second brain is supposed to do four things: capture, organize, distill,
express. This app already does the first two well — capture is a real flow,
not an afterthought, and Projects/Areas/Resources/Archive is the actionability
split verbatim. Distill is the one piece that was never built. Every note and
every captured link sits exactly as long as it was written, unchanged, for as
long as it lives here. Opening a six-month-old note costs the same full read
it cost the day it was written. That is the gap this spec closes.

Express — surfacing a past note to help with something new — is also
incomplete (semantic search exists, but nothing resurfaces a note
proactively), but that is a different, larger problem and deliberately out of
scope here. This spec is Distill alone.

## 2. The rule this is built on

**A distillation may only ever contain what was already there.** A quote is
either a real, verbatim substring of the note's own text, or it does not
appear at all — never a paraphrase presented as a quote, never a plausible
sentence the extraction merely thinks fits. This is the same principle this
codebase has enforced for numbers (a forecast below the minimum sample size is
`null`, never a guess) applied to text: an untrustworthy quote is worse than
no quote, because a quote *looks* like evidence.

Two more rules that shape the design:

**Distill offers, it never decides.** Exactly the pattern already proven
twice in this codebase — the meeting-to-container suggestion, and the
meeting's own summary — a distillation is proposed, sits next to the note
until a person accepts or dismisses it, and the note's own content is never
touched. Accepting or dismissing is the whole interaction; there is no
per-quote picking apart, because the note was never at risk either way.

**No new spending category, no new service.** The person building this has no
Claude access and does not want a recurring cost. Distill therefore runs
entirely offline: a deterministic algorithm does the part that must never be
wrong (choosing the quotes), and a small model running on the person's own
machine does the part that benefits from a written sentence (the gist). If
the model isn't there, distillation for that note simply doesn't happen —
the same "quietly does nothing without what it needs" behaviour meeting
summaries already have without an API key.

## 3. What gets distilled, and when

**Scope: notes, links, and files** — the three item types this was actually
missing for. Meetings already have their own summary (decisions, actions).
Journal entries and weekly reviews are personal reflection, not reference
material, and stay as they are.

**Trigger: a periodic sweep, not a live listener.** A meeting gets summarized
the instant its transcription finishes — there's no equivalent "finished"
moment for a note someone might return to and keep editing for days. So a
background job, on the same kind of schedule the nightly backup already uses,
periodically scans for candidates in one grouped query:

- type is `note`, `link`, or `file`
- not archived
- has not been touched in the last 30 minutes (long enough that a burst of
  active editing has clearly ended)
- has no `meta.distillation` yet
- has at least 40 words of real content (`body` and `extractedText`
  combined) — short enough content isn't worth the treatment

**One-shot, sticky, like a meeting's summary.** A distillation is generated
once. Once it is kept or dismissed, it is never regenerated, even if the note
is heavily rewritten afterward — the same one-shot behaviour meeting
summaries already have (nothing re-summarizes a meeting after its notes are
edited). This keeps "kept" a stable fact you can trust hasn't silently
changed under you, and it keeps a "not useful" decision permanent rather than
nagging again next sweep. The known cost: a note that changes meaning
substantially after being distilled keeps its old distillation. Accepted for
this version; a manual re-run is a natural, cheap addition later if it turns
out to matter in practice.

## 4. What a distillation actually is

No new table. A distillation lives in the item's existing `meta` JSON blob,
exactly where a meeting's summary already lives:

```ts
interface Distillation {
  gist: string;         // one short paragraph, model-written
  quotes: string[];     // 3-5 excerpts, each a verified exact substring
                         // of the item's own body/extractedText
  generatedAt: string;  // ISO instant
  status: "pending" | "kept" | "dismissed";
}
```

A suggested quote that is not, in fact, an exact substring of the source text
is dropped before the distillation is ever written — never shown, never
retried into shape. If dropping bad quotes leaves fewer than 2 real ones, the
whole distillation is discarded rather than offered half-broken; the sweep
will not try that item again (it now has `status: "pending"` with an empty
result recorded, so it isn't re-attempted every run — see §7 for the exact
failure shape).

## 5. How the quotes and the gist are actually produced

**Quotes: pure extraction, no model.** A standard word-frequency
sentence-scoring pass (the same family as classic extractive summarizers like
Luhn's algorithm or TextRank) splits the text into sentences, scores each one
by how many "significant" words it contains (weighted by how rare those words
are across the note), and keeps the top 3-5 by score, in their original
order. This is a pure function of the text: deterministic, fast, and
incapable of inventing anything, because it only ever selects sentences that
were already there.

**Gist: a small local model paraphrases the already-selected quotes, not the
whole note.** Turning 3-5 short sentences into one smoother paragraph is a
far easier job than reading and understanding an arbitrary-length document,
so a genuinely small model can do it adequately — this is what makes running
locally realistic rather than requiring the person's machine to host
something heavyweight.

**Model:** a small instruction-tuned model in the 0.5-1B parameter range
(e.g. Qwen2.5-0.5B-Instruct or Llama-3.2-1B-Instruct), quantized to a GGUF
file (roughly 300-800MB on disk), run through `llama.cpp` in single-shot
inference mode — no long-running server process, no persistent memory cost.
`llama.cpp` mmaps the model file lazily, so it costs disk space when idle and
CPU/RAM only for the moment of that one call.

**Model management mirrors the existing whisper.cpp pattern exactly** — this
app already solves "manage a local model file for on-device inference" for
transcription, and Distill reuses that shape rather than inventing a second
one:

- `scripts/brain.sh setup` gains a `download_gist_model` step, structured
  like `download_whisper_models`: fetch the GGUF file into
  `$DATA_DIR/models/gist/` if not already present.
- A new `src/providers/gist/` module, shaped like `src/providers/chat/`:
  `hasGistModel(db)` checks the model file exists; `getGistProvider(db)`
  returns `null` when it doesn't, so every caller treats "no model" as "this
  feature is off" — the identical on/off shape `hasChatKey`/`getChatProvider`
  already establish for the cloud path.
- The provider shells out to the `llama.cpp` binary for one inference call
  per note and returns the paragraph. No provider abstraction is shared with
  the Anthropic-backed `ChatProvider` — Distill's local path and meeting
  summarization's cloud path are two separate, independent integrations, by
  design (§2's "no new spending category" is specific to Distill; it is not
  a decision to migrate meeting summaries off Anthropic, which stays exactly
  as it is today).

## 6. Where it shows up

**The pending offer.** On a note, link, or file's own page
(`src/components/item-editor.tsx`, which already renders a row of chips for
container/tags/people above the editor body), a distillation waiting on a
decision renders as a `pane`-styled offer card in that same slot — visually
the same treatment as the meeting-to-container suggestion band:

- the gist, as plain text
- the quotes, each its own `Chip`, matching how tags and people already
  render in that row
- two buttons: **Keep** and **Not useful** — one decision for the whole
  distillation, never a per-quote choice (§2)

**After Keep**, the offer card becomes a permanent, non-dismissible
**"Distilled"** section in the same slot: the gist and quotes, always visible
whenever the item is opened. A small `Chip` badge also appears wherever this
item is listed elsewhere in the app (the same badge-row pattern meeting rows
already use for Notes/Transcript/Summary), so a distilled item is visibly
flagged before it's even opened.

**After Not useful**, the card disappears immediately. Nothing further is
stored beyond `status: "dismissed"`, and the sweep never reconsiders that
item.

**For browsing everything distilled at once**, `/library`'s existing
filter-chip row (type, status, tag) gains a **"Distilled"** chip. This is the
actual "fast to review later" surface the CODE method is describing — no new
digest page is needed for version one, because Library already gives a
filterable, cross-item view for free.

## 7. Failure handling

**No model present:** the sweep skips the item silently, exactly like
meeting summarization skips silently without an API key. No error is shown
anywhere; a missing distillation is not a broken feature, it's an absent
nicety.

**Model call fails, or every suggested quote fails verification:** recorded
as `meta.distillation = { gist: "", quotes: [], generatedAt, status:
"dismissed" }` — a deliberately inert, already-dismissed record, so the
sweep's own "no `meta.distillation` yet" candidate check correctly stops
retrying that item on every future run without needing a second field to
track "this one failed." A systematically-failing item (one that always
degenerates below 2 verified quotes) costs at most one wasted local
inference call, once, ever.

**Extremely short or malformed source text:** caught before any model call
by the same word-count threshold that gates the sweep in the first place
(§3) — nothing about the extraction or gist step needs its own separate
length guard.

## 8. Testing

- The extractive scorer is a pure function: given text, assert which
  sentences win, including a case with fewer than 3 candidate sentences and
  a case where two sentences tie.
- The quote-verification step (exact-substring check) is tested with a
  quote that's a genuine substring, one that's close-but-not-exact
  (paraphrased, whitespace-differs), and one that's entirely fabricated.
- The sweep job's candidate query is tested the way every other list-cost
  function in this codebase now is: assert it executes as one grouped
  query regardless of how many candidates exist (`spyOn(db, "select")`,
  the same pattern this slice's own Task 3 and Task 4 reviews required).
- The local-model call is mocked in tests via an injected provider,
  exactly like `ChatProvider` is injected for meeting-summary tests — no
  test ever actually shells out to `llama.cpp`.
- The offer/keep/dismiss UI is tested the same way the meeting suggestion
  chip's accept/dismiss already is.

## 9. Explicitly out of scope for this version

- **Per-quote accept/reject.** One decision for the whole distillation
  (§2, §6).
- **A manual "distill this now" button or re-run after edits.** Automatic
  sweep only, one-shot only (§3).
- **A dedicated cross-note digest/review page.** Library's filter chip
  covers the "browse what's distilled" need (§6); a digest page is a
  natural, separate later addition if it turns out to be wanted.
- **Journal entries and weekly reviews.** Personal reflection, not
  reference material (§3).
- **Any cloud/paid-API path for Distill.** Fully offline by design (§2,
  §5); a future paid-API option, if ever wanted, is a new decision, not an
  extension of this one.
- **Any change to meeting summarization.** It stays on its existing
  Anthropic-backed path, unrelated to this feature (§5).
