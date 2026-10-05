import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

export interface ResolverSucursalOpts {
  /** 1) query param ?sucursalId= (debe ser del negocio y estar activa) */
  sucursalId?: string | null;
  /** 2) header X-Sucursal-Slug o ?sucursalSlug= */
  sucursalSlug?: string | null;
  /** 3) claim del JWT de STAFF (el empleado pertenece a una sucursal) */
  empleadoId?: string | null;
  /**
   * 4) cliente registrado con modoClientes = POR_SUCURSAL: se usa la sucursal de
   *    su TarjetaClienteSucursal mas reciente. Con modoClientes = GLOBAL se ignora.
   */
  clienteId?: string | null;
}

const TTL_RESOLVE = 300;   // 5 min
const TTL_EMPLEADO = 600;  // 10 min
const TTL_PEDIDO = 600;    // 10 min
export const CACHE_CONFIG_EFECTIVA = (negocioId: string, sucursalId: string) =>
  `config:efectiva:${negocioId}:${sucursalId}`;
export const TTL_CONFIG_EFECTIVA = 300; // 5 min

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
    const raw = JSON.stringify([
      opts.sucursalId ?? '', opts.sucursalSlug ?? '',
      opts.empleadoId ?? '', opts.clienteId ?? '',
    ]);
    return createHash('sha1').update(raw).digest('hex').slice(0, 12);
  }

  async resolverSucursal(negocioId: string, opts: ResolverSucursalOpts = {}) {
    const cacheKey = `sucursal:resolve:${negocioId}:${this.hash(opts)}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as Record<string, unknown>;

    let sucursal: Record<string, unknown> | null = null;

    // 1) query param (tiene que ser del negocio y estar ACTIVA)
    if (opts.sucursalId) {
      sucursal = await this.prisma.sucursal.findFirst({
        where: { id: opts.sucursalId, negocioId, activa: true },
        select: CAMPOS,
      });
    }

    // 2) header X-Sucursal-Slug
    if (!sucursal && opts.sucursalSlug) {
      sucursal = await this.prisma.sucursal.findFirst({
        where: { negocioId, slug: opts.sucursalSlug.toLowerCase(), activa: true },
        select: CAMPOS,
      });
    }

    // 3) sucursal del empleado del JWT
    if (!sucursal && opts.empleadoId) {
      sucursal = (await this.resolverSucursalDeEmpleado(opts.empleadoId)) as Record<string, unknown> | null;
    }

    // 4) cliente registrado con modoClientes = POR_SUCURSAL -> su tarjeta mas reciente
    if (!sucursal && opts.clienteId) {
      const negocio = await this.prisma.negocio.findUnique({
        where: { id: negocioId }, select: { modoClientes: true },
      });
      if (negocio?.modoClientes === 'POR_SUCURSAL') {
        const tarjeta = await this.prisma.tarjetaClienteSucursal.findFirst({
          where: { clienteId: opts.clienteId, sucursal: { negocioId, activa: true } },
          orderBy: [{ ultimaVisita: 'desc' }, { creadoEn: 'desc' }],
          select: { sucursal: { select: CAMPOS } },
        });
        sucursal = (tarjeta?.sucursal ?? null) as Record<string, unknown> | null;
      }
      // Con modoClientes = GLOBAL se ignora la tarjeta y se cae a la principal.
    }

    // 5) principal
    if (!sucursal) {
      sucursal = await this.prisma.sucursal.findFirst({
        where: { negocioId, esPrincipal: true, activa: true },
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

  /** Sucursal de un pedido (la del QR / la que eligio el cliente). */
  async resolverSucursalDePedido(pedidoId: string) {
    const cacheKey = `sucursal:pedido:${pedidoId}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as Record<string, unknown>;

    const pedido = await this.prisma.pedido.findUnique({
      where: { id: pedidoId },
      select: { sucursal: { select: CAMPOS } },
    });
    if (!pedido?.sucursal) return null;

    await this.redis.set(cacheKey, JSON.stringify(pedido.sucursal), TTL_PEDIDO).catch(() => undefined);
    return pedido.sucursal as unknown as Record<string, unknown>;
  }

  /**
   * Numero de atencion (WhatsApp) EFECTIVO:
   *   Sucursal.numeroAtendiente -> ConfiguracionClub.numeroAtendiente -> null
   *
   * OJO: si el negocio activa `usarNumeroAtendienteDistinto`, el de la sucursal
   * tiene prioridad. Si no, se respeta el del club. En ambos casos, si el de la
   * sucursal es null se cae al del club.
   */
  async resolverNumeroAtendiente(negocioId: string, sucursalId?: string | null): Promise<string | null> {
    const club = await this.prisma.configuracionClub.findUnique({
      where: { negocioId },
      select: { numeroAtendiente: true, usarNumeroAtendienteDistinto: true },
    });
    if (!sucursalId) return club?.numeroAtendiente ?? null;

    const sucursal = await this.prisma.sucursal.findFirst({
      where: { id: sucursalId, negocioId },
      select: { numeroAtendiente: true },
    });

    if (club?.usarNumeroAtendienteDistinto) {
      return sucursal?.numeroAtendiente ?? club?.numeroAtendiente ?? null;
    }
    return club?.numeroAtendiente ?? sucursal?.numeroAtendiente ?? null;
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
    await this.redis.delByPattern(CACHE_CONFIG_EFECTIVA(negocioId, '*')).catch(() => 0);
    if (empleadoId) await this.redis.del(`sucursal:empleado:${empleadoId}`).catch(() => undefined);
  }
}
