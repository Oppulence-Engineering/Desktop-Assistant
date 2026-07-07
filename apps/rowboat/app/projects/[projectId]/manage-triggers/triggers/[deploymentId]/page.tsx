import { Metadata } from "next";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { IntegrationTriggerDeploymentView } from "../../components/integration-trigger-deployment-view";

export const metadata: Metadata = {
    title: "External Trigger",
};

export default async function Page(
    props: {
        params: Promise<{ projectId: string; deploymentId: string }>
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    return <IntegrationTriggerDeploymentView projectId={params.projectId} deploymentId={params.deploymentId} />;
}


