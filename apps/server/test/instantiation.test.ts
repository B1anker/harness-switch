import { describe, expect, test } from 'bun:test';
import {
  createDecorator,
  IInstantiationService,
  InstantiationService,
  inject,
  ServiceCollection,
  SyncDescriptor,
} from '../src/di';

interface IAlpha {
  readonly _serviceBrand: undefined;
  name(): string;
}

interface IBeta {
  readonly _serviceBrand: undefined;
  value(): string;
}

const IAlpha = createDecorator<IAlpha>('alpha');
const IBeta = createDecorator<IBeta>('beta');

class Alpha implements IAlpha {
  declare readonly _serviceBrand: undefined;
  name(): string {
    return 'alpha';
  }
}

@inject(IAlpha)
class Beta implements IBeta {
  declare readonly _serviceBrand: undefined;
  constructor(private readonly alpha: IAlpha) {}
  value(): string {
    return `${this.alpha.name()}+beta`;
  }
}

/** Mixes injected services with values only the call site knows. */
@inject(IAlpha)
class Labelled {
  declare readonly _serviceBrand: undefined;
  constructor(
    readonly alpha: IAlpha,
    readonly label: string,
    readonly count: number,
  ) {}
}

describe('vscode-style instantiation', () => {
  test('injects constructor dependencies', () => {
    const collection = new ServiceCollection();
    collection.set(IAlpha, new SyncDescriptor(Alpha));
    collection.set(IBeta, new SyncDescriptor(Beta));
    const services = new InstantiationService(collection);

    expect(services.get(IBeta).value()).toBe('alpha+beta');
  });

  test('caches resolved singleton instances', () => {
    const collection = new ServiceCollection();
    collection.set(IAlpha, new SyncDescriptor(Alpha));
    const services = new InstantiationService(collection);
    expect(services.get(IAlpha)).toBe(services.get(IAlpha));
  });

  test('createInstance fills injected and static parameters in order', () => {
    const collection = new ServiceCollection();
    collection.set(IAlpha, new SyncDescriptor(Alpha));
    const services = new InstantiationService(collection);

    const made = services.createInstance(Labelled, 'store', 7);

    expect(made.alpha.name()).toBe('alpha');
    expect(made.label).toBe('store');
    expect(made.count).toBe(7);
  });

  test('a descriptor carries its own static arguments', () => {
    const collection = new ServiceCollection();
    collection.set(IAlpha, new SyncDescriptor(Alpha));
    const services = new InstantiationService(collection);

    const made = services.createInstance(new SyncDescriptor(Labelled, ['from-descriptor', 1]));

    expect(made.alpha.name()).toBe('alpha');
    expect(made.label).toBe('from-descriptor');
    expect(made.count).toBe(1);
  });

  test('a service with no dependencies still receives static arguments', () => {
    class Plain {
      constructor(readonly value: string) {}
    }
    const services = new InstantiationService(new ServiceCollection());

    expect(services.createInstance(Plain, 'direct').value).toBe('direct');
  });

  test('invokeFunction hands the accessor the same singletons', () => {
    const collection = new ServiceCollection();
    collection.set(IAlpha, new SyncDescriptor(Alpha));
    const services = new InstantiationService(collection);

    const resolved = services.invokeFunction((accessor) => accessor.get(IAlpha));

    expect(resolved).toBe(services.get(IAlpha));
  });

  test('a delayed service is not constructed until it is used', () => {
    let constructed = 0;
    class Counted implements IAlpha {
      declare readonly _serviceBrand: undefined;
      constructor() {
        constructed += 1;
      }
      name(): string {
        return 'counted';
      }
    }
    const collection = new ServiceCollection();
    collection.set(IAlpha, new SyncDescriptor(Counted, [], true));
    const services = new InstantiationService(collection);

    const lazy = services.get(IAlpha);
    expect(constructed).toBe(0);

    // Methods keep the real instance as their receiver, and the work happens once
    // however many times the proxy is touched.
    expect(lazy.name()).toBe('counted');
    expect(lazy.name()).toBe('counted');
    expect(constructed).toBe(1);
  });

  test('a delayed service can depend on other services', () => {
    const collection = new ServiceCollection();
    collection.set(IAlpha, new SyncDescriptor(Alpha));
    collection.set(IBeta, new SyncDescriptor(Beta, [], true));
    const services = new InstantiationService(collection);

    expect(services.get(IBeta).value()).toBe('alpha+beta');
  });

  test('an unregistered service names the chain that needed it', () => {
    const collection = new ServiceCollection();
    collection.set(IBeta, new SyncDescriptor(Beta));
    const services = new InstantiationService(collection);

    expect(() => services.get(IBeta)).toThrow(/Service 'alpha' is not registered.*creating beta/s);
  });

  test('a dependency cycle is reported as its path', () => {
    interface ILoopA {
      readonly _serviceBrand: undefined;
    }
    interface ILoopB {
      readonly _serviceBrand: undefined;
    }
    const ILoopA = createDecorator<ILoopA>('loopA');
    const ILoopB = createDecorator<ILoopB>('loopB');

    @inject(ILoopB)
    class LoopA {
      declare readonly _serviceBrand: undefined;
      constructor(readonly other: ILoopB) {}
    }
    @inject(ILoopA)
    class LoopB {
      declare readonly _serviceBrand: undefined;
      constructor(readonly other: ILoopA) {}
    }

    const collection = new ServiceCollection();
    collection.set(ILoopA, new SyncDescriptor(LoopA));
    collection.set(ILoopB, new SyncDescriptor(LoopB));
    const services = new InstantiationService(collection);

    expect(() => services.get(ILoopA)).toThrow(
      'Cyclic service dependency: loopA -> loopB -> loopA',
    );
  });

  test('the container resolves itself, so a service can build collaborators', () => {
    const collection = new ServiceCollection();
    collection.set(IAlpha, new SyncDescriptor(Alpha));
    const services = new InstantiationService(collection);

    expect(services.get(IInstantiationService)).toBe(services);
  });
});
