import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

export const onRequest = defineMiddleware(async (context, next) => {
    let sign = context.request.headers.get("Cf-Access-Jwt-Assertion") || "";

    const pathName = context.url.pathname;

    if (pathName.startsWith("/d")) {
        let sign =
            context.request.headers.get("Cf-Access-Jwt-Assertion") || null;
        if (!sign) {
            return new Response("Unauthorized", { status: 401 });
        }
        const user = await env.ACCESS.GetPermissions(sign, "cf-access-test");
        if (user.success) {
            context.locals.user = user.data;
        } else {
            context.locals.user = null;
            return new Response("Unauthorized", { status: 401 });
        }
    }

    return next();
});
