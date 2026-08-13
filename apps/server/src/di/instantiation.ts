import { ServiceCollection } from './collection';
import { createDecorator, getServiceDependencies, type ServiceIdentifier } from './decorator';
import { SyncDescriptor } from './descriptors';

export interface ServicesAccessor {
  get<T>(id: ServiceIdentifier<T>): T;
}

export interface IInstantiationService {
  readonly _serviceBrand: undefined;
  createInstance<T>(descriptor: SyncDescriptor<T>): T;
  createInstance<Ctor extends new (...args: never[]) => unknown>(
    ctor: Ctor,
    ...args: unknown[]
  ): InstanceType<Ctor>;
  invokeFunction<R>(fn: (accessor: ServicesAccessor) => R): R;
  get<T>(id: ServiceIdentifier<T>): T;
}

export const IInstantiationService = createDecorator<IInstantiationService>('instantiationService');

export class InstantiationService implements IInstantiationService {
  declare readonly _serviceBrand: undefined;

  private readonly activeCreates = new Set<string>();

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
    if (!entry) {
      throw new Error(`Service '${id}' is not registered`);
    }
    if (entry instanceof SyncDescriptor) {
      const serviceId = String(id);
      if (this.activeCreates.has(serviceId)) {
        throw new Error(`Cyclic service dependency around '${serviceId}'`);
      }
      this.activeCreates.add(serviceId);
      try {
        const instance = this.createFromDescriptor(entry);
        this.services.set(id, instance);
        return instance;
      } finally {
        this.activeCreates.delete(serviceId);
      }
    }
    return entry;
  }

  private createFromDescriptor<T>(descriptor: SyncDescriptor<T>): T {
    return this.construct(
      descriptor.ctor as new (
        ...args: unknown[]
      ) => T,
      descriptor.staticArguments,
    );
  }

  private construct<T>(ctor: new (...args: unknown[]) => T, staticArgs: unknown[]): T {
    const dependencies = getServiceDependencies(ctor);
    if (dependencies.length === 0 && staticArgs.length === 0) {
      return new ctor();
    }

    const args: unknown[] = [];
    let staticIndex = 0;
    const lastIndex = Math.max(
      dependencies.at(-1)?.index ?? -1,
      staticArgs.length + dependencies.length - 1,
    );

    for (let index = 0; index <= lastIndex; index += 1) {
      const dependency = dependencies.find((item) => item.index === index);
      if (dependency) {
        args[index] = this.resolve(dependency.id);
      } else if (staticIndex < staticArgs.length) {
        args[index] = staticArgs[staticIndex];
        staticIndex += 1;
      }
    }

    return new ctor(...args);
  }
}
