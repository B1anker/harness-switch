import type { HarnessId } from '@seaveyon/harness-switch-shared';
import { Hono } from 'hono';
import type { InstantiationService } from '../../di';
import { IDoctorService } from '../../services/doctor';

export function createDoctorRoutes(services: InstantiationService): Hono {
  const app = new Hono();
  const doctor = services.get(IDoctorService);

  app.get('/', async (c) => {
    const probe = c.req.query('probe') === '1';
    const harnessParam = c.req.query('harness');
    const harness =
      harnessParam && harnessParam.length > 0 ? (harnessParam as HarnessId) : undefined;
    return c.json(await doctor.run({ probe, harness }));
  });

  return app;
}
