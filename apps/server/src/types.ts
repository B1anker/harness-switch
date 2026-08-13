import type { InstantiationService } from './di';

declare module 'hono' {
  interface ContextVariableMap {
    services: InstantiationService;
  }
}
