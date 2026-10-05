import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Inyecta el tenant resuelto en la request (seteado por TenantInterceptor/TenantGuard).
 */
export const Tenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.tenant ?? req.user?.negocioSlug ?? null;
});
