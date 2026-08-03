import {
  PRODUCT_PROVIDER_ID,
  getProductProviderState,
} from "@x/shared/dist/branding.js";
import { ProductLoginExperience } from "../product-login-experience";
import type { OnboardingState } from "../use-onboarding-state";

interface WelcomeStepProps {
  state: OnboardingState;
}

export function WelcomeStep({ state }: WelcomeStepProps) {
  const solomonState = getProductProviderState(state.providerStates) || {
    isConnected: false,
    isLoading: false,
    isConnecting: false,
  };

  return (
    <ProductLoginExperience
      mode="onboarding"
      connected={solomonState.isConnected}
      connecting={solomonState.isConnecting}
      onProductSignIn={() => {
        state.setOnboardingPath("rowboat");
        if (solomonState.isConnected) {
          state.setCurrentStep(2);
          return;
        }
        state.startConnect(PRODUCT_PROVIDER_ID);
      }}
      onUseOwnProvider={() => {
        state.setOnboardingPath("byok");
        state.setCurrentStep(1);
      }}
    />
  );
}
