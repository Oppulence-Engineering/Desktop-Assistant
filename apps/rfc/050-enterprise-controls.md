# RFC 050: Enterprise Controls — SSO, SCIM, Managed Cloud Providers, and Policy Enforcement

|                    |                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**            | 050                                                                                                                            |
| **Status**         | Draft                                                                                                                          |
| **Track**          | Rowboat enterprise readiness · shared company policy                                                                           |
| **Owners**         | `apps/rowboat-api`, `apps/x` desktop, security, product                                                                        |
| **Created**        | 2026-08-12                                                                                                                     |
| **Depends on**     | [RFC 011](./complete-011-identity-and-authorization-plane.md), [RFC 015](./015-rowboat-platform-workos-fga-and-widget-auth.md) |
| **Related**        | [RFC 051](./051-note-sharing-and-team-spaces.md), [RFC 055](./055-capture-product-boundary-and-rowboat-integration.md)         |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                                                      |

## 1. Decision

Make the product deployable by an IT organization: company SSO and SCIM
provisioning, centrally managed model access via Amazon Bedrock or Azure OpenAI
without distributing API keys, and admin policy that the desktop client enforces.

## 2. Why this one is close for us

We are further along here than anywhere else in this comparison. RFC 015 already
covers WorkOS organization identity and FGA, and `apps/rowboat-api/internal/workosauth`
exists. WorkOS provides SSO and Directory Sync (SCIM) as products, so the
remaining work is largely **desktop-side policy enforcement** and **managed
provider credentials**, not an identity build.

## 3. Design

### 3.1 SSO and SCIM

Lean on WorkOS. What is missing is the lifecycle behavior: a user deprovisioned
in the directory must lose desktop access promptly, which means the client needs
a policy refresh path rather than a long-lived local session.

### 3.2 Managed provider access

An admin configures Bedrock or Azure OpenAI once at the organization level.
Clients then call models through a broker using short-lived scoped credentials.
Users never see or hold a cloud key.

This is the feature that unblocks regulated buyers, because it keeps inference
inside the customer's own cloud account and audit boundary.

### 3.3 Policy enforcement

An organization policy document, fetched and cached by the client, that can:

- force local-only relationship inference (no cloud evidence egress);
- restrict which model providers are selectable;
- disable screen-context capture (RFC 042) and capture-artifact retention;
- set retention limits;
- disable public link sharing (RFC 051).

Two rules matter more than the list. First, **policy is fail-closed**: if the
client cannot refresh policy within a grace window, it degrades to the most
restrictive cached state rather than the most permissive. Second, policy is
enforced where the action happens (main process), never only in the renderer UI.

### 3.4 Admin surfaces

Organization settings, member roles, audit log export, and a clear statement to
end users of what their organization has restricted and why. Silent restriction
generates support tickets; explained restriction does not.

## 4. Definition of done

- SSO and SCIM provision and deprovision users, with deprovisioning reflected on
  the desktop within a stated window.
- An admin configures Bedrock or Azure OpenAI centrally and no user holds a key.
- Local-only relationship-inference policy is enforced in the main process and cannot be
  bypassed by the renderer (tested).
- Policy fetch failure fails closed to the cached restrictive state.
- Restricted features are visibly explained to end users.
- Audit log covers policy changes, provider changes, and sharing changes.

## 5. Sequencing note

SSO/SCIM can proceed independently because the backend foundation already
exists. Cross-product organization policy uses a shared vocabulary, but each
product enforces it fail-closed at its own boundary. Capture-provider policy
belongs to the capture product; Rowboat governs relationship models,
connectors, evidence visibility, retention, and actions.

## 6. OpenWhispr code references

| Concern               | File                                                                       | Lines | Notes                                                                                      |
| --------------------- | -------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| Policy manager        | `src/helpers/workspacePolicyManager.js`                                    | 393   | Fetch, cache, refresh, and enforcement of org policy. The core reference for §3.3.         |
| Policy cache          | `src/helpers/workspacePolicyCache.js`                                      | 51    | Offline behavior and the fail-closed question.                                             |
| Policy validation     | `src/helpers/policyValidation.js`                                          | —     | Schema validation of the policy document.                                                  |
| Policy transport      | `src/helpers/policyRequestHeaders.js`, `policyResponseError.js`            | —     | Request/response handling and error semantics.                                             |
| Enterprise identity   | `src/helpers/enterpriseIdentityManager.js`                                 | 537   | SSO session lifecycle on the client.                                                       |
| Managed providers     | `src/helpers/enterpriseAiProviders.js`                                     | 95    | Bedrock/Azure routing without user keys, per §3.2.                                         |
| Provider errors       | `src/helpers/enterpriseProviderErrors.js`                                  | 274   | Error normalization; unusually large because enterprise cloud errors are unusually opaque. |
| Managed config        | `src/helpers/enterpriseManagedConfig.mjs`                                  | —     | MDM-delivered configuration.                                                               |
| Bedrock catalog       | `src/helpers/bedrockCatalog.js`, `src/utils/bedrockRegions.ts`             | —     | Model and region enumeration.                                                              |
| Enterprise chat model | `src/services/ai/enterpriseChatModel.ts`                                   | 120   | Client-side model wrapper.                                                                 |
| Admin UI              | `src/components/EnterpriseSection.tsx`, `EnterpriseProviderConfig.tsx`     | 96    | Admin configuration surface.                                                               |
| Secret storage        | `src/helpers/secretCrypto.js`, `tokenStore.js`, `src/utils/SecureCache.ts` | —     | Credential custody patterns.                                                               |

MIT-licensed; carry the notice on any adapted file.

## 7. Risks

- Enterprise features attract enterprise diligence: SOC 2, DPAs, pen tests. The
  code is often the smaller half of the cost.
- Policy enforcement in an Electron renderer is not a security boundary. Any
  control that matters must be enforced in the main process or server-side.
