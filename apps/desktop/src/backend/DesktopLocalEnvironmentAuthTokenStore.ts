import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

const TokenDocument = Schema.Struct({
  version: Schema.Literal(1),
  encryptedToken: Schema.String,
});
type TokenDocument = typeof TokenDocument.Type;

const TokenDocumentJson = fromLenientJson(TokenDocument);
const decodeTokenDocumentJson = Schema.decodeEffect(TokenDocumentJson);
const encodeTokenDocumentJson = Schema.encodeEffect(TokenDocumentJson);

const TokenStoreOperation = Schema.Literals([
  "read",
  "decode-document",
  "check-encryption-availability",
  "decode-token",
  "decrypt-token",
  "encrypt-token",
  "encode-document",
  "create-temporary-file-name",
  "create-directory",
  "write-temporary-file",
  "replace-file",
  "clear",
]);

export class DesktopLocalEnvironmentAuthTokenStoreError extends Schema.TaggedErrorClass<DesktopLocalEnvironmentAuthTokenStoreError>()(
  "DesktopLocalEnvironmentAuthTokenStoreError",
  {
    operation: TokenStoreOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop local authorization token store failed during ${this.operation} at ${this.path}.`;
  }
}

export class DesktopLocalEnvironmentAuthTokenStore extends Context.Service<
  DesktopLocalEnvironmentAuthTokenStore,
  {
    readonly get: Effect.Effect<Option.Option<string>, DesktopLocalEnvironmentAuthTokenStoreError>;
    readonly set: (
      token: string,
    ) => Effect.Effect<boolean, DesktopLocalEnvironmentAuthTokenStoreError>;
    readonly clear: Effect.Effect<void, DesktopLocalEnvironmentAuthTokenStoreError>;
  }
>()("@t3tools/desktop/backend/DesktopLocalEnvironmentAuthTokenStore") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const crypto = yield* Crypto.Crypto;
  const tokenPath = path.join(environment.stateDir, "desktop-local-auth.json");

  const readDocument = fileSystem.readFileString(tokenPath).pipe(
    Effect.catch((error) =>
      error.reason._tag === "NotFound"
        ? Effect.succeed<string | null>(null)
        : Effect.fail(
            new DesktopLocalEnvironmentAuthTokenStoreError({
              operation: "read",
              path: tokenPath,
              cause: error,
            }),
          ),
    ),
    Effect.flatMap((raw) =>
      raw === null
        ? Effect.succeed(Option.none<TokenDocument>())
        : decodeTokenDocumentJson(raw).pipe(
            Effect.map(Option.some),
            Effect.mapError(
              (cause) =>
                new DesktopLocalEnvironmentAuthTokenStoreError({
                  operation: "decode-document",
                  path: tokenPath,
                  cause,
                }),
            ),
          ),
    ),
  );

  const encryptionAvailable = safeStorage.isEncryptionAvailable.pipe(
    Effect.mapError(
      (cause) =>
        new DesktopLocalEnvironmentAuthTokenStoreError({
          operation: "check-encryption-availability",
          path: tokenPath,
          cause,
        }),
    ),
  );
  const secureStorageAvailable = Effect.gen(function* () {
    if (!(yield* encryptionAvailable)) {
      return false;
    }
    return !Option.contains(yield* safeStorage.selectedStorageBackend, "basic_text");
  });

  const writeDocument = Effect.fn("desktop.localEnvironmentAuthTokenStore.writeDocument")(
    function* (document: TokenDocument) {
      const suffix = (yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(
          (cause) =>
            new DesktopLocalEnvironmentAuthTokenStoreError({
              operation: "create-temporary-file-name",
              path: tokenPath,
              cause,
            }),
        ),
      )).replaceAll("-", "");
      const temporaryPath = `${tokenPath}.${process.pid}.${suffix}.tmp`;
      const encoded = yield* encodeTokenDocumentJson(document).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopLocalEnvironmentAuthTokenStoreError({
              operation: "encode-document",
              path: tokenPath,
              cause,
            }),
        ),
      );
      yield* fileSystem.makeDirectory(path.dirname(tokenPath), { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopLocalEnvironmentAuthTokenStoreError({
              operation: "create-directory",
              path: tokenPath,
              cause,
            }),
        ),
      );
      yield* Effect.gen(function* () {
        yield* fileSystem.writeFileString(temporaryPath, `${encoded}\n`).pipe(
          Effect.mapError(
            (cause) =>
              new DesktopLocalEnvironmentAuthTokenStoreError({
                operation: "write-temporary-file",
                path: temporaryPath,
                cause,
              }),
          ),
        );
        yield* fileSystem.rename(temporaryPath, tokenPath).pipe(
          Effect.mapError(
            (cause) =>
              new DesktopLocalEnvironmentAuthTokenStoreError({
                operation: "replace-file",
                path: tokenPath,
                cause,
              }),
          ),
        );
      }).pipe(
        Effect.ensuring(
          fileSystem.remove(temporaryPath, { force: true }).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Could not remove a temporary desktop authorization file.", {
                temporaryPath,
                error,
              }),
            ),
          ),
        ),
      );
    },
  );

  return DesktopLocalEnvironmentAuthTokenStore.of({
    get: Effect.gen(function* () {
      const document = yield* readDocument;
      if (Option.isNone(document) || !(yield* secureStorageAvailable)) {
        return Option.none<string>();
      }
      const encryptedToken = yield* Effect.fromResult(
        Encoding.decodeBase64(document.value.encryptedToken),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopLocalEnvironmentAuthTokenStoreError({
              operation: "decode-token",
              path: tokenPath,
              cause,
            }),
        ),
      );
      return Option.some(
        yield* safeStorage.decryptString(encryptedToken).pipe(
          Effect.mapError(
            (cause) =>
              new DesktopLocalEnvironmentAuthTokenStoreError({
                operation: "decrypt-token",
                path: tokenPath,
                cause,
              }),
          ),
        ),
      );
    }).pipe(Effect.withSpan("desktop.localEnvironmentAuthTokenStore.get")),
    set: Effect.fn("desktop.localEnvironmentAuthTokenStore.set")(function* (token) {
      if (!(yield* secureStorageAvailable)) {
        return false;
      }
      const encryptedToken = Encoding.encodeBase64(
        yield* safeStorage.encryptString(token).pipe(
          Effect.mapError(
            (cause) =>
              new DesktopLocalEnvironmentAuthTokenStoreError({
                operation: "encrypt-token",
                path: tokenPath,
                cause,
              }),
          ),
        ),
      );
      yield* writeDocument({ version: 1, encryptedToken });
      return true;
    }),
    clear: fileSystem.remove(tokenPath, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopLocalEnvironmentAuthTokenStoreError({
            operation: "clear",
            path: tokenPath,
            cause,
          }),
      ),
      Effect.withSpan("desktop.localEnvironmentAuthTokenStore.clear"),
    ),
  });
});

export const layer = Layer.effect(DesktopLocalEnvironmentAuthTokenStore, make);
