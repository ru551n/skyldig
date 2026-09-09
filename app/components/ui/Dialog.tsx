import { motion } from "motion/react";
import { Dialog as RadixDialog } from "radix-ui";

import { Button, type ButtonVariant } from "./Button.tsx";
import { cn } from "./cn.ts";

export const DialogRoot = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  trigger?: React.ReactNode;
}

/** Radix dialog styled per the design system: 20px radius, focus trap, scale-in 0.96→1 over 160ms. */
export function Dialog({ open, onOpenChange, title, description, children, trigger }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-pine/40" />
        <RadixDialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-row border border-line bg-paper p-6 shadow-none"
          >
            <RadixDialog.Title className="text-h2 font-semibold text-pine">{title}</RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="mt-2 text-body text-pine-soft">
                {description}
              </RadixDialog.Description>
            )}
            <div className="mt-4">{children}</div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Stäng"
                className={cn(
                  "absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-control text-pine-soft hover:bg-frost",
                )}
              >
                <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </RadixDialog.Close>
          </motion.div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}

/** A Dialog pre-wired for a confirm/cancel action, e.g. deletes. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = "Avbryt",
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const confirmVariant: ButtonVariant = destructive ? "danger" : "primary";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={body}>
      <div className="mt-2 flex justify-end gap-3">
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
