# WorkOS Auth Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rowboat's Auth0-centered human auth, session, user provisioning, organization, authorization, and customer API key flows with WorkOS AuthKit and WorkOS-backed authorization where the product boundary requires it.

**Architecture:** Keep `apps/rowboat` on Next.js App Router and introduce a WorkOS adapter at the existing auth seam so server actions and pages keep calling `requireAuth()` and `authCheck()` while their internals switch to AuthKit. Use WorkOS Organizations as the tenant boundary, keep Rowboat project IDs as application resources, register projects in WorkOS FGA for resource-scoped access, and keep project-scoped widget/session secrets separate from WorkOS organization API keys. Migration uses WorkOS `external_id` to bridge existing Auth0 subjects without rewriting Rowboat project memberships.

**Tech Stack:** Next.js 15.3.8, React 19, MongoDB, Awilix, WorkOS AuthKit Next.js `@workos-inc/authkit-nextjs@4.1.0`, WorkOS Node `@workos-inc/node@9.3.1`, Zod, jose, npm package lock.

---

## Current-State Evidence

- `apps/rowboat/package.json` depends on `@auth0/nextjs-auth0` and has no WorkOS dependency.
- `apps/rowboat/app/lib/auth0.ts` creates a single Auth0 client from `AUTH0_*` environment variables.
- `apps/rowboat/middleware.ts` delegates `/auth` to Auth0 and protects `/projects`, `/billing`, and `/onboarding` by calling `auth0.getSession(request)`.
- `apps/rowboat/app/lib/auth.ts` converts `auth0.getSession().user.sub` into a local Mongo user via `auth0Id`.
- `apps/rowboat/src/entities/models/user.ts`, `mongodb.users.repository.ts`, and `mongodb.users.indexes.ts` make `auth0Id` the external identity key.
- Client UI imports Auth0 from `app/layout.tsx`, `app/app.tsx`, `app/lib/components/user_button.tsx`, and `app/projects/[projectId]/workflow/components/TopBar.tsx`.
- Project authorization is app-local: `ProjectActionAuthorizationPolicy` checks `project_members` for human callers and `api_keys` for API callers.
- Public widget auth helpers in `app/api/widget/v1/utils.ts` return `501`, so the auth rework should not preserve that broken state.
- There are no test files under `apps/rowboat`, so this migration needs to add at least focused unit coverage plus `npm run build` verification.

## WorkOS Inputs Verified

- npm reports `@workos-inc/authkit-nextjs` latest as `4.1.0` and `@workos-inc/node` latest as `9.3.1`.
- AuthKit Next.js v4 supports App Router, `handleAuth`, `getSignInUrl`, `signOut`, `withAuth`, `AuthKitProvider`, `useAuth`, `authkitMiddleware`, and composable `authkit()` plus `handleAuthkitHeaders()`.
- AuthKit `withAuth()` returns `user`, `organizationId`, `role`/`roles`, `permissions`, entitlements, feature flags, and the access token. WorkOS Authorization checks require an organization membership ID, so resolve that through `getWorkOS().userManagement.listOrganizationMemberships({ userId, organizationId, statuses: ["active"], limit: 1 })` instead of assuming AuthKit exposes it directly.
- WorkOS user migration supports `external_id`, which should be set to the existing Auth0 subject during import.
- WorkOS API Keys are organization-owned in the current Node SDK type surface, return the full secret only at creation, and validate to owner plus permission metadata. They are not a direct replacement for per-project widget/session secrets.

## File Structure

Create:

- `apps/rowboat/app/auth/callback/route.ts`: WorkOS callback handler using `handleAuth()` and a user sync hook.
- `apps/rowboat/app/auth/login/route.ts`: WorkOS sign-in endpoint that preserves `returnTo`.
- `apps/rowboat/app/auth/signup/route.ts`: WorkOS sign-up endpoint for signup-oriented redirects.
- `apps/rowboat/app/auth/logout/route.ts`: server-side logout endpoint that calls WorkOS `signOut()`.
- `apps/rowboat/app/lib/workos-session.ts`: server-only WorkOS session adapter and local user sync.
- `apps/rowboat/src/entities/models/organization.ts`: local organization record keyed by WorkOS organization ID.
- `apps/rowboat/src/application/repositories/organizations.repository.interface.ts`: repository contract for local organization state.
- `apps/rowboat/src/infrastructure/repositories/mongodb.organizations.repository.ts`: Mongo implementation.
- `apps/rowboat/src/infrastructure/repositories/mongodb.organizations.indexes.ts`: indexes for WorkOS organization lookup.
- `apps/rowboat/src/application/policies/auth-actor.ts`: normalized actor types for human users, WorkOS API keys, and project API keys.
- `apps/rowboat/src/application/services/workos-authorization.service.ts`: FGA resource registration and access checks.
- `apps/rowboat/app/scripts/migrate-auth0-users-to-workos.ts`: migration verifier/backfiller that links local users to WorkOS users by `external_id`.
- `apps/rowboat/app/scripts/backfill-project-workos-resources.ts`: registers existing projects as WorkOS FGA resources.
- `apps/rowboat/src/application/policies/project-action-authorization.policy.test.ts`: unit tests for user, organization, FGA, and API key authorization.
- `apps/rowboat/app/lib/workos-session.test.ts`: unit tests for WorkOS profile to local user sync.
- `apps/rowboat/app/api/v1/[projectId]/chat/route.test.ts`: route-level tests for WorkOS API key handling.

Modify:

