# @oppulence/rowboat-integration-templates

Shared Rowboat integration onboarding templates.

The package defines the typed "blocks" shown when a user browses and connects
integrations. These are descriptive onboarding blocks, not workflow execution
nodes.

```ts
import {
  getIntegrationTemplate,
  listIntegrationTemplates,
} from "@oppulence/rowboat-integration-templates";

const github = getIntegrationTemplate("github");
const all = listIntegrationTemplates();
```
