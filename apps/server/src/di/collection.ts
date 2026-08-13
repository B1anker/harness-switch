import type { ServiceIdentifier } from './decorator';
import type { SyncDescriptor } from './descriptors';

export class ServiceCollection {
  private readonly entries = new Map<ServiceIdentifier<unknown>, unknown>();

  constructor(...entries: Array<[ServiceIdentifier<unknown>, unknown]>) {
    for (const [id, service] of entries) {
      this.set(id, service);
    }
  }

  set<T>(
    id: ServiceIdentifier<T>,
    instanceOrDescriptor: T | SyncDescriptor<T>,
  ): T | SyncDescriptor<T> | undefined {
    const previous = this.entries.get(id as ServiceIdentifier<unknown>) as
      | T
      | SyncDescriptor<T>
      | undefined;
    this.entries.set(id as ServiceIdentifier<unknown>, instanceOrDescriptor);
    return previous;
  }

  has(id: ServiceIdentifier<unknown>): boolean {
    return this.entries.has(id);
  }

  get<T>(id: ServiceIdentifier<T>): T | SyncDescriptor<T> | undefined {
    return this.entries.get(id as ServiceIdentifier<unknown>) as T | SyncDescriptor<T> | undefined;
  }

  forEach(callback: (id: ServiceIdentifier<unknown>, value: unknown) => void): void {
    for (const [id, value] of this.entries) {
      callback(id, value);
    }
  }
}
