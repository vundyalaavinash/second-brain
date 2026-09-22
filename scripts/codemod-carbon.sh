#!/usr/bin/env bash
# scripts/codemod-carbon.sh — one-shot rename of the paper/brass tokens to carbon/violet; kept for the record.
set -euo pipefail
cd "$(dirname "$0")/.."
files=$(grep -rlE 'bg-ink|bg-slate|brass|shadow-dock' src --include='*.tsx' --include='*.ts' || true)
for f in $files; do
  perl -pi -e '
    s/\bhover:bg-slate-2\b/hover:bg-layer-2/g; s/\bhover:bg-slate\b/hover:bg-layer-1/g;
    s/\bbg-slate-2\b/bg-layer-2/g; s/\bbg-slate\b/bg-layer-1/g; s/\bbg-ink\b/bg-carbon/g;
    s/\btext-brass-ink\b/text-on-violet/g; s/\bbg-brass-dim\b/bg-violet-dim/g; s/\bbg-brass\b/bg-violet/g;
    s/\btext-brass\b/text-violet-bright/g; s/\bborder-brass\b/border-violet/g; s/\baccent-brass\b/accent-violet/g;
    s/\bshadow-dock\b/shadow-pop/g;
  ' "$f"
done
echo "codemod applied to $(echo "$files" | wc -w | tr -d " ") files"
