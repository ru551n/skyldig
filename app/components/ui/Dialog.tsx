import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Dialog as RadixDialog } from "radix-ui";

import { useT } from "~/i18n";

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
  const t = useT();
  // Dialogs here are usually opened from a plain button that sets state rather than from a
  // Dialog.Trigger, so Radix has no trigger to hand focus back to and closing drops focus on
  // <body>. Remember what was focused when the dialog opened and restore it on close.
  const previouslyFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
    }
  }, [open]);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <AnimatePresence>
        {open && (
          // Radix unmounts the portal itself as soon as `open` goes false, which would
          // skip the exit animation entirely. `forceMount` hands mount/unmount control
          // to AnimatePresence instead, which is the documented Radix pattern for
          // animating with an external animation library: the block above is only in
          // the tree while `open` is true (or while AnimatePresence is still playing
          // the exit), and Radix's own presence check (`forceMount || context.open`)
          // stays satisfied throughout.
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay className="bg-pine/40 fixed inset-0 z-40" />
            <RadixDialog.Content
              asChild
              forceMount
              onCloseAutoFocus={(event) => {
                const target = previouslyFocused.current;
                if (target?.isConnected) {
                  event.preventDefault();
                  target.focus();
                }
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="rounded-row border-line bg-paper fixed top-1/2 left-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 border p-6 shadow-none"
              >
                <RadixDialog.Title className="text-h2 text-pine font-semibold">
                  {title}
                </RadixDialog.Title>
                {description && (
                  <RadixDialog.Description className="text-body text-pine-soft mt-2">
                    {description}
                  </RadixDialog.Description>
                )}
                <div className="mt-4">{children}</div>
                <RadixDialog.Close asChild>
                  <button
                    type="button"
                    aria-label={t("common.close")}
                    className={cn(
                      "rounded-control text-pine-soft hover:bg-frost absolute top-4 right-4 flex h-9 w-9 items-center justify-center",
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
        )}
      </AnimatePresence>
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
  cancelLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useT();
  const confirmVariant: ButtonVariant = destructive ? "danger" : "primary";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={body}>
      <div className="mt-2 flex justify-end gap-3">
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
          {cancelLabel ?? t("common.cancel")}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
