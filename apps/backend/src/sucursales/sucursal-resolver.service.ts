import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

export interface ResolverSucursalOpts {
  /** 1) query param ?sucursalId= */
  sucursalId?: string | null;
  /** 2) header X-Sucursal-Slug */
  sucursalSlug?: string | null;
  /** 3) claim sucursalId del JWT (via empleado) */
  empleadoId?: string | null;
}

const TTL_RESOLVE = 300;   // 5 min
const TTL_EMPLEADO = 600;  // 10 min

const CAMPOS = {
  id: true, negocioId: true, nombre: true, slug: true, activa: true,
  esPrincipal: true, numeroAtendiente: true, direccion: true, telefono: true,
} as const;

/**
 * Resuelve la sucursal efectiva de una request multi-sucursal.
 * Prioridad: query param > header X-Sucursal-Slug > sucursal del empleado (JWT) > principal.
 */
@Injectable()
export class SucursalResolverService {
  private readonly logger = new Logger('SucursalResolver');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private hash(opts: ResolverSucursalOpts): string {
    const raw = JSON.stringify([opts.sucursalId ?? '', opts.sucursalSlug ?? '', opts.empleadoId ?? '']);
    return createHash('sha1').update(raw).digest('hex').slice(0, 12);
  }

  async resolverSucursal(negocioId: string, opts: ResolverSucursalOpts = {}) {
    const cacheKey = `sucursal:resolve:${negocioId}:${this.hash(opts)}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as Record<string, unknown>;

    let sucursal: Record<string, unknown> | null = null;

    // 1) query param
    if (opts.sucursalId) {
      sucursal = await this.prisma.sucursal.findFirst({
        where: { id: opts.sucursalId, negocioId },
        select: CAMPOS,
      });
    }

    // 2) header X-Sucursal-Slug
    if (!sucursal && opts.sucursalSlug) {
      sucursal = await this.prisma.sucursal.findFirst({
        where: { negocioId, slug: opts.sucursalSlug.toLowerCase() },
        select: CAMPOS,
      });
    }

    // 3) sucursal del empleado del JWT
    if (!sucursal && opts.empleadoId) {
      sucursal = (await this.resolverSucursalDeEmpleado(opts.empleadoId)) as Record<string, unknown> | null;
    }

    // 4) principal
    if (!sucursal) {
      sucursal = await this.prisma.sucursal.findFirst({
        where: { negocioId, esPrincipal: true },
        select: CAMPOS,
      });
      if (!sucursal) {
        this.logger.error(`Negocio ${negocioId} sin sucursal principal`);
        throw new InternalServerErrorException('El negocio no tiene sucursal principal configurada');
      }
    }

    await this.redis.set(cacheKey, JSON.stringify(sucursal), TTL_RESOLVE).catch(() => undefined);
    return sucursal;
  }

  async resolverSucursalDeEmpleado(empleadoId: string) {
    const cacheKey = `sucursal:empleado:${empleadoId}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as Record<string, unknown>;

    const empleado = await this.prisma.empleado.findUnique({
      where: { id: empleadoId },
      select: { sucursalId: true },
    });
    if (!empleado?.sucursalId) return null;

    const sucursal = await this.prisma.sucursal.findUnique({
      where: { id: empleado.sucursalId },
      select: CAMPOS,
    });
    if (sucursal) await this.redis.set(cacheKey, JSON.stringify(sucursal), TTL_EMPLEADO).catch(() => undefined);
    return sucursal;
  }

  /** Invalida el cache al cambiar sucursales (llamado por el CRUD de sucursales). */
  /**
   * Invalida el cache de resolucion de un negocio.
   *
   * OJO: antes esto era un NO-OP. Armaba `sucursal:resolve:{negocioId}:*` y despues
   * salteaba toda clave que contuviera '*', asi que el unico key que armaba nunca se
   * borraba y el resolver seguia devolviendo datos viejos hasta 5 min (nombre,
   * activa, esPrincipal tras un cambio). Ahora se borra por patron con SCAN.
   */
  async invalidar(negocioId: string, empleadoId?: string) {
    await this.redis.delByPattern(`sucursal:resolve:${negocioId}:*`).catch(() => 0);
    if (empleadoId) await this.redis.del(`sucursal:empleado:${empleadoId}`).catch(() => undefined);
  }
}
