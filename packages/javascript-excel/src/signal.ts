/**
 * The abort signal type shared by every entry point.
 *
 * The package compiles without DOM types, so `AbortSignal` cannot be named in
 * a published signature. This structural type is the part the library uses;
 * a DOM or Node `AbortSignal` fits it.
 */

/** The members of `AbortSignal` the library uses. A DOM or Node `AbortSignal` fits. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
}
