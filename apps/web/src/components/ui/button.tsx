"use client";

import {
  Button as HeroButton,
  type ButtonProps as HeroButtonProps,
} from "@heroui/react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";

export { buttonVariants };

type LegacyVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link";

type LegacySize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg";

const VARIANT: Record<LegacyVariant, HeroButtonProps["variant"]> = {
  default: "primary",
  outline: "outline",
  secondary: "secondary",
  ghost: "ghost",
  destructive: "danger",
  link: "ghost",
};

const SIZE: Record<LegacySize, HeroButtonProps["size"]> = {
  default: "md",
  xs: "sm",
  sm: "sm",
  lg: "lg",
  icon: "md",
  "icon-xs": "sm",
  "icon-sm": "sm",
  "icon-lg": "lg",
};

// size="md" passes through via Hero size union on ButtonProps.

export type ButtonProps = Omit<HeroButtonProps, "variant" | "size"> & {
  variant?: LegacyVariant | HeroButtonProps["variant"];
  size?: LegacySize | HeroButtonProps["size"];
  disabled?: boolean;
  onClick?: (e: unknown) => void;
};

export function Button({
  variant = "default",
  size = "default",
  disabled,
  isDisabled,
  isIconOnly,
  className,
  onClick,
  onPress,
  children,
  ...props
}: ButtonProps) {
  const mappedVariant =
    VARIANT[variant as LegacyVariant] ??
    (variant as HeroButtonProps["variant"]);
  const mappedSize =
    SIZE[size as LegacySize] ?? (size as HeroButtonProps["size"]);
  const iconOnly =
    isIconOnly ??
    (typeof size === "string" && size.startsWith("icon") ? true : undefined);

  return (
    <HeroButton
      variant={mappedVariant}
      size={mappedSize}
      isDisabled={isDisabled ?? disabled}
      isIconOnly={iconOnly}
      className={cn(
        mappedSize === "md" && !iconOnly && "h-8 min-h-8",
        variant === "link" && "underline underline-offset-4 px-0",
        className,
      )}
      onPress={(e) => {
        onPress?.(e);
        onClick?.(e);
      }}
      {...props}
    >
      {children}
    </HeroButton>
  );
}

