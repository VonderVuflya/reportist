import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { getSessionUser } from '../auth.ts';
import { sql } from '../db/client.ts';

const ClientSchema = z
  .object({
    id: z.string().uuid(),
    fullName: z.string(),
    gymId: z.string().uuid(),
    gymName: z.string(),
    city: z.string(),
  })
  .openapi('Client');

const listClientsRoute = createRoute({
  method: 'get',
  path: '/api/clients',
  operationId: 'listClients',
  tags: ['clients'],
  summary: 'List fitness clients available for reports',
  responses: {
    200: {
      description: 'Clients with their gym context',
      content: {
        'application/json': {
          schema: z.array(ClientSchema),
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: {
        'application/json': {
          schema: z.object({ error: z.string() }),
        },
      },
    },
  },
});

export function registerClientsRoutes(app: OpenAPIHono): void {
  app.openapi(listClientsRoute, async (c) => {
    const user = await getSessionUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const rows = await sql<
      {
        id: string;
        full_name: string;
        gym_id: string;
        gym_name: string;
        city: string;
      }[]
    >`
      SELECT c.id, c.full_name, c.gym_id, g.name AS gym_name, g.city
      FROM clients c
      JOIN gyms g ON g.id = c.gym_id
      ORDER BY g.name, c.full_name
    `;
    return c.json(
      rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        gymId: r.gym_id,
        gymName: r.gym_name,
        city: r.city,
      })),
      200,
    );
  });
}
