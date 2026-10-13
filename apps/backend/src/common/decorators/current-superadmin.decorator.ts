import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Inyecta el super-admin autenticado (JWT del panel de plataforma). */
export const CurrentSuperAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});
