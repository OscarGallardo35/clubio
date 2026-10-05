import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Inyecta el empleado autenticado (JWT de staff). */
export const CurrentEmpleado = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.user;
});
