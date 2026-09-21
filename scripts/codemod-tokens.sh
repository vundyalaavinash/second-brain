# scripts/codemod-tokens.sh — one-shot rename of retired token classes; kept for the record.
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
files=$(grep -rlE 'bg-bg|bg-surface-|border-line|divide-line|text-accent|bg-accent|border-accent|accent-accent|text-bg|frost|bg-\[rgba\(24,24,28,0\.95\)\]' src --include='*.tsx' --include='*.ts' || true)
for f in $files; do
  perl -pi -e '
    s/\bhover:bg-surface-3\b/hover:bg-slate-2/g; s/\bhover:bg-surface-2\b/hover:bg-slate-2/g; s/\bhover:bg-surface-1\b/hover:bg-slate/g;
    s/\bbg-surface-3\b/bg-slate-2/g; s/\bbg-surface-2\b/bg-slate/g; s/\bbg-surface-1\b/bg-slate/g;
    s/\bbg-bg\b/bg-ink/g;
    s/\bborder-line-strong\b/border-hairline-strong/g; s/\bborder-line\b/border-hairline/g; s/\bdivide-line\b/divide-hairline/g;
    s/\bfocus:border-line-strong\b/focus:border-hairline-strong/g; s/\bhover:border-line-strong\b/hover:border-hairline-strong/g;
    s/\bbg-accent-dim\b/bg-brass-dim/g; s/\bbg-accent\b/bg-brass/g; s/\btext-accent\b/text-brass/g; s/\bborder-accent\b/border-brass/g; s/\baccent-accent\b/accent-brass/g;
    s/\btext-bg\b/text-brass-ink/g;
    s/\bfrost\b/panel/g;
    s/bg-\[rgba\(24,24,28,0\.95\)\]/bg-slate/g;
  ' "$f"
done
echo "codemod applied to $(echo "$files" | wc -w | tr -d " ") files"
