import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

const RESERVED = new Set(['app', 'staff', 'admin', 'api', 'www', 'localhost']);

/**
 * Resuelve el tenant de la request (header X-Tenant-Slug con prioridad, si no el subdominio)
 * y lo deja en req.tenant para el resto del pipeline.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const header = (req.headers['x-tenant-slug'] as string | undefined)?.toLowerCase().trim();
    req.tenant = header && header.length > 0 ? header : this.fromHost(req.hostname);
    return next.handle();
  }

  private fromHost(hostname?: string): string | null {
    if (!hostname) return null;
    const parts = hostname.split('.');
    if (parts.length < 3) return null;
    const sub = parts[0].toLowerCase();
    return RESERVED.has(sub) ? null : sub;
  }
}
