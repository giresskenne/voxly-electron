import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import { createRendererLogger } from "../lib/debug-log";

const log = createRendererLogger("controls");

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  active?: boolean;
};

export function IconButton({ label, children, active, className, onClick, ...props }: IconButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    log.debug("Icon button clicked", { label, active });
    onClick?.(event);
  }

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn("icon-button glass-btn", active && "is-active", className)}
      onClick={handleClick}
      {...props}
    >
      <span className="control-content">{children}</span>
    </button>
  );
}

type TextButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "glass" | "quiet";
};

export function TextButton({ children, variant = "glass", className, onClick, ...props }: TextButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    log.debug("Text button clicked", { variant, text: event.currentTarget.innerText });
    onClick?.(event);
  }

  return (
    <button type="button" className={cn("text-button", `text-button--${variant}`, className)} onClick={handleClick} {...props}>
      <span className="control-content">{children}</span>
    </button>
  );
}
