import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_BASE =
  "focus-ring inline-flex items-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none";
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-bg hover:brightness-110",
  secondary: "border border-line-strong bg-surface-1 text-fg hover:bg-surface-2",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
};
const BUTTON_SIZE = { sm: "h-7 px-2.5 text-[12px]", md: "h-8 px-3 text-[13px]" } as const;

type ButtonVisualProps = { variant?: ButtonVariant; size?: "sm" | "md"; icon?: LucideIcon; children?: ReactNode };
type ButtonAnchorProps = Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "aria-label" | "title" | "target" | "rel">;

type ButtonProps =
  | (ButtonHTMLAttributes<HTMLButtonElement> & ButtonVisualProps & { href?: undefined })
  | (ButtonAnchorProps & ButtonVisualProps & { href: string });

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  href,
  className = "",
  children,
  "aria-label": ariaLabel,
  title,
  ...props
}: ButtonProps) {
  const cls = `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`;
  if (href) {
    const { target, rel } = props as ButtonAnchorProps;
    return (
      <Link href={href} className={cls} aria-label={ariaLabel} title={title} target={target} rel={rel}>
        {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />}
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} aria-label={ariaLabel} title={title} {...props}>
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  active = false,
  danger = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; active?: boolean; danger?: boolean }) {
  const tone = danger ? "text-danger hover:bg-danger/10" : active ? "text-accent bg-accent-dim" : "text-fg-muted hover:text-fg hover:bg-surface-2";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`focus-ring inline-flex items-center justify-center w-8 h-8 rounded-sm transition-colors duration-150 disabled:opacity-40 ${tone} ${className}`}
      {...props}
    >
      <Icon className="w-4 h-4" aria-hidden />
    </button>
  );
}

// Appended size utilities do not override these (Tailwind orders by value); use the `size` prop.
const FIELD = "focus-ring w-full rounded-md border border-line bg-surface-2 px-3 text-fg placeholder:text-fg-faint transition-colors duration-150 hover:border-line-strong focus:border-line-strong";

const FIELD_SIZE = { sm: "h-8 text-[12.5px]", md: "h-9 text-[13.5px]" } as const;
const TEXTAREA_SIZE = { sm: "text-[12.5px]", md: "text-[13.5px]" } as const;

export function Input({
  size: fieldSize = "md",
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: "sm" | "md" }) {
  return <input className={`${FIELD} ${FIELD_SIZE[fieldSize]} ${className}`} {...props} />;
}

export function Textarea({
  size = "md",
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: "sm" | "md" }) {
  return <textarea className={`${FIELD} py-2 leading-relaxed resize-y ${TEXTAREA_SIZE[size]} ${className}`} {...props} />;
}

export function Select({
  size: fieldSize = "md",
  className = "",
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "sm" | "md" }) {
  return (
    <select
      className={`${FIELD} ${FIELD_SIZE[fieldSize]} pr-8 appearance-none bg-no-repeat bg-[right_0.6rem_center] ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239b9ba4' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")",
      }}
      {...props}
    />
  );
}

type ChipVisualProps = { icon?: LucideIcon; active?: boolean; children?: ReactNode };
type ChipAnchorProps = Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "aria-label" | "title" | "target" | "rel">;

type ChipProps =
  | (ButtonHTMLAttributes<HTMLButtonElement> & ChipVisualProps & { href?: undefined; as?: "span" })
  | (ChipAnchorProps & ChipVisualProps & { href: string; as?: undefined });

/** A small selectable pill: filters, homes, tags. */
export function Chip({
  icon: Icon,
  active = false,
  href,
  as,
  className = "",
  children,
  "aria-label": ariaLabel,
  title,
  ...props
}: ChipProps) {
  const cls = `focus-ring inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] transition-colors duration-150 ${
    active ? "border-accent/60 bg-accent-dim text-fg" : "border-line text-fg-muted hover:text-fg hover:border-line-strong"
  } ${className}`;
  if (href) {
    const { target, rel } = props as ChipAnchorProps;
    return (
      <Link href={href} className={cls} aria-label={ariaLabel} title={title} target={target} rel={rel}>
        {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />}
        {children}
      </Link>
    );
  }
  if (as === "span") {
    return (
      <span className={cls} aria-label={ariaLabel} title={title}>
        {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />}
        {children}
      </span>
    );
  }
  return (
    <button type="button" className={cls} aria-label={ariaLabel} title={title} {...props}>
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />}
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function PageHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 mb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-medium tracking-[-0.02em]">{title}</h1>
        {meta && <div className="mt-1 text-[12.5px] text-fg-muted">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export function SectionHeading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-[13px] font-medium text-fg mb-2">
      {children}
      {count !== undefined && <span className="font-mono text-[11px] text-fg-faint">{count}</span>}
    </h2>
  );
}

export function EmptyState({ icon: Icon, text, action }: { icon: LucideIcon; text: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line-strong px-6 py-10 flex flex-col items-center text-center gap-3">
      <span className="w-10 h-10 rounded-full bg-surface-2 border border-line flex items-center justify-center text-fg-muted">
        <Icon className="w-[18px] h-[18px]" aria-hidden />
      </span>
      <p className="text-[13.5px] text-fg-muted max-w-xs">{text}</p>
      {action}
    </div>
  );
}

/** The list container and its row. Rows are edge-to-edge inside one bordered surface. */
export function List({ children }: { children: ReactNode }) {
  return <ul className="rounded-md border border-line bg-surface-1 divide-y divide-line overflow-hidden">{children}</ul>;
}

export function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <li className={`flex items-center gap-3 px-3 h-10 hover:bg-surface-2 transition-colors duration-150 ${className}`}>{children}</li>;
}
