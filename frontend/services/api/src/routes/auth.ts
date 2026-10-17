import { authResponseSchema } from '@citeladder/contracts/auth';
import { defineGetRoute } from './define.ts';

/** The local user the install acts as; there is no sign-in (`auth/local.ts`). */
export const authRoutes = [
  defineGetRoute({
    family: 'auth',
    authorize: 'session',
    path: '/api/v1/auth/me',
    params: { path: {}, query: {} },
    response: authResponseSchema,
    async handle({ c, db }) {
      const user = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', c.get('user').id)
        .executeTakeFirstOrThrow();
      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          is_active: user.is_active,
          created_at: user.created_at.toISOString(),
          updated_at: user.updated_at.toISOString(),
        },
      };
    },
  }),
];
