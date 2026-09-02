/**
 * A constructor plus the arguments the container cannot resolve on its own.
 *
 * `staticArguments` fill the constructor parameters that no `@inject` id claims, in
 * order. With the class-level `inject(...)` helper the services occupy the leading
 * positions, so static arguments land after them:
 *
 * ```ts
 * @inject(IFileService)
 * class Store {
 *   constructor(files: IFileService, private readonly path: string) {}
 * }
 * new SyncDescriptor(Store, ['/tmp/store.json']);
 * ```
 *
 * `supportsDelayedInstantiation` defers construction until the first property access,
 * for services that are registered on every request but only used by a few of them.
 */
export class SyncDescriptor<T> {
  constructor(
    readonly ctor: new (...args: never[]) => T,
    readonly staticArguments: unknown[] = [],
    readonly supportsDelayedInstantiation = false,
  ) {}
}
