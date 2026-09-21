"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";

export interface TagChipsProps {
  value: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
}

/** Inline tag chips over a controlled `string[]`. Click "Add tag" (or type) to open a small
 * input: Enter or a typed comma commits the current draft, Escape cancels it, and Backspace
 * on an empty draft removes the last tag. Each chip carries its own remove button. */
export function TagChips({ value, onChange, readOnly = false }: TagChipsProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function commit(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (!tag || value.includes(tag)) return;
    onChange([...value, tag]);
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (next.includes(",")) {
      const parts = next.split(",");
      const rest = parts.pop() ?? "";
      for (const part of parts) commit(part);
      setDraft(rest);
      return;
    }
    setDraft(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft);
      setDraft("");
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      removeAt(value.length - 1);
    } else if (e.key === "Escape") {
      setDraft("");
      setAdding(false);
    }
  }

  function handleBlur() {
    if (draft.trim()) commit(draft);
    setDraft("");
    setAdding(false);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {value.map((tag, i) => (
        <span key={tag} className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-paper-rule text-[12.5px] text-paper-fg">
          {tag}
          {!readOnly && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={`Remove tag ${tag}`}
              className="focus-ring rounded-full text-paper-muted hover:text-paper-fg"
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      {!readOnly &&
        (adding ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="Tag"
            className="focus-ring bg-transparent outline-none border-b border-paper-rule focus:border-brass text-[12.5px] w-24"
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="focus-ring text-paper-muted hover:text-paper-fg text-[12.5px]">
            Add tag
          </button>
        ))}
    </span>
  );
}
