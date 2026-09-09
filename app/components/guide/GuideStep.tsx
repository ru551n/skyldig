import { cn } from "~/components/ui/cn.ts";

export interface GuideStepImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface GuideStepProps {
  /** 1-based position in the sequence, shown as a decorative badge. */
  number: number;
  title: string;
  children: React.ReactNode;
  image?: GuideStepImage;
  /** Reverses the image/text order on desktop, for an alternating two-column layout. */
  reverse?: boolean;
  /** True for the first step, whose image should not be lazy-loaded. */
  eager?: boolean;
}

/**
 * One numbered step in the "Så funkar det" guide: heading with a decorative
 * number badge, body text, and an optional screenshot. Single column on
 * mobile; side-by-side from 880px, per docs/design.md's desktop breakpoint.
 */
export function GuideStep({ number, title, children, image, reverse = false, eager = false }: GuideStepProps) {
  return (
    <li
      className={cn(
        "flex flex-col gap-4",
        "min-[880px]:flex-row min-[880px]:items-start min-[880px]:gap-8",
        reverse && "min-[880px]:flex-row-reverse",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 max-[879px]:max-w-[65ch] min-[880px]:max-w-[65ch] min-[880px]:pt-1">
        <h2 className="text-h2 text-pine flex items-center gap-3 font-semibold">
          <span
            aria-hidden="true"
            className="bg-pine text-paper flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-body font-semibold"
          >
            {number}
          </span>
          {title}
        </h2>
        <div className="text-body text-pine-soft flex flex-col gap-3">{children}</div>
      </div>
      {image && (
        <div className="min-w-0 min-[880px]:w-[280px] min-[880px]:shrink-0 min-[880px]:grow-0">
          <img
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            loading={eager ? "eager" : "lazy"}
            className="rounded-card border-line h-auto w-full border"
          />
        </div>
      )}
    </li>
  );
}