- `apps/rowboat/package.json` and `apps/rowboat/package-lock.json`: replace Auth0 SDK with WorkOS SDKs and add test scripts.
- `apps/rowboat/middleware.ts`: compose WorkOS AuthKit middleware with existing API CORS behavior.
- `apps/rowboat/app/layout.tsx`: replace `Auth0Provider` with `AuthKitProvider`.
- `apps/rowboat/app/app.tsx`: replace Auth0 client hook with WorkOS `useAuth`.
- `apps/rowboat/app/lib/auth.ts`: preserve exports while switching internals to WorkOS.
- `apps/rowboat/app/actions/auth.actions.ts`: call WorkOS-backed `authCheck()` and stop importing Auth0.
- `apps/rowboat/app/actions/assistant-templates.actions.ts`: derive author profile from WorkOS/local auth context.
- `apps/rowboat/app/lib/components/user_button.tsx`: replace Auth0 user hook and logout path.
- `apps/rowboat/app/projects/[projectId]/workflow/components/TopBar.tsx`: replace Auth0 user hook.
- `apps/rowboat/src/entities/models/user.ts`: replace `auth0Id` with `workosUserId` and `legacyAuth0Id`.
- `apps/rowboat/src/application/repositories/users.repository.interface.ts`: replace Auth0 lookup methods with WorkOS lookup/upsert methods.
- `apps/rowboat/src/infrastructure/repositories/mongodb.users.repository.ts`: implement WorkOS lookup/upsert and migration-safe legacy lookup.
- `apps/rowboat/src/infrastructure/repositories/mongodb.users.indexes.ts`: replace `auth0Id_unique` with `workosUserId_unique` and `legacyAuth0Id_sparse`.
- `apps/rowboat/src/entities/models/project.ts`: add `organizationId` and optional `workosAuthorizationResourceId`.
- `apps/rowboat/src/application/repositories/projects.repository.interface.ts`: include organization fields in create/list/fetch paths.
- `apps/rowboat/src/infrastructure/repositories/mongodb.projects.repository.ts`: persist and query by `organizationId`.
- `apps/rowboat/src/infrastructure/repositories/mongodb.projects.indexes.ts`: add `organizationId` indexes.
- `apps/rowboat/src/application/use-cases/projects/create-project.use-case.ts`: create project in the signed-in WorkOS organization and register the FGA resource.
- `apps/rowboat/src/application/use-cases/projects/list-projects.use-case.ts`: scope listing by organization and effective permissions.
- `apps/rowboat/src/application/policies/project-action-authorization.policy.ts`: authorize normalized actors against organization, project membership, FGA, and project keys.
- `apps/rowboat/app/actions/project.actions.ts` and other `app/actions/*.actions.ts`: pass the current auth actor into controllers or preserve `userId` plus add `organizationId` during the transition.
- `apps/rowboat/app/lib/billing.ts` and `apps/rowboat/app/actions/billing.actions.ts`: bill by local organization instead of by local user.
- `apps/rowboat/app/onboarding/app.tsx` and `apps/rowboat/app/onboarding/page.tsx`: replace email collection with organization creation/selection when no WorkOS organization is present.
- `apps/rowboat/src/entities/models/api-key.ts`: rename semantics to project API keys and store hashed keys for newly generated project-scoped keys.
- `apps/rowboat/src/infrastructure/repositories/mongodb.api-keys.repository.ts`: validate project keys with hashes and make WorkOS API keys a separate actor path.
- `apps/rowboat/app/api/v1/[projectId]/chat/route.ts`: validate WorkOS organization API keys and keep project key fallback during migration.
- `apps/rowboat/app/api/widget/v1/utils.ts` and widget routes: implement the currently stubbed widget/session verification.
- `apps/rowboat/README.md`: document WorkOS env, dashboard redirects, migration sequence, and verification commands.

Delete after cutover:

- `apps/rowboat/app/lib/auth0.ts`
- all imports from `@auth0/nextjs-auth0`
- Auth0 environment variable references in app docs and deployment manifests

---

## Task 1: Dependencies, Scripts, And Environment Contract

**Files:**
- Modify: `apps/rowboat/package.json`
- Modify: `apps/rowboat/package-lock.json`
- Modify: `apps/rowboat/README.md`

- [ ] **Step 1: Update dependencies**

Run:

```bash
cd apps/rowboat
npm uninstall @auth0/nextjs-auth0
npm install @workos-inc/authkit-nextjs@4.1.0 @workos-inc/node@9.3.1
npm install --save-dev vitest@latest @vitejs/plugin-react@latest
```

Expected:

```text
package.json and package-lock.json no longer contain @auth0/nextjs-auth0.
package.json contains @workos-inc/authkit-nextjs and @workos-inc/node.
```

- [ ] **Step 2: Add scripts**

Add this script block shape to `apps/rowboat/package.json` while preserving existing scripts:

```json
{
  "scripts": {
    "dev": "npx next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "setupQdrant": "tsx app/scripts/setup_qdrant.ts",
    "deleteQdrant": "tsx app/scripts/delete_qdrant.ts",
    "rag-worker": "tsx app/scripts/rag-worker.ts",
    "jobs-worker": "tsx app/scripts/jobs-worker.ts",
    "mongodb-drop-indexes": "tsx app/scripts/mongodb-drop-indexes.ts",
    "mongodb-ensure-indexes": "tsx app/scripts/mongodb-ensure-indexes.ts",
    "migrate-auth0-users-to-workos": "tsx app/scripts/migrate-auth0-users-to-workos.ts",
    "backfill-project-workos-resources": "tsx app/scripts/backfill-project-workos-resources.ts"
  }
}
```

- [ ] **Step 3: Document required WorkOS variables**

Add this environment contract to `apps/rowboat/README.md`:

```markdown
### WorkOS AuthKit

Required when `USE_AUTH=true`:

- `WORKOS_CLIENT_ID`: WorkOS AuthKit client ID.
- `WORKOS_API_KEY`: server-side WorkOS API key.
- `WORKOS_COOKIE_PASSWORD`: at least 32 characters; generate with `openssl rand -base64 24`.
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`: absolute URL for `/auth/callback`.
- `WORKOS_AUTH_SIGN_IN_PATH`: `/auth/login`.
- `WORKOS_AUTH_AFTER_LOGIN_PATH`: `/projects`.

WorkOS dashboard redirect settings:

- Sign-in endpoint: `${APP_BASE_URL}/auth/login`
- Redirect URI: `${APP_BASE_URL}/auth/callback`
- Default logout URI: `${APP_BASE_URL}/`
```

- [ ] **Step 4: Verify dependency state**

Run:

```bash
cd apps/rowboat
npm ls @workos-inc/authkit-nextjs @workos-inc/node
npm ls @auth0/nextjs-auth0
```

Expected:

```text
@workos-inc/authkit-nextjs@4.1.0 is installed.
@workos-inc/node@9.3.1 is installed.
npm ls @auth0/nextjs-auth0 exits non-zero or reports empty.
```

---

## Task 2: WorkOS Auth Routes

**Files:**
- Create: `apps/rowboat/app/auth/callback/route.ts`
- Create: `apps/rowboat/app/auth/login/route.ts`
- Create: `apps/rowboat/app/auth/signup/route.ts`
- Create: `apps/rowboat/app/auth/logout/route.ts`
- Create: `apps/rowboat/app/lib/workos-session.ts`

- [ ] **Step 1: Write callback route**

Create `apps/rowboat/app/auth/callback/route.ts`:

```ts
import { handleAuth } from "@workos-inc/authkit-nextjs";
import { syncWorkosUser } from "@/app/lib/workos-session";

export const GET = handleAuth({
  returnPathname: process.env.WORKOS_AUTH_AFTER_LOGIN_PATH || "/projects",
  onSuccess: async ({ user, organizationId, accessToken }) => {
    await syncWorkosUser({ user, organizationId, accessToken });
  },
});
```

- [ ] **Step 2: Write sign-in route**

Create `apps/rowboat/app/auth/login/route.ts`:

```ts
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/projects";
  const signInUrl = await getSignInUrl({ returnTo });
  redirect(signInUrl);
}
```

- [ ] **Step 3: Write sign-up route**

Create `apps/rowboat/app/auth/signup/route.ts`:

```ts
import { getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/projects";
  const signUpUrl = await getSignUpUrl({ returnTo });
  redirect(signUpUrl);
}
```

- [ ] **Step 4: Write logout route**

Create `apps/rowboat/app/auth/logout/route.ts`:

```ts
import { signOut } from "@workos-inc/authkit-nextjs";

