export const DI_TARGET = '$di$target';
export const DI_DEPENDENCIES = '$di$dependencies';

export interface ServiceIdentifier<T> {
  (...args: unknown[]): void;
  readonly type: T;
  toString(): string;
}

export type ServiceDependency = {
  id: ServiceIdentifier<unknown>;
  index: number;
};

const serviceIds = new Map<string, ServiceIdentifier<unknown>>();

function storeServiceDependency(
  id: ServiceIdentifier<unknown>,
  target: Function,
  index: number,
): void {
  const ctor = target as Function & {
    [DI_TARGET]?: Function;
    [DI_DEPENDENCIES]?: ServiceDependency[];
  };
  if (ctor[DI_TARGET] === target) {
    ctor[DI_DEPENDENCIES]!.push({ id, index });
    return;
  }
  ctor[DI_DEPENDENCIES] = [{ id, index }];
  ctor[DI_TARGET] = target;
}

export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
  const existing = serviceIds.get(serviceId);
  if (existing) {
    return existing as ServiceIdentifier<T>;
  }

  const id = function (target: Function, _key: unknown, index: number): void {
    if (arguments.length !== 3) {
      throw new Error(`@${serviceId} can only decorate a constructor parameter`);
    }
    storeServiceDependency(id as ServiceIdentifier<unknown>, target, index);
  } as unknown as ServiceIdentifier<T>;

  id.toString = () => serviceId;
  serviceIds.set(serviceId, id as ServiceIdentifier<unknown>);
  return id;
}

export function getServiceDependencies(ctor: Function): ServiceDependency[] {
  const target = ctor as Function & {
    [DI_TARGET]?: Function;
    [DI_DEPENDENCIES]?: ServiceDependency[];
  };
  if (target[DI_TARGET] === ctor) {
    return [...(target[DI_DEPENDENCIES] ?? [])].toSorted((a, b) => a.index - b.index);
  }
  return [];
}

/**
 * Class-level dependency declaration used by InstantiationService.
 * Bun does not emit TypeScript parameter decorators, so services declare
 * constructor-injected identifiers here instead of `@IFoo` on parameters.
 */
export function inject(...ids: Array<ServiceIdentifier<unknown>>) {
  return (ctor: Function) => {
    const target = ctor as Function & {
      [DI_TARGET]?: Function;
      [DI_DEPENDENCIES]?: ServiceDependency[];
    };
    target[DI_DEPENDENCIES] = ids.map((id, index) => ({ id, index }));
    target[DI_TARGET] = ctor;
  };
}
