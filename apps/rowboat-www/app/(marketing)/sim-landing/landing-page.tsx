import { SimAgentMomentum, SimProblemEditorial } from "./editorial";
import { SimFaqSection } from "./faq-section";
import { SimFeaturesRail } from "./features-rail";
import { SimHero } from "./hero";
import { SimPlatformSuite } from "./platform-suite";
import { SimProductDemo } from "./product-demo";
import { SimProof } from "./proof";
import { SimSecurity } from "./security";
import { SimWorkspaceControls } from "./workspace-controls";

/**
 * Oppulence homepage main content using sim.ai landing structure 1:1.
 *
 * Chrome (scroll port, navbar, painted CTA, footer) lives in {@link SimLandingShell}.
 * Section order mirrors `apps/sim/app/(landing)/landing.tsx` with Oppulence editorial
 * blocks in place of Sim customer proof.
 */
export function SimLandingPage() {
  return (
    <>
      <div className="flex flex-col gap-24 max-sm:gap-12 max-lg:gap-16">
        <SimHero />
        <div className="flex flex-col gap-16 max-sm:gap-10 max-lg:gap-12">
          <SimProof />
          <div className="flex flex-col gap-7 max-lg:gap-4">
            <SimAgentMomentum />
          </div>
        </div>
      </div>

      <SimProblemEditorial />

      <div className="flex flex-col gap-4">
        <SimPlatformSuite />
        <SimProductDemo />
      </div>

      <div className="flex flex-col gap-20 max-sm:gap-12 max-lg:gap-16">
        <SimFeaturesRail />
        <SimWorkspaceControls />
      </div>

      <SimSecurity />

      <SimFaqSection />
    </>
  );
}
