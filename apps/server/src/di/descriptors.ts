export class SyncDescriptor<T> {
  constructor(
    readonly ctor: new (...args: never[]) => T,
    readonly staticArguments: unknown[] = [],
    readonly supportsDelayedInstantiation = false,
  ) {}
}
