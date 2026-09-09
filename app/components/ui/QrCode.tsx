import { create } from "qrcode";

export interface QrCodeProps {
  /** The exact text to encode, e.g. an absolute invite URL. */
  value: string;
  /** Rendered pixel size (square). Default 200. */
  size?: number;
  className?: string;
  /** Accessible name. The QR is otherwise decorative — the link text beside it is the real content. */
  title?: string;
}

/**
 * Renders a QR code as inline SVG using `currentColor` for the modules, generated entirely
 * client/server-side with no network call or canvas — the Content Security Policy allows no
 * third-party origins, and an external QR image service would see the (single-use) invite
 * token. See docs/todo.md "Share a group by QR code or link".
 */
export function QrCode({ value, size = 200, className, title }: QrCodeProps) {
  const code = create(value, { errorCorrectionLevel: "M" });
  const modules = code.modules;
  const n = modules.size;
  // One extra module of quiet-zone padding on each side, matching common QR conventions,
  // so the code stays scannable right up to the SVG's edge.
  const quiet = 4;
  const total = n + quiet * 2;

  const rects: string[] = [];
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      if (modules.get(row, col)) {
        rects.push(`M${col + quiet},${row + quiet}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width={total} height={total} fill="var(--color-paper)" />
      <path d={rects.join(" ")} fill="currentColor" />
    </svg>
  );
}
