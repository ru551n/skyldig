import { useEffect, useState } from "react";

import { Button } from "~/components/ui/index.ts";
import { useT } from "~/i18n";

/**
 * The "username" password managers file an admin key under. The group name alone is not unique
 * (two groups can both be called "Resa"), and a manager keys entries by username, so saving the
 * second would overwrite the first; the public id is not a credential — the group URL grants
 * nothing without an access grant — so it is safe to store alongside.
 */
export function adminKeyCredentialId(groupName: string, publicId: string): string {
  return `${groupName} (${publicId})`;
}

type PasswordCredentialCtor = new (data: { id: string; password: string; name?: string }) => Credential;

export interface AdminKeySaveActionsProps {
  groupName: string;
  publicId: string;
  adminKey: string;
}

/**
 * Two ways to keep the unrecoverable admin key, each shown only where the browser supports it
 * (detected after mount, so the server render and hydration agree): an explicit save to the
 * password manager via the Credential Management API (Chromium-based browsers), and the system
 * share sheet (mostly phones). Other browsers still offer to save the key when it is typed into
 * the Admin page's unlock form, which is marked up for password managers.
 */
export function AdminKeySaveActions({ groupName, publicId, adminKey }: AdminKeySaveActionsProps) {
  const t = useT();
  const [canStore, setCanStore] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanStore("PasswordCredential" in window && typeof navigator.credentials?.store === "function");
    setCanShare(typeof navigator.share === "function");
  }, []);

  if (!canStore && !canShare) return null;

  async function store() {
    try {
      const Ctor = (window as unknown as { PasswordCredential: PasswordCredentialCtor }).PasswordCredential;
      await navigator.credentials.store(
        new Ctor({ id: adminKeyCredentialId(groupName, publicId), password: adminKey, name: `Skyldig – ${groupName}` }),
      );
    } catch {
      // Dismissed, or the browser declined; the key is still on screen to copy.
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: t("adminKey.shareTitle", { name: groupName }),
        text: t("adminKey.shareText", { name: groupName, key: adminKey }),
      });
    } catch {
      // Share sheet cancelled.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {canStore && (
          <Button variant="secondary" onClick={store}>
            {t("adminKey.saveToPasswordManager")}
          </Button>
        )}
        {canShare && (
          <Button variant="secondary" onClick={share}>
            {t("adminKey.share")}
          </Button>
        )}
      </div>
      {canShare && <p className="text-meta text-pine-soft">{t("adminKey.shareHint")}</p>}
    </div>
  );
}