export async function GET() {
  await signOut({ returnTo: "/" });
}
```

- [ ] **Step 5: Verify route compilation**

Run:

```bash
cd apps/rowboat
npm run typecheck
```

Expected:

```text
No TypeScript errors from the new auth routes.
```

---

## Task 3: WorkOS Session Adapter And Local User Sync

**Files:**
- Create: `apps/rowboat/app/lib/workos-session.ts`
- Modify: `apps/rowboat/app/lib/auth.ts`
- Modify: `apps/rowboat/app/actions/auth.actions.ts`
- Modify: `apps/rowboat/app/actions/assistant-templates.actions.ts`
- Delete after all imports are gone: `apps/rowboat/app/lib/auth0.ts`

- [ ] **Step 1: Create adapter types and sync function**

Create `apps/rowboat/app/lib/workos-session.ts`:

```ts
import "server-only";

import { getSignInUrl, getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { container } from "@/di/container";
import { IUsersRepository } from "@/src/application/repositories/users.repository.interface";
import { User } from "@/src/entities/models/user";
import { USE_AUTH } from "./feature_flags";

type WorkosAuth = Awaited<ReturnType<typeof withAuth>>;
type WorkosUser = NonNullable<WorkosAuth["user"]>;

export const GUEST_DB_USER: z.infer<typeof User> = {
  id: "guest_user",
  workosUserId: "guest_user",
  legacyAuth0Id: "guest_user",
  name: "Guest",
  email: "guest@rowboatlabs.com",
  createdAt: new Date().toISOString(),
};

function displayName(user: WorkosUser): string | undefined {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return fullName || user.email || undefined;
}

export async function syncWorkosUser({
  user,
  organizationId,
  accessToken,
}: {
  user: WorkosUser;
  organizationId?: string;
  accessToken?: string;
}): Promise<z.infer<typeof User>> {
  const usersRepository = container.resolve<IUsersRepository>("usersRepository");

  return await usersRepository.upsertFromWorkos({
    workosUserId: user.id,
    legacyAuth0Id: user.externalId || undefined,
    email: user.email || undefined,
    name: displayName(user),
    currentOrganizationId: organizationId,
    lastSeenAt: new Date().toISOString(),
    accessTokenPresent: Boolean(accessToken),
  });
}

export async function resolveWorkosOrganizationMembershipId({
  workosUserId,
  organizationId,
}: {
  workosUserId: string;
  organizationId: string;
}): Promise<string | undefined> {
  const workos = getWorkOS();
  const memberships = await workos.userManagement.listOrganizationMemberships({
    userId: workosUserId,
    organizationId,
    statuses: ["active"],
    limit: 1,
  });

  return memberships.data[0]?.id;
}

export async function getWorkosAuth() {
  if (!USE_AUTH) {
    return {
      user: null,
      organizationId: undefined,
      permissions: [],
    };
  }

  return await withAuth();
}

export async function requireWorkosAuth() {
  if (!USE_AUTH) {
    return {
      user: null,
      organizationId: undefined,
      permissions: [],
    };
  }

  const auth = await withAuth({ ensureSignedIn: true });
  if (!auth.user) {
    const signInUrl = await getSignInUrl({ returnTo: "/projects" });
    redirect(signInUrl);
  }
  return auth;
}

export async function requireAuth(): Promise<z.infer<typeof User>> {
  if (!USE_AUTH) {
    return GUEST_DB_USER;
  }

  const auth = await requireWorkosAuth();
  return await syncWorkosUser({
    user: auth.user!,
    organizationId: auth.organizationId,
    accessToken: auth.accessToken,
  });
}

export async function authCheck(): Promise<z.infer<typeof User>> {
  const user = await requireAuth();
  if (!user) {
    throw new Error("User not authenticated");
  }
  return user;
}
```

- [ ] **Step 2: Preserve existing import surface**

Replace `apps/rowboat/app/lib/auth.ts` with exports that point at the adapter:

```ts
export {
  GUEST_DB_USER,
  authCheck,
  getWorkosAuth,
  requireAuth,
  requireWorkosAuth,
  syncWorkosUser,
} from "./workos-session";
```

- [ ] **Step 3: Update server action auth**

Replace the Auth0 import path in `apps/rowboat/app/actions/auth.actions.ts` and make it use the shared adapter:

```ts
"use server";

import { z } from "zod";
import { container } from "@/di/container";
import { IUsersRepository } from "@/src/application/repositories/users.repository.interface";
import { User } from "@/src/entities/models/user";
import { USE_AUTH } from "../lib/feature_flags";
import { authCheck as requireCurrentUser, GUEST_DB_USER } from "../lib/auth";

const usersRepository = container.resolve<IUsersRepository>("usersRepository");

export async function authCheck(): Promise<z.infer<typeof User>> {
  if (!USE_AUTH) {
    return GUEST_DB_USER;
  }
  return await requireCurrentUser();
}

const EmailOnly = z.object({
  email: z.string().email(),
});

export async function updateUserEmail(email: string) {
  if (!USE_AUTH) {
    return;
  }
  const user = await authCheck();

  if (!email.trim()) {
    throw new Error("Email is required");
  }
  if (!EmailOnly.safeParse({ email }).success) {
    throw new Error("Invalid email");
  }

  await usersRepository.updateEmail(user.id, email);
}
```

- [ ] **Step 4: Replace assistant-template Auth0 profile lookup**

In `apps/rowboat/app/actions/assistant-templates.actions.ts`, replace the dynamic Auth0 import with local auth data:

```ts
const user = await authCheck();
let authorName = user.name || user.email || "Anonymous";
let authorEmail = user.email;

if (validatedData.isAnonymous) {
  authorName = "Anonymous";
  authorEmail = undefined;
}
```

- [ ] **Step 5: Verify no Auth0 server imports remain**

Run:

```bash
rg -n "auth0|Auth0|@auth0" apps/rowboat --glob '!package-lock.json'
```

Expected after the client provider task is complete:

```text
No matches.
```

---

## Task 4: User And Organization Persistence

**Files:**
- Modify: `apps/rowboat/src/entities/models/user.ts`
- Create: `apps/rowboat/src/entities/models/organization.ts`
- Modify: `apps/rowboat/src/application/repositories/users.repository.interface.ts`
- Create: `apps/rowboat/src/application/repositories/organizations.repository.interface.ts`
- Modify: `apps/rowboat/src/infrastructure/repositories/mongodb.users.repository.ts`
- Create: `apps/rowboat/src/infrastructure/repositories/mongodb.organizations.repository.ts`
- Modify: `apps/rowboat/src/infrastructure/repositories/mongodb.users.indexes.ts`
- Create: `apps/rowboat/src/infrastructure/repositories/mongodb.organizations.indexes.ts`
- Modify: `apps/rowboat/src/infrastructure/mongodb/ensure-indexes.ts`
- Modify: `apps/rowboat/src/infrastructure/mongodb/drop-indexes.ts`
- Modify: `apps/rowboat/di/container.ts`

- [ ] **Step 1: Update user model**

Use this `User` shape:

```ts
import { z } from "zod";

export const User = z.object({
  id: z.string(),
  workosUserId: z.string(),
  legacyAuth0Id: z.string().optional(),
  billingCustomerId: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  currentOrganizationId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  lastSeenAt: z.string().datetime().optional(),
});
```

- [ ] **Step 2: Add organization model**

Create `apps/rowboat/src/entities/models/organization.ts`:

```ts
import { z } from "zod";

export const Organization = z.object({
  id: z.string(),
  workosOrganizationId: z.string(),
  name: z.string(),
  billingCustomerId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});
```

- [ ] **Step 3: Update users repository interface**

Replace Auth0-specific methods with WorkOS-specific methods:

```ts
import { z } from "zod";
import { User } from "@/src/entities/models/user";

export const UpsertWorkosUserSchema = User.pick({
  workosUserId: true,
}).extend({
  legacyAuth0Id: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  currentOrganizationId: z.string().optional(),
  lastSeenAt: z.string().datetime().optional(),
  accessTokenPresent: z.boolean().optional(),
});

export interface IUsersRepository {
  create(data: z.infer<typeof UpsertWorkosUserSchema>): Promise<z.infer<typeof User>>;
  fetch(id: string): Promise<z.infer<typeof User> | null>;
  fetchByWorkosUserId(workosUserId: string): Promise<z.infer<typeof User> | null>;
  fetchByLegacyAuth0Id(legacyAuth0Id: string): Promise<z.infer<typeof User> | null>;
  upsertFromWorkos(data: z.infer<typeof UpsertWorkosUserSchema>): Promise<z.infer<typeof User>>;
  updateEmail(id: string, email: string): Promise<z.infer<typeof User>>;
  updateBillingCustomerId(id: string, billingCustomerId: string): Promise<z.infer<typeof User>>;
  updateCurrentOrganization(id: string, organizationId: string): Promise<z.infer<typeof User>>;
}
```

- [ ] **Step 4: Add organization repository interface**

Create `apps/rowboat/src/application/repositories/organizations.repository.interface.ts`:

```ts
import { z } from "zod";
import { Organization } from "@/src/entities/models/organization";

export const UpsertOrganizationSchema = Organization.pick({
  workosOrganizationId: true,
  name: true,
}).extend({
  billingCustomerId: z.string().optional(),
});

export interface IOrganizationsRepository {
  fetch(id: string): Promise<z.infer<typeof Organization> | null>;
  fetchByWorkosOrganizationId(workosOrganizationId: string): Promise<z.infer<typeof Organization> | null>;
  upsertFromWorkos(data: z.infer<typeof UpsertOrganizationSchema>): Promise<z.infer<typeof Organization>>;
  updateBillingCustomerId(id: string, billingCustomerId: string): Promise<z.infer<typeof Organization>>;
}
```

- [ ] **Step 5: Update indexes**

Set `apps/rowboat/src/infrastructure/repositories/mongodb.users.indexes.ts` to:

```ts
import { IndexDescription } from "mongodb";

export const USERS_COLLECTION = "users";

export const USERS_INDEXES: IndexDescription[] = [
  { key: { workosUserId: 1 }, name: "workosUserId_unique", unique: true },
  {
    key: { legacyAuth0Id: 1 },
    name: "legacyAuth0Id_sparse_unique",
    unique: true,
    sparse: true,
  },
  { key: { currentOrganizationId: 1, _id: -1 }, name: "currentOrganizationId__id_desc" },
];
```

Create `apps/rowboat/src/infrastructure/repositories/mongodb.organizations.indexes.ts`:

```ts
import { IndexDescription } from "mongodb";

export const ORGANIZATIONS_COLLECTION = "organizations";

export const ORGANIZATIONS_INDEXES: IndexDescription[] = [
  { key: { workosOrganizationId: 1 }, name: "workosOrganizationId_unique", unique: true },
];
```

- [ ] **Step 6: Wire repositories in Awilix**

Register `organizationsRepository` in `apps/rowboat/di/container.ts` with the same singleton pattern as `usersRepository`.

- [ ] **Step 7: Verify indexes**

Run:

```bash
cd apps/rowboat
npm run mongodb-ensure-indexes
```

Expected:

```text
users.workosUserId_unique exists.
users.legacyAuth0Id_sparse_unique exists.
organizations.workosOrganizationId_unique exists.
```

---

## Task 5: Middleware Composition With Existing CORS

**Files:**
- Modify: `apps/rowboat/middleware.ts`

- [ ] **Step 1: Replace Auth0 middleware with WorkOS composition**

Use this structure:

```ts
import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";

const corsOptions = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-client-id, Authorization",
};

