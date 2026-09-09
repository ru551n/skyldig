import { GuideStep } from "~/components/guide/GuideStep.tsx";
import { ButtonLink, EmptyState, PageHeader } from "~/components/ui/index.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/guide";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Så funkar det – Skyldig" },
    { name: "description", content: "En snabb genomgång av hur Skyldig fungerar." },
  ];
}

/** Static "Så funkar det" usage guide — teaches the whole flow with real screenshots. */
export default function GuidePage() {
  const t = useT();

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-[900px] flex-col gap-10 p-6 pb-16 min-[880px]:max-w-[1000px]"
    >
      <PageHeader title={t("guide.title")} lead={t("guide.lead")} />

      <ol className="m-0 flex list-none flex-col gap-12 p-0">
        <GuideStep
          number={1}
          title={t("guide.step1Title")}
          eager
          image={{
            src: "/guide-screens/02-create.png",
            alt: t("guide.step1ImageAlt"),
            width: 780,
            height: 1688,
          }}
        >
          <p>{t("guide.step1Body1")}</p>
        </GuideStep>

        <GuideStep
          number={2}
          title={t("guide.step2Title")}
          reverse
          image={{
            src: "/guide-screens/03-keys.png",
            alt: t("guide.step2ImageAlt"),
            width: 780,
            height: 1688,
          }}
        >
          <p>{t("guide.step2Body1")}</p>
          <p>{t("guide.step2Body2")}</p>
        </GuideStep>

        <GuideStep
          number={3}
          title={t("guide.step3Title")}
          image={{
            src: "/guide-screens/04-expense-form.png",
            alt: t("guide.step3ImageAlt"),
            width: 780,
            height: 1760,
          }}
        >
          <p>{t("guide.step3Body1")}</p>
          <p>{t("guide.step3Body2")}</p>
        </GuideStep>

        <GuideStep number={4} title={t("guide.step4Title")} reverse>
          <p>{t("guide.step4Body1")}</p>
        </GuideStep>

        <GuideStep
          number={5}
          title={t("guide.step5Title")}
          image={{
            src: "/guide-screens/06-settle.png",
            alt: t("guide.step5ImageAlt"),
            width: 780,
            height: 1688,
          }}
        >
          <p>{t("guide.step5Body1")}</p>
        </GuideStep>

        <GuideStep
          number={6}
          title={t("guide.step6Title")}
          reverse
          image={{
            src: "/guide-screens/07-activity.png",
            alt: t("guide.step6ImageAlt"),
            width: 780,
            height: 1688,
          }}
        >
          <p>{t("guide.step6Body1")}</p>
        </GuideStep>

        <GuideStep number={7} title={t("guide.step7Title")}>
          <p>{t("guide.step7Body1")}</p>
        </GuideStep>
      </ol>

      <EmptyState
        headline={t("guide.closingTitle")}
        body={t("guide.closingBody")}
        action={
          <div className="flex w-full flex-col gap-3 min-[480px]:flex-row">
            <ButtonLink to="/new" size="lg" fullWidth>
              {t("guide.createSession")}
            </ButtonLink>
            <ButtonLink to="/join" variant="secondary" size="lg" fullWidth>
              {t("guide.joinSession")}
            </ButtonLink>
          </div>
        }
      />
    </main>
  );
}
