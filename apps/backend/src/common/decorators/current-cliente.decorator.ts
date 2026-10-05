import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Inyecta el cliente autenticado (JWT de la PWA Cliente). */
export const CurrentCliente = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});
