import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopLocalEnvironmentAuthTokenStore from "./DesktopLocalEnvironmentAuthTokenStore.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function makeLayer(
  baseDir: string,
  encryptionAvailable = true,
  platform: NodeJS.Platform = "darwin",
  storageBackend = "unknown",
) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform,
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
  const safeStorageLayer = Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
    isEncryptionAvailable: Effect.succeed(encryptionAvailable),
    encryptString: (value) => Effect.succeed(textEncoder.encode(`encrypted:${value}`)),
    decryptString: (value) => Effect.succeed(textDecoder.decode(value).replace(/^encrypted:/, "")),
    selectedStorageBackend: Effect.succeed(
      platform === "linux" ? Option.some(storageBackend) : Option.none(),
    ),
  } satisfies ElectronSafeStorage.ElectronSafeStorage["Service"]);

  return DesktopLocalEnvironmentAuthTokenStore.layer.pipe(
    Layer.provideMerge(environmentLayer),
    Layer.provideMerge(safeStorageLayer),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withStore = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | DesktopLocalEnvironmentAuthTokenStore.DesktopLocalEnvironmentAuthTokenStore
  >,
  encryptionAvailable = true,
  platform: NodeJS.Platform = "darwin",
  storageBackend = "unknown",
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-local-auth-test-",
    });
    return yield* effect.pipe(
      Effect.provide(makeLayer(baseDir, encryptionAvailable, platform, storageBackend)),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("DesktopLocalEnvironmentAuthTokenStore", () => {
  it.effect("persists, reads, and clears an encrypted bearer token", () =>
    withStore(
      Effect.gen(function* () {
        const store =
          yield* DesktopLocalEnvironmentAuthTokenStore.DesktopLocalEnvironmentAuthTokenStore;

        assert.deepStrictEqual(yield* store.get, Option.none());
        assert.isTrue(yield* store.set("desktop-bearer-token"));
        assert.deepStrictEqual(yield* store.get, Option.some("desktop-bearer-token"));
        yield* store.clear;
        assert.deepStrictEqual(yield* store.get, Option.none());
      }),
    ),
  );

  it.effect("does not persist a token when secure storage is unavailable", () =>
    withStore(
      Effect.gen(function* () {
        const store =
          yield* DesktopLocalEnvironmentAuthTokenStore.DesktopLocalEnvironmentAuthTokenStore;

        assert.isFalse(yield* store.set("desktop-bearer-token"));
        assert.deepStrictEqual(yield* store.get, Option.none());
      }),
      false,
    ),
  );

  it.effect("does not persist a token with Linux's basic_text storage backend", () =>
    withStore(
      Effect.gen(function* () {
        const store =
          yield* DesktopLocalEnvironmentAuthTokenStore.DesktopLocalEnvironmentAuthTokenStore;

        assert.isFalse(yield* store.set("desktop-bearer-token"));
        assert.deepStrictEqual(yield* store.get, Option.none());
      }),
      true,
      "linux",
      "basic_text",
    ),
  );
});
