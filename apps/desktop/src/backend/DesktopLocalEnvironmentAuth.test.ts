import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "./DesktopLocalEnvironmentAuth.ts";
import * as DesktopLocalEnvironmentAuthTokenStore from "./DesktopLocalEnvironmentAuthTokenStore.ts";

const config = {
  executablePath: "/electron",
  entryPath: "/server/bin.mjs",
  cwd: "/server",
  env: {},
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    t3Home: "/tmp/t3",
    host: "127.0.0.1",
    desktopBootstrapToken: "desktop-bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
};

describe("DesktopLocalEnvironmentAuth", () => {
  it.effect("exchanges the desktop bootstrap credential only once", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);
      const persistedToken = yield* Ref.make(Option.none<string>());
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requestCount, (count) => count + 1).pipe(
            Effect.as(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  JSON.stringify({
                    access_token: "desktop-bearer-token",
                    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                    token_type: "Bearer",
                    expires_in: 3600,
                    scope: "orchestration:read",
                  }),
                  { status: 200, headers: { "content-type": "application/json" } },
                ),
              ),
            ),
          ),
        ),
      );
      const poolLayer = Layer.succeed(DesktopBackendPool.DesktopBackendPool, {
        list: Effect.succeed([
          {
            id: PRIMARY_LOCAL_ENVIRONMENT_ID,
            label: Effect.succeed("Windows"),
            currentConfig: Effect.succeed(Option.some(config)),
          },
        ]),
      } as unknown as DesktopBackendPool.DesktopBackendPool["Service"]);
      const tokenStoreLayer = Layer.succeed(
        DesktopLocalEnvironmentAuthTokenStore.DesktopLocalEnvironmentAuthTokenStore,
        {
          get: Ref.get(persistedToken),
          set: (token) => Ref.set(persistedToken, Option.some(token)).pipe(Effect.as(true)),
          clear: Ref.set(persistedToken, Option.none()),
        },
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(Layer.mergeAll(poolLayer, httpClientLayer, tokenStoreLayer)),
      );

      const [first, second] = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* Effect.all([auth.getBearerToken, auth.getBearerToken]);
      }).pipe(Effect.provide(testLayer));

      assert.strictEqual(first, "desktop-bearer-token");
      assert.strictEqual(second, "desktop-bearer-token");
      assert.strictEqual(yield* Ref.get(requestCount), 1);
    }),
  );

  it.effect("reuses a persisted bearer session after the desktop service restarts", () =>
    Effect.gen(function* () {
      const requests = yield* Ref.make<ReadonlyArray<string>>([]);
      const persistedToken = yield* Ref.make(Option.none<string>());
      const httpClientLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requests, (current) => [...current, request.url]).pipe(
            Effect.as(
              HttpClientResponse.fromWeb(
                request,
                request.url.endsWith("/oauth/token")
                  ? Response.json({
                      access_token: "desktop-bearer-token",
                      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                      token_type: "Bearer",
                      expires_in: 3600,
                      scope: "orchestration:read",
                    })
                  : Response.json({
                      authenticated: true,
                      auth: {
                        policy: "desktop-managed-local",
                        bootstrapMethods: ["desktop-bootstrap"],
                        sessionMethods: ["bearer-access-token"],
                        sessionCookieName: "t3_session",
                      },
                      scopes: ["orchestration:read"],
                      sessionMethod: "bearer-access-token",
                      expiresAt: "2026-08-01T00:00:00.000Z",
                    }),
              ),
            ),
          ),
        ),
      );
      const poolLayer = Layer.succeed(DesktopBackendPool.DesktopBackendPool, {
        list: Effect.succeed([
          {
            id: PRIMARY_LOCAL_ENVIRONMENT_ID,
            label: Effect.succeed("Windows"),
            currentConfig: Effect.succeed(Option.some(config)),
          },
        ]),
      } as unknown as DesktopBackendPool.DesktopBackendPool["Service"]);
      const tokenStoreLayer = Layer.succeed(
        DesktopLocalEnvironmentAuthTokenStore.DesktopLocalEnvironmentAuthTokenStore,
        {
          get: Ref.get(persistedToken),
          set: (token) => Ref.set(persistedToken, Option.some(token)).pipe(Effect.as(true)),
          clear: Ref.set(persistedToken, Option.none()),
        },
      );
      const testLayer = DesktopLocalEnvironmentAuth.layer.pipe(
        Layer.provide(Layer.mergeAll(poolLayer, httpClientLayer, tokenStoreLayer)),
      );
      const readToken = DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth.pipe(
        Effect.flatMap((auth) => auth.getBearerToken),
      );

      assert.strictEqual(yield* readToken.pipe(Effect.provide(testLayer)), "desktop-bearer-token");
      assert.strictEqual(yield* readToken.pipe(Effect.provide(testLayer)), "desktop-bearer-token");
      assert.deepStrictEqual(yield* Ref.get(requests), [
        "http://127.0.0.1:3773/oauth/token",
        "http://127.0.0.1:3773/api/auth/session",
      ]);
    }),
  );
});
