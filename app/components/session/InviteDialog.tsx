import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { Button, Dialog, QrCode } from "~/components/ui/index.ts";
import { useT } from "~/i18n";

type InviteActionData =
  | { ok: true; url: string; expiresAt: string; ttlMs: number }
  | { ok: false; code: "RATE_LIMITED"; retryAfterSeconds: number };

export interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dedicated invite-create resource route for this group, e.g. `/s/abc123/bjud-in`. */
  action: string;
}

/**
 * "Bjud in" — creates a single-use invite link/QR that grants access without ever putting
 * the group's access phrase in a URL. See docs/todo.md "Share a group by QR code or link".
 * Each open of the dialog issues a fresh invite; closing and reopening issues another (the
 * previous one is simply left to expire after INVITE_TTL_MS, it is not revoked).
 */
export function InviteDialog({ open, onOpenChange, action }: InviteDialogProps) {
  const t = useT();
  const fetcher = useFetcher<InviteActionData>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && fetcher.state === "idle" && !fetcher.data) {
      fetcher.submit({ _intent: "invite" }, { method: "post", action });
    }
    // Only re-run when the dialog opens; a fresh invite per open is intentional, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setCopied(false);
  }

  const result = fetcher.data;
  const url = result?.ok ? result.url : undefined;
  const rateLimited = result && !result.ok && result.code === "RATE_LIMITED";

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — the link is still visible and selectable.
    }
  }

  async function handleShare() {
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ url, title: t("invite.shareTitle") });
        return;
      } catch {
        // Cancelled or unsupported — fall through to clipboard.
      }
    }
    void handleCopy();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("invite.title")}
      description={t("invite.description")}
    >
      <div className="flex flex-col items-center gap-4">
        {url ? (
          <>
            <div className="rounded-card border-line border p-3">
              <QrCode value={url} size={200} title={t("invite.qrAlt")} />
            </div>
            <p className="text-meta text-pine-soft w-full text-center break-all">{url}</p>
            <div className="flex w-full gap-2">
              <Button type="button" variant="secondary" fullWidth onClick={handleCopy}>
                {copied ? t("common.copied") : t("common.copy")}
              </Button>
              <Button type="button" fullWidth onClick={handleShare}>
                {t("invite.share")}
              </Button>
            </div>
            <p className="text-meta text-pine-soft text-center">{t("invite.hint")}</p>
          </>
        ) : rateLimited ? (
          <p role="alert" className="text-body text-rust" aria-live="polite">
            {t("invite.rateLimited")}
          </p>
        ) : (
          <p className="text-body text-pine-soft" aria-live="polite">
            {t("invite.creating")}
          </p>
        )}
      </div>
    </Dialog>
  );
}
