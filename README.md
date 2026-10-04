# CF Access Test

🌐 **English** | [中文](README.zh-CN.md)

A **reference app** for [CF Access Hub Manager](https://github.com/WBhlietue/CF-Access-Hub): it shows how a business Worker calls the hub through a **Service Binding** to get the current visitor's permission info.

The example is built with **Astro**. For other full-stack frameworks (Next.js, SvelteKit, …), look up your own equivalent — only two things are actually yours to write: the `services` declaration in `wrangler.jsonc`, and `await env.ACCESS.GetPermissions(...)` in code. Everything else comes from the framework's own middleware / request-context mechanism.

## What it does

```
Browser ──▶ Access sign-in ──▶ this Worker (cf-access-test)
                                 │
                                 ├─ src/middleware.ts
                                 │     ① read Cf-Access-Jwt-Assertion
                                 │     ② env.ACCESS.GetPermissions(jwt, "cf-access-test")
                                 │
                                 ▼
                    CF Access Hub Manager (cf-access-hub-manager)
                    ServiceBinding entrypoint → CheckPermission
                    (verify JWT → query D1 → return role and permission)
                                 │
                                 ▼
         { success: true, data: { roleName, permission, username, email } }
                                 │
                                 ▼
                   src/pages/d/index.astro renders it
```

| File | Role |
| --- | --- |
| `wrangler.jsonc` | Declares the `ACCESS` Service Binding to the hub |
| `src/middleware.ts` | Reads the JWT, calls the hub, stores the result in `Astro.locals.user` |
| `src/pages/d/index.astro` | Renders `Astro.locals.user` |
| `astro.config.mjs` | `output: "static"` plus the Cloudflare adapter |

## Prerequisites

1. **CF Access Hub Manager is deployed**;
2. **This project has been added to the hub panel** — a project exists there whose `projectID` equals this Worker's `name` (`cf-access-test` here), and this Worker is protected by that project's Access application;
3. Requests reaching `/d` have already passed Access, so they carry the `Cf-Access-Jwt-Assertion` header. That JWT's audience must match the `aud` the hub recorded for this project.

## 1. Declare the Service Binding

`wrangler.jsonc`:

```jsonc
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"compatibility_date": "2026-10-01",
	"compatibility_flags": ["global_fetch_strictly_public"],
	"name": "cf-access-test",
	"main": "@astrojs/cloudflare/entrypoints/server",
	"assets": {
		"directory": "./dist",
		"binding": "ASSETS"
	},
	"services": [
		{
			"binding": "ACCESS",
			"service": "cf-access-hub-manager",
			"entrypoint": "ServiceBinding"
		}
	]
}
```

| Field | Meaning |
| --- | --- |
| `binding` | the variable name used in code, `env.ACCESS` here |
| `service` | **the hub manager's Worker name**. If you renamed the hub, switch this by hand |
| `entrypoint` | the RPC entrypoint name the hub exposes; it must be `ServiceBinding`, otherwise the call never reaches `GetPermissions` |

Note that `service` is the Worker name, not the hub's URL.

## 2. Call `GetPermissions`

`src/middleware.ts`:

```ts
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

export const onRequest = defineMiddleware(async (context, next) => {
    const pathName = context.url.pathname;

    if (pathName.startsWith("/d")) {
        const jwt = context.request.headers.get("Cf-Access-Jwt-Assertion");
        if (!jwt) {
            return new Response("Unauthorized", { status: 401 });
        }

        const result = await env.ACCESS.GetPermissions(jwt, "cf-access-test");
        if (!result.success) {
            return new Response("Unauthorized", { status: 401 });
        }

        context.locals.user = result.data;
    }

    return next();
});
```

The two arguments:

| Argument | Meaning |
| --- | --- |
| `jwt` | the value of the `Cf-Access-Jwt-Assertion` header |
| `projectID` | **this Worker's own name**, i.e. the `name` field in this project's `wrangler.jsonc` (`cf-access-test`). It is also the projectID in the hub panel; the two must match |

Every path starting with `/d` goes through this: no JWT, or the hub deciding there is no permission (`success: false`), returns 401 without rendering the page.

## 3. Render the permission info

`src/pages/d/index.astro`:

```astro
---
export const prerender = false;
const user = Astro.locals.user;
---

<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>CF Access Test</title>
    </head>
    <body>
        <h1>user name: {user.username}</h1>
        <h1>user email: {user.email}</h1>
        <h1>user role: {user.roleName}</h1>
        <h1>user permission: {user.permission}</h1>
    </body>
</html>
```

> **`export const prerender = false;` is mandatory.**
> `astro.config.mjs` sets `output: "static"`, so pages are prerendered at build time by default: no request exists then, the middleware never runs, and `Astro.locals.user` is necessarily `undefined`. With `prerender = false` this route becomes on-demand SSR inside the Worker — the only situation where the middleware and `Astro.locals` exist.

## Return shape

`GetPermissions` returns a `Result` with **no HTTP status to check**; branch on `success`:

Success:

```json
{
  "success": true,
  "data": {
    "roleName": "videomanager",
    "permission": "vid:write",
    "username": "Jane Doe",
    "email": "jane@example.com"
  }
}
```

Failure:

```json
{ "success": false, "data": "nopermission" }
```

- `data` carries the person's `username` and `email`, plus that user's `roleName` and `permission` inside this project;
- on failure `data` is a plain message (`nopermission`, `project not found`, a JWT verification error, …); the hub maps those to error codes only on its own HTTP routes;
- `permission` is entirely project-defined (`*`, `vid:write`, `001001`, `rwx--`, …). The hub passes it through without interpreting it, and so does this app — interpret it however you need.

## Local development

```bash
npm install              # install dependencies
npm run dev              # astro dev server
npm run build            # build to ./dist
npm run generate-types   # regenerate worker-configuration.d.ts (env / binding types)
```

Service Bindings only exist in the Workers runtime, so a local render without the Access header answers `401` — that is the middleware rejecting a missing JWT, not a binding failure. To really reach the hub, run the build output in a Workers runtime (`npx wrangler dev` after `npm run build`) or deploy it.

## See also

- [CF Access Hub Manager](https://github.com/WBhlietue/CF-Access-Hub)