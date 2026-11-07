import { cn } from "@/lib/utils";

type LegacyVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link"
  | "primary"
  | "danger"
  | "tertiary";

type LegacySize =
  | "default"
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg";

const VARIANT: Record<string, string> = {
  default: "button--primary",
  primary: "button--primary",
  outline: "button--outline",
  secondary: "button--secondary",
  ghost: "button--ghost",
  tertiary: "button--tertiary",
  destructive: "button--danger",
  danger: "button--danger",
  "danger-soft": "button--danger-soft",
  link: "button--ghost",
};

const SIZE: Record<string, string> = {
  default: "button--md",
  xs: "button--sm",
  sm: "button--sm",
  md: "button--md",
  lg: "button--lg",
  icon: "button--md",
  "icon-xs": "button--sm",
  "icon-sm": "button--sm",
  "icon-lg": "button--lg",
};

/** Server-safe class helper — mirrors HeroUI buttonVariants without client imports. */
export function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: LegacyVariant;
  size?: LegacySize;
  className?: string;
} = {}) {
  const mappedSize = SIZE[size] ?? "button--md";
  return cn(
    "button",
    mappedSize,
    VARIANT[variant] ?? "button--primary",
    mappedSize === "button--md" && "h-8 min-h-8",
    variant === "link" && "underline underline-offset-4 px-0",
    className,
  );
}
