import { ServiceCollection } from './collection';
import { createDecorator, getServiceDependencies, type ServiceIdentifier } from './decorator';
import { SyncDescriptor } from './descriptors';

export interface ServicesAccessor {
  get<T>(id: ServiceIdentifier<T>): T;
}

export interface IInstantiationService {
  readonly _serviceBrand: undefined;
  /** Builds a class the container does not own, injecting its declared services. */
  createInstance<T>(descriptor: SyncDescriptor<T>): T;
  createInstance<Ctor extends new (...args: never[]) => unknown>(
    ctor: Ctor,
    ...args: unknown[]
  ): InstanceType<Ctor>;
  /**
   * Runs `fn` with an accessor, so a call site can pull the few services it needs
   * without threading the container itself through its signature.
   */
  invokeFunction<R>(fn: (accessor: ServicesAccessor) => R): R;
  get<T>(id: ServiceIdentifier<T>): T;
}

export const IInstantiationService = createDecorator<IInstantiationService>('instantiationService');

export class InstantiationService implements IInstantiationService {
  declare readonly _serviceBrand: undefined;

  /** Ordered so a cycle can be reported as the path that produced it. */
  private readonly activeCreates: string[] = [];

  constructor(private readonly services: ServiceCollection) {
    this.services.set(IInstantiationService, this);
  }

  get<T>(id: ServiceIdentifier<T>): T {
    return this.resolve(id);
  }

  invokeFunction<R>(fn: (accessor: ServicesAccessor) => R): R {
    return fn({ get: (id) => this.get(id) });
  }

  createInstance<T>(
    ctorOrDescriptor: SyncDescriptor<T> | (new (...args: never[]) => T),
    ...rest: unknown[]
  ): T {
    if (ctorOrDescriptor instanceof SyncDescriptor) {
      return this.createFromDescriptor(ctorOrDescriptor);
    }
    return this.construct(ctorOrDescriptor as new (...args: unknown[]) => T, rest);
  }

  private resolve<T>(id: ServiceIdentifier<T>): T {
    const entry = this.services.get(id);
    if (entry === undefined) {
      throw new Error(
        `Service '${id}' is not registered${this.pathSuffix()}. Add it to createServices().`,
      );
    }
    if (!(entry instanceof SyncDescriptor)) {
      return entry;
    }

    const serviceId = String(id);
    if (this.activeCreates.includes(serviceId)) {
      throw new Error(
        `Cyclic service dependency: ${[...this.activeCreates, serviceId].join(' -> ')}`,
      );
    }
    this.activeCreates.push(serviceId);
    try {
      const instance = entry.supportsDelayedInstantiation
        ? this.createLazy(entry)
        : this.createFromDescriptor(entry);
      // Cache before returning so the next resolve reuses this instance: every
      // registered service is a singleton for the lifetime of the container.
      this.services.set(id, instance);
      return instance;
    } finally {
      this.activeCreates.pop();
    }
  }

  private createFromDescriptor<T>(descriptor: SyncDescriptor<T>): T {
    return this.construct(
      descriptor.ctor as new (
        ...args: unknown[]
      ) => T,
      descriptor.staticArguments,
    );
  }

  /**
   * A stand-in that builds the real service on first use.
   *
   * Construction is deferred, not skipped, and the instance is built at most once. The
   * proxy is only a safe substitute for services reached through their interface —
   * `instanceof` against the concrete class does not see through it.
   */
  private createLazy<T>(descriptor: SyncDescriptor<T>): T {
    let instance: T | undefined;
    const target = () => {
      instance ??= this.createFromDescriptor(descriptor);
      return instance as T & object;
    };
    return new Proxy(Object.create(null) as T & object, {
      get: (_ignored, property) => {
        const value = Reflect.get(target(), property);
        // Methods must keep the real instance as their receiver; reading one off the
        // proxy would otherwise call it with the proxy as `this`.
        return typeof value === 'function' ? value.bind(target()) : value;
      },
      set: (_ignored, property, value) => Reflect.set(target(), property, value),
      has: (_ignored, property) => Reflect.has(target(), property),
      deleteProperty: (_ignored, property) => Reflect.deleteProperty(target(), property),
      ownKeys: () => Reflect.ownKeys(target()),
      getPrototypeOf: () => Reflect.getPrototypeOf(target()),
      getOwnPropertyDescriptor: (_ignored, property) =>
        Reflect.getOwnPropertyDescriptor(target(), property),
    }) as T;
  }

  /**
   * Fills every constructor parameter: the positions an `@inject` id claims are
   * resolved from the container, and the rest consume `staticArgs` in order.
   *
   * Surplus static arguments are passed through rather than refused — `ctor.length`
   * does not count default or rest parameters, so there is no reliable arity to
   * check against, and ignoring a trailing argument is what `new ctor(...)` does.
   */
  private construct<T>(ctor: new (...args: unknown[]) => T, staticArgs: unknown[]): T {
    const dependencies = getServiceDependencies(ctor);
    if (dependencies.length === 0) {
      return new ctor(...staticArgs);
    }

    const byIndex = new Map(dependencies.map((item) => [item.index, item.id]));
    // A service may be declared at any position, so the parameter list has to be as
    // long as both the highest injected index and the arguments that follow it.
    const length = Math.max(
      (dependencies.at(-1)?.index ?? -1) + 1,
      byIndex.size + staticArgs.length,
    );
    const args: unknown[] = [];
    let staticIndex = 0;

    for (let index = 0; index < length; index += 1) {
      const id = byIndex.get(index);
      if (id) {
        args[index] = this.resolve(id);
      } else if (staticIndex < staticArgs.length) {
        args[index] = staticArgs[staticIndex];
        staticIndex += 1;
      }
    }

    return new ctor(...args);
  }

  /** Names the chain being built, so a failure deep in a graph is traceable. */
  private pathSuffix(): string {
    return this.activeCreates.length > 0
      ? ` (while creating ${this.activeCreates.join(' -> ')})`
      : '';
  }
}
