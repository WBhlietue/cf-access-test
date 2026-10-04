# CF Access Test

🌐 [English](README.md) | **中文**



此项目为 [CF Access Hub Manager](https://github.com/WBhlietue/CF-Access-Hub) 的**范例应用**，示范如何在业务 Worker 里通过 **Service Binding** 调用 hub，获取当前访问者的权限信息。

范例使用 **Astro** 开发。Next.js、SvelteKit 等其他全站框架请自行查找对应写法 —— 真正需要自己写的只有两处：`wrangler.jsonc` 里的 `services` 声明，以及代码里的 `await env.ACCESS.GetPermissions(...)`，其余都是框架自带的 middleware / 请求上下文机制。

## 它做了什么

```
浏览器 ──▶ Access 验证页 ──▶ 本 Worker（cf-access-test）
                                │
                                ├─ src/middleware.ts
                                │     ① 取 Cf-Access-Jwt-Assertion
                                │     ② env.ACCESS.GetPermissions(jwt, "cf-access-test")
                                │
                                ▼
                   CF Access Hub Manager（cf-access-hub-manager）
                   ServiceBinding 入口 → CheckPermission
                   （验签 JWT → 查 D1 → 返回职务与权限）
                                │
                                ▼
        { success: true, data: { roleName, permission, username, email } }
                                │
                                ▼
                  src/pages/d/index.astro 渲染到页面
```

| 文件 | 作用 |
| --- | --- |
| `wrangler.jsonc` | 声明指向 hub 的 `ACCESS` Service Binding |
| `src/middleware.ts` | 读 JWT、调 hub、把结果写进 `Astro.locals.user` |
| `src/pages/d/index.astro` | 渲染 `Astro.locals.user` |
| `astro.config.mjs` | `output: "static"` + Cloudflare adapter |

## 前置条件

1. **CF Access Hub Manager 已部署**；
2. **该项目已添加到 hub 面板中** —— 即面板里存在一个 `projectID` 与本项目 Worker `name` 相同的项目（这里是 `cf-access-test`），并且本项目的访问由该项目对应的 Access 应用保护；
3. 到达 `/d` 的请求已经过 Access，带着 `Cf-Access-Jwt-Assertion` 请求头；该 JWT 的 audience 必须与 hub 中该项目记录的 `aud` 一致。

## 1. 声明 Service Binding

`wrangler.jsonc`：

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

| 字段 | 说明 |
| --- | --- |
| `binding` | 代码里使用的变量名，这里是 `env.ACCESS` |
| `service` | **hub manager 的 Worker name**。如果你给 hub 换过名字，这里要手动同步改掉 |
| `entrypoint` | hub 暴露的 RPC 入口名，必须是 `ServiceBinding`；漏掉它调用就到不了 `GetPermissions` |

注意 `service` 填的是 Worker name，不是 hub 的网址。

## 2. 调用 `GetPermissions`

`src/middleware.ts`：

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

`GetPermissions` 的两个参数：

| 参数 | 说明 |
| --- | --- |
| `jwt` | `Cf-Access-Jwt-Assertion` 请求头的值 |
| `projectID` | **本项目自己的 Worker name**，也就是本项目 `wrangler.jsonc` 里的 `name` 字段（这里 `cf-access-test`）。它同时是 hub 面板里的 projectID，两者必须一致 |

只要路径以 `/d` 开头就会走这段逻辑：没有 JWT、或 hub 判定无权限（`success: false`），直接返回 401，不再渲染页面。

## 3. 渲染权限信息

`src/pages/d/index.astro`：

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

> **`export const prerender = false;` 必须写。**
> `astro.config.mjs` 里是 `output: "static"`，页面默认在构建期预渲染：那时没有请求、middleware 不会执行，`Astro.locals.user` 必然是 `undefined`。加了 `prerender = false` 之后这个路由变成 Worker 内的按需 SSR，只有这种情况下 middleware 与 `Astro.locals` 才存在。

## 返回结构

`GetPermissions` 返回的是一个 `Result`，**没有 HTTP 状态码可判断**，看 `success`：

成功：

```json
{
  "success": true,
  "data": {
    "roleName": "videomanager",
    "permission": "vid:write",
    "username": "张三",
    "email": "zhangsan@example.com"
  }
}
```

失败：

```json
{ "success": false, "data": "nopermission" }
```

- `data` 里是人员信息：`username`、`email`，以及该项目里该用户的 `roleName` 与 `permission`；
- 失败时 `data` 是纯文本信息（`nopermission`、`project not found`、JWT 校验错误等）；只有在 hub 自己的 HTTP 路由上，这些信息才会被映射成错误码；
- `permission` 完全由项目自定义（`*`、`vid:write`、`001001`、`rwx--` 等），hub 只透传，本项目也不解释，按需自行判断即可。

## 本地开发

```bash
npm install              # 安装依赖
npm run dev              # astro 开发服务器
npm run build            # 构建到 ./dist
npm run generate-types   # 重新生成 worker-configuration.d.ts（env / binding 类型）
```

Service Binding 只在 Workers 运行时里存在，所以本地不带 Access 请求头的渲染会返回 `401` —— 那是 middleware 在拒绝缺失的 JWT，不是 binding 报错。要真正调到 hub，把构建产物放进 Workers 运行时（`npm run build` 后 `npx wrangler dev`）或者直接部署。

## 相关链接

- [CF Access Hub Manager](https://github.com/WBhlietue/CF-Access-Hub)
- [English README](README.md)
