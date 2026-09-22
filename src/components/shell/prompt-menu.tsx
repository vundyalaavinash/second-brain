"use client";

export interface PromptEntry {
  word: "note" | "link" | "task" | "search";
  label: string;
  hint: string;
}

/** The four things the bar can do, in the order the menu offers them. */
export const PROMPT_ENTRIES: PromptEntry[] = [
  { word: "note", label: "Note", hint: "Keep a thought" },
  { word: "link", label: "Link", hint: "Save a page" },
  { word: "task", label: "Task", hint: "! for high, fri for a due date" },
  { word: "search", label: "Search", hint: "Find anything" },
];

const OPTION = "flex items-center gap-3 px-2 h-9 rounded-sm cursor-pointer text-[13px] transition-colors duration-100";

/**
 * The slash menu above the prompt bar. Focus stays in the input, so the active entry is
 * named by `aria-activedescendant` rather than moved.
 */
export function PromptMenu({ activeIndex, onChoose }: { activeIndex: number; onChoose: (entry: PromptEntry) => void }) {
  const active = PROMPT_ENTRIES[activeIndex] ?? PROMPT_ENTRIES[0];
  return (
    <div
      role="listbox"
      aria-label="Prompt commands"
      aria-activedescendant={`prompt-option-${active.word}`}
      className="panel absolute bottom-full left-0 right-0 mb-2 rounded-md p-1 flex flex-col gap-0.5 z-40"
    >
      {PROMPT_ENTRIES.map((entry, i) => (
        <div
          key={entry.word}
          id={`prompt-option-${entry.word}`}
          role="option"
          aria-selected={i === activeIndex}
          // Keeps the caret in the input: the menu is driven from there.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChoose(entry)}
          className={`${OPTION} ${i === activeIndex ? "bg-layer-3 text-fg" : "text-fg-muted hover:bg-layer-3"}`}
        >
          <span className="font-mono text-[12px] text-violet-bright">/{entry.word}</span>
          <span>{entry.label}</span>
          <span className="ml-auto text-[11.5px] text-fg-faint">{entry.hint}</span>
        </div>
      ))}
    </div>
  );
}
