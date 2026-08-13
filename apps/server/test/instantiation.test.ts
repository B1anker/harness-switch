import { describe, expect, test } from 'bun:test';
import {
  createDecorator,
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
});