function isProtectedPage(pathname: string): boolean {
  return pathname.startsWith("/projects") ||
    pathname.startsWith("/billing") ||
    pathname.startsWith("/onboarding");
}

function withCors(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  Object.entries(corsOptions).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export async function middleware(request: NextRequest, _event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/") && request.method === "OPTIONS") {
    return NextResponse.json({}, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        ...corsOptions,
      },
    });
  }

  const { session, headers, authorizationUrl } = await authkit(request);

  if (pathname.startsWith("/api/")) {
    return withCors(handleAuthkitHeaders(request, headers));
  }

  if (process.env.USE_AUTH === "true" && isProtectedPage(pathname) && !session.user && authorizationUrl) {
    return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl });
  }

  return handleAuthkitHeaders(request, headers);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
```

- [ ] **Step 2: Verify API preflight still works**

Run:

```bash
cd apps/rowboat
npm run typecheck
```

Expected:

```text
No middleware type errors.
```

Manual verification after the dev server is running:

```bash
curl -i -X OPTIONS http://localhost:3000/api/me
```

Expected:

```text
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type, x-client-id, Authorization
```

---

## Task 6: Client Provider And User UI

**Files:**
- Modify: `apps/rowboat/app/layout.tsx`
- Modify: `apps/rowboat/app/app.tsx`
- Modify: `apps/rowboat/app/lib/components/user_button.tsx`
- Modify: `apps/rowboat/app/projects/[projectId]/workflow/components/TopBar.tsx`

- [ ] **Step 1: Replace root provider**

Update `apps/rowboat/app/layout.tsx`:

```tsx
import "./globals.css";
import { ThemeProvider } from "./providers/theme-provider";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Metadata } from "next";
import { HelpModalProvider } from "./providers/help-modal-provider";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { USE_AUTH } from "./lib/feature_flags";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "RowBoat labs",
    template: "%s | RowBoat Labs",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialAuth = USE_AUTH ? await withAuth() : undefined;
  const authForClient = initialAuth ? (({ accessToken, ...auth }) => auth)(initialAuth) : undefined;

  return (
    <html lang="en" className="h-dvh">
      <body className={`${inter.className} h-full text-base [scrollbar-width:thin] bg-background`}>
        <AuthKitProvider initialAuth={authForClient}>
          <ThemeProvider>
            <Providers className="h-full flex flex-col">
              <HelpModalProvider>{children}</HelpModalProvider>
            </Providers>
          </ThemeProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Replace landing redirect hook**

In `apps/rowboat/app/app.tsx`, replace `useUser`:

```tsx
import { useAuth } from "@workos-inc/authkit-nextjs/components";

const { user, loading } = useAuth();

if (user) {
  router.push("/projects");
}

if (!loading && !user) {
  router.push("/auth/login");
}
```

- [ ] **Step 3: Replace user menu hook**

In `apps/rowboat/app/lib/components/user_button.tsx`, use WorkOS:

```tsx
import { useAuth } from "@workos-inc/authkit-nextjs/components";

const { user } = useAuth();
const title = user?.email ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ") ?? "Unknown user";
const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Unknown user";
```

Keep the existing logout action target as `/auth/logout`.

- [ ] **Step 4: Replace workflow top bar hook**

In `apps/rowboat/app/projects/[projectId]/workflow/components/TopBar.tsx`, replace:

```ts
import { useUser } from "@auth0/nextjs-auth0";
```

with:

```ts
import { useAuth } from "@workos-inc/authkit-nextjs/components";
```

and replace:

```ts
const { user } = useUser();
```

with:

```ts
const { user } = useAuth();
```

Use:

```ts
return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Anonymous";
```

- [ ] **Step 5: Verify no client/server import mixups**

Run:

```bash
cd apps/rowboat
npm run typecheck
npm run build
```

Expected:

```text
No node:crypto client component import errors.
The Next.js build completes.
```

---

## Task 7: Organization Onboarding And Billing Scope

**Files:**
- Modify: `apps/rowboat/app/onboarding/page.tsx`
- Modify: `apps/rowboat/app/onboarding/app.tsx`
- Create: `apps/rowboat/app/actions/organization.actions.ts`
- Modify: `apps/rowboat/app/lib/billing.ts`
- Modify: `apps/rowboat/app/actions/billing.actions.ts`
- Modify: `apps/rowboat/src/entities/models/project.ts`
- Modify: `apps/rowboat/src/application/use-cases/projects/create-project.use-case.ts`

- [ ] **Step 1: Add organization action**

Create `apps/rowboat/app/actions/organization.actions.ts`:

```ts
"use server";

import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { container } from "@/di/container";
import { IOrganizationsRepository } from "@/src/application/repositories/organizations.repository.interface";
import { IUsersRepository } from "@/src/application/repositories/users.repository.interface";
import { authCheck } from "./auth.actions";

export async function createOrganizationForCurrentUser(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Organization name is required");
  }

  const user = await authCheck();
  const workos = getWorkOS();
  const organization = await workos.organizations.createOrganization({ name: trimmed });

  const organizationsRepository = container.resolve<IOrganizationsRepository>("organizationsRepository");
  const usersRepository = container.resolve<IUsersRepository>("usersRepository");

  const localOrg = await organizationsRepository.upsertFromWorkos({
    workosOrganizationId: organization.id,
    name: organization.name,
  });

  await usersRepository.updateCurrentOrganization(user.id, organization.id);
  return localOrg;
}
```

- [ ] **Step 2: Repurpose onboarding UI**

Replace email collection in `apps/rowboat/app/onboarding/app.tsx` with organization-name collection:

```tsx
const [name, setName] = useState("");

async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  setError("");
  if (!name.trim()) {
    setError("Please enter an organization name.");
    return;
  }
  setSubmitted(true);

  try {
    await createOrganizationForCurrentUser(name);
    router.push("/projects");
  } catch {
    setSubmitted(false);
    setError("Failed to create organization.");
  }
}
```

Use label text `Organization name` and button text `Create organization`.

- [ ] **Step 3: Make billing organization-scoped**

Add `getCustomerForOrganizationId()` to `apps/rowboat/app/lib/billing.ts`:

```ts
export async function getCustomerForOrganizationId(workosOrganizationId: string): Promise<z.infer<typeof Customer> | null> {
  const organizationsRepository = container.resolve<IOrganizationsRepository>("organizationsRepository");
  const organization = await organizationsRepository.fetchByWorkosOrganizationId(workosOrganizationId);
  if (!organization) {
    throw new Error("Organization not found");
  }
  if (!organization.billingCustomerId) {
    return null;
  }
  return await getBillingCustomer(organization.billingCustomerId);
}
```

Update `requireBillingCustomer()` to:

```ts
const auth = await requireWorkosAuth();
const user = await requireAuth();

if (!USE_BILLING) {
  return { ...GUEST_BILLING_CUSTOMER, userId: user.id };
}

if (!auth.organizationId) {
  redirect("/onboarding");
}
```

Create billing customers with `organizationId` as the billing service `userId` until the billing service has a dedicated organization field.

- [ ] **Step 4: Add organization ID to projects**

Extend `Project`:

```ts
organizationId: z.string(),
workosAuthorizationResourceId: z.string().optional(),
```

Extend create schema and create use case input:

```ts
organizationId: z.string(),
```

When creating projects from server actions, pass `auth.organizationId` from `requireWorkosAuth()` and reject creation when it is missing.

- [ ] **Step 5: Verify organization gating**

Run:

```bash
cd apps/rowboat
npm run typecheck
```

Expected:

```text
No billing or project creation type errors.
```

Manual verification:

```text
Signed-in user without WorkOS org is redirected to /onboarding.
Creating an organization redirects to /projects.
New projects persist organizationId.
```

---

## Task 8: Project Authorization Actor Model

**Files:**
- Create: `apps/rowboat/src/application/policies/auth-actor.ts`
- Modify: `apps/rowboat/src/application/policies/project-action-authorization.policy.ts`
- Modify: `apps/rowboat/app/actions/project.actions.ts`
- Modify: `apps/rowboat/app/actions/*.actions.ts`
- Modify: controllers and use cases that currently accept `caller`, `userId`, and `apiKey`

- [ ] **Step 1: Add actor union**

Create `apps/rowboat/src/application/policies/auth-actor.ts`:

```ts
import { z } from "zod";

export const UserActor = z.object({
  type: z.literal("user"),
  userId: z.string(),
  organizationId: z.string(),
  organizationMembershipId: z.string().optional(),
  permissions: z.array(z.string()).default([]),
});

export const WorkosApiKeyActor = z.object({
  type: z.literal("workos_api_key"),
  organizationId: z.string(),
  permissions: z.array(z.string()).default([]),
});

export const ProjectApiKeyActor = z.object({
  type: z.literal("project_api_key"),
  projectId: z.string(),
  key: z.string(),
});

export const AuthActor = z.discriminatedUnion("type", [
  UserActor,
  WorkosApiKeyActor,
  ProjectApiKeyActor,
]);

export type AuthActor = z.infer<typeof AuthActor>;
```

- [ ] **Step 2: Replace policy input**

Update `ProjectActionAuthorizationPolicy` input to:

```ts
const inputSchema = z.object({
  actor: AuthActor,
  projectId: z.string(),
  permission: z.enum([
    "project:view",
    "project:edit",
    "project:delete",
    "project:run",
    "project:manage_api_keys",
  ]),
});
```

- [ ] **Step 3: Implement authorization logic**

Use this decision order:

```ts
const project = await this.projectsRepository.fetch(projectId);
if (!project) {
  throw new NotFoundError("Project not found");
}

if (actor.type === "project_api_key") {
  if (actor.projectId !== projectId) {
    throw new NotAuthorizedError("Project API key is not scoped to this project");
  }
  const valid = await this.apiKeysRepository.checkAndConsumeKey(projectId, actor.key);
  if (!valid) {
    throw new NotAuthorizedError("Invalid project API key");
  }
  return;
}

if (actor.organizationId !== project.organizationId) {
  throw new NotAuthorizedError("Actor organization does not match project organization");
}

if (actor.type === "workos_api_key") {
  if (!actor.permissions.includes(permission)) {
    throw new NotAuthorizedError("API key is missing permission");
  }
  return;
}

if (actor.permissions.includes(permission)) {
  return;
}

const membership = await this.projectMembersRepository.exists(projectId, actor.userId);
if (membership) {
  return;
}

if (actor.organizationMembershipId) {
  const allowed = await this.workosAuthorizationService.checkProjectPermission({
    organizationMembershipId: actor.organizationMembershipId,
    projectId,
    permission,
  });
  if (allowed) {
    return;
  }
}

throw new NotAuthorizedError("User is not authorized for this project");
```

- [ ] **Step 4: Add a transition helper for current server actions**

Add this helper near `projectAuthCheck()` in `apps/rowboat/app/actions/project.actions.ts`:

```ts
import { resolveWorkosOrganizationMembershipId } from "@/app/lib/workos-session";

async function getCurrentUserActor() {
  const user = await authCheck();
  const auth = await requireWorkosAuth();
  if (!auth.organizationId) {
    throw new Error("Organization is required");
  }

  const organizationMembershipId = await resolveWorkosOrganizationMembershipId({
    workosUserId: auth.user.id,
    organizationId: auth.organizationId,
  });

  return {
    type: "user" as const,
    userId: user.id,
    organizationId: auth.organizationId,
    organizationMembershipId,
    permissions: auth.permissions || [],
  };
}
```

- [ ] **Step 5: Convert actions incrementally**

For each server action that currently passes:

```ts
caller: "user",
userId: user.id,
projectId,
```

change the controller/use-case input to:

```ts
actor: await getCurrentUserActor(),
projectId,
```

The first batch is:

```text
apps/rowboat/app/actions/project.actions.ts
apps/rowboat/app/actions/data-source.actions.ts
apps/rowboat/app/actions/conversation.actions.ts
apps/rowboat/app/actions/copilot.actions.ts
apps/rowboat/app/actions/job.actions.ts
apps/rowboat/app/actions/scheduled-job-rules.actions.ts
apps/rowboat/app/actions/recurring-job-rules.actions.ts
apps/rowboat/app/actions/composio.actions.ts
apps/rowboat/app/actions/custom-mcp-server.actions.ts
apps/rowboat/app/actions/twilio.actions.ts
```

- [ ] **Step 6: Verify policy compile**

Run:

```bash
cd apps/rowboat
npm run typecheck
```

Expected:

```text
No remaining controller or use-case call sites require caller/userId/apiKey for human project actions.
```

---

## Task 9: WorkOS FGA Project Resources

**Files:**
- Create: `apps/rowboat/src/application/services/workos-authorization.service.ts`
- Modify: `apps/rowboat/src/application/use-cases/projects/create-project.use-case.ts`
- Modify: `apps/rowboat/src/application/use-cases/projects/delete-project.use-case.ts`
- Modify: `apps/rowboat/src/application/use-cases/projects/update-project-name.use-case.ts`
- Create: `apps/rowboat/app/scripts/backfill-project-workos-resources.ts`
- Modify: `apps/rowboat/README.md`

- [ ] **Step 1: Document WorkOS FGA dashboard model**

Add to `apps/rowboat/README.md`:

```markdown
### WorkOS FGA model

Configure these resource types and permissions in WorkOS Authorization:

- Resource type: `project`
- Permissions:
  - `project:view`
  - `project:edit`
  - `project:delete`
  - `project:run`
  - `project:manage_api_keys`
- Roles:
  - `project-owner`: all project permissions
  - `project-editor`: `project:view`, `project:edit`, `project:run`
  - `project-viewer`: `project:view`
```

- [ ] **Step 2: Add WorkOS authorization service**

Create `apps/rowboat/src/application/services/workos-authorization.service.ts`:

```ts
import "server-only";

import { getWorkOS } from "@workos-inc/authkit-nextjs";

export class WorkosAuthorizationService {
  async createProjectResource(data: {
    organizationId: string;
    projectId: string;
    name: string;
  }): Promise<string> {
    const workos = getWorkOS();
    const resource = await workos.authorization.createResource({
      organizationId: data.organizationId,
      resourceTypeSlug: "project",
      externalId: data.projectId,
      name: data.name,
    });

    return resource.id;
  }

  async updateProjectResource(data: {
    organizationId: string;
    projectId: string;
    name: string;
  }): Promise<void> {
    const workos = getWorkOS();
    await workos.authorization.updateResourceByExternalId({
      organizationId: data.organizationId,
      resourceTypeSlug: "project",
      externalId: data.projectId,
      name: data.name,
    });
  }

  async deleteProjectResource(data: {
    organizationId: string;
    projectId: string;
  }): Promise<void> {
    const workos = getWorkOS();
    await workos.authorization.deleteResourceByExternalId({
      organizationId: data.organizationId,
      resourceTypeSlug: "project",
      externalId: data.projectId,
      cascadeDelete: true,
    });
  }

  async assignProjectOwner(data: {
    organizationMembershipId: string;
    projectId: string;
  }): Promise<void> {
    const workos = getWorkOS();
    await workos.authorization.assignRole({
      organizationMembershipId: data.organizationMembershipId,
      roleSlug: "project-owner",
      resourceExternalId: data.projectId,
      resourceTypeSlug: "project",
    });
  }

  async checkProjectPermission(data: {
    organizationMembershipId: string;
    projectId: string;
    permission: string;
  }): Promise<boolean> {
    const workos = getWorkOS();
    const result = await workos.authorization.check({
      organizationMembershipId: data.organizationMembershipId,
      permissionSlug: data.permission,
      resourceExternalId: data.projectId,
      resourceTypeSlug: "project",
    });

    return Boolean(result.authorized);
  }
}
```

- [ ] **Step 3: Register service in Awilix**

In `apps/rowboat/di/container.ts`, register:

```ts
workosAuthorizationService: asClass(WorkosAuthorizationService).singleton(),
```

- [ ] **Step 4: Register project resource on create**

After `projectsRepository.create()` in `CreateProjectUseCase`, call:

```ts
const workosAuthorizationResourceId = await this.workosAuthorizationService.createProjectResource({
  organizationId: request.organizationId,
  projectId: project.id,
  name: project.name,
});

await this.projectsRepository.updateWorkosAuthorizationResourceId(project.id, workosAuthorizationResourceId);

if (request.organizationMembershipId) {
  await this.workosAuthorizationService.assignProjectOwner({
    organizationMembershipId: request.organizationMembershipId,
    projectId: project.id,
  });
}
```

- [ ] **Step 5: Keep resource in sync**

On project rename, call `updateProjectResource()`. On project delete, call `deleteProjectResource()` before removing local project data.

- [ ] **Step 6: Backfill existing projects**

Create `apps/rowboat/app/scripts/backfill-project-workos-resources.ts`:

```ts
import "../lib/loadenv";
import { container } from "@/di/container";
import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";
import { WorkosAuthorizationService } from "@/src/application/services/workos-authorization.service";

async function main() {
  const projectsRepository = container.resolve<IProjectsRepository>("projectsRepository");
  const workosAuthorizationService = container.resolve<WorkosAuthorizationService>("workosAuthorizationService");

  const projects = await projectsRepository.listAllForBackfill();
  for (const project of projects) {
    if (!project.organizationId) {
      console.warn(`Skipping ${project.id}: missing organizationId`);
      continue;
    }

    const resourceId = await workosAuthorizationService.createProjectResource({
      organizationId: project.organizationId,
      projectId: project.id,
      name: project.name,
    });

    await projectsRepository.updateWorkosAuthorizationResourceId(project.id, resourceId);
    console.log(`Registered project ${project.id} as WorkOS resource ${resourceId}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 7: Verify FGA path**

Run:

```bash
cd apps/rowboat
npm run typecheck
```

Expected:

```text
No WorkOS authorization service type errors.
```

Manual verification in staging:

```text
Create project.
Confirm a WorkOS authorization resource exists with resource type `project` and external ID equal to Rowboat project ID.
Confirm the creator's organization membership has `project-owner`.
Confirm a user without membership or FGA role gets NotAuthorizedError.
```

---

## Task 10: API Keys And Public API Authentication

**Files:**
- Modify: `apps/rowboat/src/entities/models/api-key.ts`
- Modify: `apps/rowboat/src/application/repositories/api-keys.repository.interface.ts`
- Modify: `apps/rowboat/src/infrastructure/repositories/mongodb.api-keys.repository.ts`
- Modify: `apps/rowboat/src/application/use-cases/api-keys/create-api-key.use-case.ts`
- Modify: `apps/rowboat/app/api/v1/[projectId]/chat/route.ts`
- Modify: `apps/rowboat/app/projects/[projectId]/config/components/project.tsx`

- [ ] **Step 1: Rename local key semantics**

Update the model to make local keys explicitly project-scoped:

```ts
import { z } from "zod";

export const ProjectApiKey = z.object({
  id: z.string(),
  projectId: z.string(),
  keyHash: z.string(),
  keyPrefix: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
});
```

Keep the old `key` field readable in the repository during migration, but write only `keyHash` and `keyPrefix` for new keys.

- [ ] **Step 2: Hash generated project keys**

Use this helper in the repository or use case:

```ts
import crypto from "crypto";

export function hashProjectApiKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createProjectApiKeySecret(): { value: string; hash: string; prefix: string } {
  const value = `rbp_${crypto.randomBytes(32).toString("hex")}`;
  return {
    value,
    hash: hashProjectApiKey(value),
    prefix: value.slice(0, 12),
  };
}
```

- [ ] **Step 3: Validate WorkOS API keys in public API**

In `apps/rowboat/app/api/v1/[projectId]/chat/route.ts`, parse bearer tokens with this order:

```ts
const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

let actor;
if (bearer?.startsWith("rbp_")) {
  actor = {
    type: "project_api_key" as const,
    projectId,
    key: bearer,
  };
} else if (bearer) {
  let apiKey;
  try {
    ({ apiKey } = await validateApiKey());
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!apiKey || apiKey.owner.type !== "organization") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  actor = {
    type: "workos_api_key" as const,
    organizationId: apiKey.owner.id,
    permissions: apiKey.permissions || [],
  };
} else {
  return Response.json({ error: "Missing bearer token" }, { status: 401 });
}
```

Authorize with permission `project:run` before calling `runTurnController`.

- [ ] **Step 4: Move WorkOS API key management out of project config**

Keep project-scoped keys in the existing project config UI and label them `Project API keys`.

Add a separate section that links to WorkOS organization API key management:

```tsx
<p className="text-sm text-muted-foreground">
  Organization API keys are managed by WorkOS and can be used across projects in this organization when granted `project:run`.
</p>
```

If the WorkOS API Keys Widget is available in the installed package, render it on an organization settings page. If the widget is not exported by the installed package, keep the link-based management surface and use WorkOS Dashboard for the first cut.

- [ ] **Step 5: Verify API auth**

Run:

```bash
cd apps/rowboat
npm run test -- app/api/v1/[projectId]/chat/route.test.ts
npm run typecheck
```

Expected:

```text
Valid WorkOS API key with project:run can call the chat route for a project in the same organization.
Valid WorkOS API key without project:run gets 403.
Valid project API key can call only its own project.
Missing bearer token gets 401.
```

---

## Task 11: Widget Session Auth Repair

**Files:**
- Modify: `apps/rowboat/app/api/widget/v1/utils.ts`
- Modify: `apps/rowboat/app/api/widget/v1/session/guest/route.ts`
- Modify: `apps/rowboat/app/api/widget/v1/session/user/route.ts`
- Modify: `apps/rowboat/app/api/widget/v1/chats/route.ts`
- Modify: `apps/rowboat/app/api/widget/v1/chats/[chatId]/route.ts`
- Modify: `apps/rowboat/app/api/widget/v1/chats/[chatId]/messages/route.ts`
- Modify: `apps/rowboat/app/api/widget/v1/chats/[chatId]/turn/route.ts`
- Modify: `apps/rowboat/app/api/widget/v1/chats/[chatId]/close/route.ts`

- [ ] **Step 1: Implement client ID check**

Replace the stub in `utils.ts`:

```ts
import { container } from "@/di/container";
import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";

export async function clientIdCheck(req: NextRequest, handler: (projectId: string) => Promise<Response>): Promise<Response> {
  const clientId = req.headers.get("x-client-id")?.trim();
  if (!clientId) {
    return Response.json({ error: "Missing client ID in request" }, { status: 400 });
  }

  const projectsRepository = container.resolve<IProjectsRepository>("projectsRepository");
  const project = await projectsRepository.fetchByPublicClientId(clientId);
  if (!project) {
    return Response.json({ error: "Invalid client ID" }, { status: 403 });
  }

  return await handler(project.id);
}
```

Add `publicClientId` to `Project` if widget embed needs a stable public ID separate from `project.id`.

- [ ] **Step 2: Implement session JWT check**

Replace the stub in `utils.ts`:

```ts
export async function authCheck(req: NextRequest, handler: (session: z.infer<typeof Session>) => Promise<Response>): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Authorization header must be a Bearer token" }, { status: 400 });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return Response.json({ error: "Missing session token in request" }, { status: 400 });
  }

  try {
    const session = await jwtVerify(token, new TextEncoder().encode(process.env.CHAT_WIDGET_SESSION_JWT_SECRET));
    return await handler(Session.parse(session.payload));
  } catch {
    return Response.json({ error: "Invalid session token" }, { status: 403 });
  }
}
```

- [ ] **Step 3: Bring user session route online**

Replace `501` in `session/user/route.ts` with JWT verification against a project secret or WorkOS-backed project API key, then issue a widget session JWT. The request body must parse `apiV1.ApiCreateUserSessionRequest`.

- [ ] **Step 4: Verify widget routes no longer return 501**

Run:

```bash
rg -n "Not implemented|status: 501" apps/rowboat/app/api/widget
```

Expected:

```text
No matches.
```

---

## Task 12: Auth0-To-WorkOS Migration

**Files:**
- Create: `apps/rowboat/app/scripts/migrate-auth0-users-to-workos.ts`
- Modify: `apps/rowboat/README.md`

- [ ] **Step 1: Export Auth0 users**

Export Auth0 users with these fields:

```text
user_id
email
email_verified
given_name
family_name
name
password_hash
```

If password hashes are available, import them into WorkOS with `password_hash_type` set to `bcrypt`.

- [ ] **Step 2: Import users into WorkOS**

For each Auth0 user, create or update WorkOS user with:

```ts
await workos.userManagement.createUser({
  email: auth0User.email,
  emailVerified: Boolean(auth0User.email_verified),
  firstName: auth0User.given_name,
  lastName: auth0User.family_name,
  externalId: auth0User.user_id,
  metadata: {
    legacyAuth0Id: auth0User.user_id,
  },
});
```

If the user already exists, call `getUserByExternalId(auth0User.user_id)` and then `updateUser()`.

- [ ] **Step 3: Backfill local users**

Create `apps/rowboat/app/scripts/migrate-auth0-users-to-workos.ts`:

```ts
import "../lib/loadenv";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { container } from "@/di/container";
import { IUsersRepository } from "@/src/application/repositories/users.repository.interface";

async function main() {
  const usersRepository = container.resolve<IUsersRepository>("usersRepository");
  const workos = getWorkOS();

  const localUsers = await usersRepository.listUsersWithLegacyAuth0Id();
  for (const localUser of localUsers) {
    if (!localUser.legacyAuth0Id) {
      continue;
    }

    const workosUser = await workos.userManagement.getUserByExternalId(localUser.legacyAuth0Id);
    await usersRepository.upsertFromWorkos({
      workosUserId: workosUser.id,
      legacyAuth0Id: localUser.legacyAuth0Id,
      email: workosUser.email || localUser.email,
      name: [workosUser.firstName, workosUser.lastName].filter(Boolean).join(" ") || localUser.name,
    });

    console.log(`Linked local user ${localUser.id} to WorkOS user ${workosUser.id}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Verify migration coverage**

Run:

```bash
cd apps/rowboat
npm run migrate-auth0-users-to-workos
```

Expected:

```text
Every local user with legacyAuth0Id is linked to a WorkOS user.
No project_members rows are rewritten.
No projects are orphaned.
```

---

## Task 13: Tests

**Files:**
- Create: `apps/rowboat/app/lib/workos-session.test.ts`
- Create: `apps/rowboat/src/application/policies/project-action-authorization.policy.test.ts`
- Create: `apps/rowboat/app/api/v1/[projectId]/chat/route.test.ts`
- Modify: `apps/rowboat/package.json`

- [ ] **Step 1: Test user sync**

Cover:

```text
Creates local user for first WorkOS login.
Updates email/name/currentOrganizationId on repeat login.
Links user by legacyAuth0Id when WorkOS externalId matches old Auth0 subject.
Returns guest user when USE_AUTH=false.
```

- [ ] **Step 2: Test project authorization**

Cover:

```text
User actor with matching organization and project membership is authorized.
User actor with mismatched organization is rejected.
User actor without membership uses WorkOS FGA and is authorized when FGA returns true.
WorkOS API key actor needs matching organization and requested permission.
Project API key actor only authorizes its own project.
```

- [ ] **Step 3: Test public chat API auth**

Cover:

```text
Missing Authorization header returns 401.
Invalid WorkOS API key returns 401.
WorkOS API key without project:run returns 403.
Project API key for another project returns 403.
Valid project API key calls runTurnController.
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd apps/rowboat
npm run test
npm run typecheck
npm run build
```

Expected:

```text
All tests pass.
TypeScript passes.
Next.js build completes.
```

---

## Task 14: Cutover Verification

**Files:**
- Modify: deployment environment outside this repo
- Modify: `apps/rowboat/README.md`

- [ ] **Step 1: Local smoke**

Run:

```bash
cd apps/rowboat
USE_AUTH=true npm run dev
```

Verify:

```text
/ redirects unauthenticated users to WorkOS AuthKit.
/auth/callback creates or updates a local user.
/projects loads after login.
Logout from the user menu clears the WorkOS session.
```

- [ ] **Step 2: Authenticated app smoke**

Verify:

```text
Create project.
List projects.
Open workflow editor.
Save workflow.
Publish workflow.
Open billing page.
Create project API key.
Call /api/v1/:projectId/chat with project API key.
Call /api/v1/:projectId/chat with WorkOS organization API key.
```

- [ ] **Step 3: Negative authorization smoke**

Verify:

```text
User from another WorkOS organization cannot open the project.
WorkOS API key from another organization cannot call the project.
WorkOS API key without project:run cannot call the chat route.
Deleted project key no longer works.
Widget session JWT from one project cannot read another project chat.
```

- [ ] **Step 4: Remove Auth0 configuration**

After staging passes:

```bash
rg -n "AUTH0_|auth0|Auth0|@auth0" apps/rowboat --glob '!package-lock.json'
```

Expected:

```text
No matches.
```

Then remove Auth0 secrets from deployment environments and keep:

```text
WORKOS_CLIENT_ID
WORKOS_API_KEY
WORKOS_COOKIE_PASSWORD
NEXT_PUBLIC_WORKOS_REDIRECT_URI
```

---

## Self-Review

- Spec coverage: The plan covers login, signup, callback, logout, server sessions, client sessions, local user persistence, Auth0 user migration, organizations, onboarding, billing, project authorization, FGA, project API keys, WorkOS API keys, widget/session auth, tests, and cutover verification.
- Placeholder scan: The plan does not leave unresolved placeholder markers or generic "add tests" instructions without concrete cases.
- Type consistency: External identity is consistently named `workosUserId`; old Auth0 subject is `legacyAuth0Id`; tenant identity is `organizationId`; project resource permissions use `project:*`; user actors carry a resolved `organizationMembershipId` only after looking it up through WorkOS User Management.
- Risk notes: WorkOS FGA role and resource type setup is a dashboard prerequisite. WorkOS organization API keys are organization-scoped, so Rowboat project-scoped widget secrets remain separate by design.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-05-20-workos-auth-rework.md`. Two execution options:

1. Subagent-Driven (recommended) - Dispatch a fresh worker per task, review between tasks, and keep changes scoped.
2. Inline Execution - Execute tasks in this session with checkpoints after dependency/auth adapter, persistence, authorization, and cutover verification.
