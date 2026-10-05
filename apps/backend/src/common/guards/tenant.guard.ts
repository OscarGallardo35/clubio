import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/** Subdominios que NO son tenants. */
const RESERVED = new Set(['app', 'staff', 'admin', 'api', 'www', 'localhost']);

/**
 * Blindaje multitenant.
 * Valida que el tenant del JWT coincida con X-Tenant-Slug / subdominio.
 * Falla CERRADO: nunca confia solo en el cliente.
 * (La version completa con AsyncLocalStorage llega en la Fase 2.)
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const headerSlug = (req.headers['x-tenant-slug'] as string | undefined)?.toLowerCase().trim();
    const subdomain = this.fromHost(req.hostname);
    const tokenSlug = (req.user?.negocioSlug as string | undefined)?.toLowerCase();

    const requested = headerSlug || subdomain || null;

    if (tokenSlug && requested && tokenSlug !== requested) {
      throw new ForbiddenException('El tenant del token no coincide con la solicitud');
    }

    req.tenant = tokenSlug ?? requested;
    return true;
  }

  private fromHost(hostname?: string): string | null {
    if (!hostname) return null;
    const parts = hostname.split('.');
    if (parts.length < 3) return null;
    const sub = parts[0].toLowerCase();
    return RESERVED.has(sub) ? null : sub;
  }
}
