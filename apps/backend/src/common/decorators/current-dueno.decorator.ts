import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Inyecta el dueno autenticado (JWT de la PWA Admin). */
export const CurrentDueno = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});
