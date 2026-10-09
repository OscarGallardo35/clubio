import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { DisparosService } from '../push/disparos.service';
import { normalizarTelefonoE164 } from '../common/utils/phone.util';
import { requireEnv } from '../common/utils/env.util';
import type { LoginEmpleadoDto } from './dto/login-empleado.dto';
import type { LoginDuenoDto } from './dto/login-dueno.dto';
import type { Verificar2FaDto } from './dto/verificar-2fa.dto';
import type { RefreshTokenDto } from './dto/refresh-token.dto';
import type { RegistrarClienteDto } from './dto/registrar-cliente.dto';
import type { RecuperarClienteDto } from './dto/recuperar-cliente.dto';

// ---- Lockout por NEGOCIO (refinamiento 1) ----
const LOCKOUT_PREFIX = 'lockout:negocio:';
const MAX_FALLOS_NEGOCIO = 5;
const LOCKOUT_TTL_SEG = 600; // 10 min

/** Convierte '12h' | '7d' | '30m' | '45s' a milisegundos. */
function duracionMs(expr: string | undefined, fallbackMs: number): number {
  const m = /^(\d+)([smhd])$/.exec((expr ?? '').trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[m[2]] ?? 3_600_000);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly resolver: SucursalResolverService,
    private readonly disparos: DisparosService,
  ) {}

  // =========================================================================
  // HELPERS
  // =========================================================================

  private async resolverNegocio(slug: string) {
    const negocio = await this.prisma.negocio.findFirst({
      where: { slug, activo: true },
      select: { id: true, slug: true, nombre: true, modoClientes: true },
    });
    if (!negocio) throw new UnauthorizedException('Credenciales invalidas');
    return negocio;
  }

  /** Refinamiento 1: si el negocio esta bloqueado, no se intenta nada mas. */
  private async assertNegocioNoBloqueado(negocioId: string): Promise<void> {
    const key = `${LOCKOUT_PREFIX}${negocioId}`;
    if (await this.redis.exists(key)) {
      const ttl = await this.redis.ttl(key);
      throw new ForbiddenException(
        `Negocio temporalmente bloqueado por intentos fallidos. Reintenta en ${ttl}s.`,
      );
    }
  }

  private async registrarFalloNegocio(negocioId: string): Promise<void> {
    const fails = await this.redis.incr(`${LOCKOUT_PREFIX}${negocioId}:fails`, LOCKOUT_TTL_SEG);
    if (fails >= MAX_FALLOS_NEGOCIO) {
      await this.redis.set(`${LOCKOUT_PREFIX}${negocioId}`, 'bloqueado', LOCKOUT_TTL_SEG);
      this.logger.warn(`Negocio ${negocioId} bloqueado por ${fails} intentos fallidos`);
    }
  }

  private async limpiarFallosNegocio(negocioId: string): Promise<void> {
    await this.redis.del(`${LOCKOUT_PREFIX}${negocioId}:fails`);
    await this.redis.del(`${LOCKOUT_PREFIX}${negocioId}`);
  }

  /** Firma un token con el secreto y la expiracion correspondientes al tipo. */
  private firmar(payload: Record<string, unknown>, tipo: 'empleado' | 'cliente' | 'dueno' | '2fa') {
    const conf = {
      empleado: { secret: requireEnv('JWT_EMPLEADO_SECRET', 'dev-empleado-solo-desarrollo'), exp: process.env.JWT_EMPLEADO_EXPIRES_IN ?? '12h' },
      cliente: { secret: requireEnv('JWT_CLIENTE_SECRET', 'dev-cliente-solo-desarrollo'), exp: process.env.JWT_CLIENTE_EXPIRES_IN ?? '30d' },
      dueno: { secret: requireEnv('JWT_DUENO_SECRET', 'dev-dueno-solo-desarrollo'), exp: process.env.JWT_DUENO_EXPIRES_IN ?? '7d' },
      '2fa': { secret: requireEnv('JWT_SECRET', 'dev-general-solo-desarrollo'), exp: '5m' },
    }[tipo];
    return {
      // jti: sin esto, dos tokens del mismo sub/segundo son IDENTICOS y la
      // rotacion de refresh no invalidaria nada (bug detectado en el test e2e).
      token: this.jwt.sign({ ...payload, tipo, jti: randomUUID() }, { secret: conf.secret, expiresIn: conf.exp } as never),
      expiraEn: new Date(Date.now() + duracionMs(conf.exp, 12 * 3_600_000)),
    };
  }

  // =========================================================================
  // 1) LOGIN DE STAFF POR PIN
  // =========================================================================
  async loginEmpleado(dto: LoginEmpleadoDto, ip?: string, userAgent?: string) {
    const negocio = await this.resolverNegocio(dto.negocioSlug);
    await this.assertNegocioNoBloqueado(negocio.id);

    // El PIN esta hasheado con bcrypt (salt por hash), asi que no se puede
    // buscar por igualdad: hay que comparar contra cada empleado activo.
    const empleados = await this.prisma.empleado.findMany({
      where: {
        negocioId: negocio.id,
        activo: true,
        eliminadoEn: null,
        pinHash: { not: null },
        rol: { not: 'DUENO' },
      },
      select: { id: true, nombre: true, rol: true, pinHash: true, sucursalId: true },
      // Determinista: si dos empleados del negocio compartieran PIN (imposible por
      // `exigirPinLibre`, pero el indice de bcrypt no lo garantiza), el match no debe
      // depender del orden que devuelva Postgres.
      orderBy: { creadoEn: 'asc' },
    });

    let match: (typeof empleados)[number] | null = null;
    for (const e of empleados) {
      if (e.pinHash && (await bcrypt.compare(dto.pin, e.pinHash))) {
        match = e;
        break;
      }
    }

    if (!match) {
      await this.registrarFalloNegocio(negocio.id);
      throw new UnauthorizedException('PIN incorrecto');
    }

    await this.limpiarFallosNegocio(negocio.id);

    const { token, expiraEn } = this.firmar(
      { sub: match.id, negocioId: negocio.id, negocioSlug: negocio.slug, rol: match.rol, sucursalId: match.sucursalId },
      'empleado',
    );

    await this.prisma.sesionEmpleado.create({
      data: { empleadoId: match.id, token, expiraEn, ip: ip ?? null, userAgent: userAgent ?? null },
    });
    await this.prisma.empleado.update({ where: { id: match.id }, data: { ultimoAcceso: new Date() } });

    return {
      accessToken: token,
      expiresIn: Math.floor((expiraEn.getTime() - Date.now()) / 1000),
      empleado: { id: match.id, nombre: match.nombre, rol: match.rol, sucursalId: match.sucursalId },
      negocio: { id: negocio.id, slug: negocio.slug, nombre: negocio.nombre },
    };
  }

  // =========================================================================
  // 2) LOGIN DEL DUENO (email + password, con 2FA opcional)
  // =========================================================================
  async loginDueno(dto: LoginDuenoDto, ip?: string, userAgent?: string) {
    const negocio = await this.resolverNegocio(dto.negocioSlug);
    await this.assertNegocioNoBloqueado(negocio.id);

    const empleado = await this.prisma.empleado.findFirst({
      where: { negocioId: negocio.id, email: dto.email.toLowerCase(), activo: true, eliminadoEn: null },
      select: {
        id: true, nombre: true, rol: true, passwordHash: true,
        twoFactorEnabled: true, twoFactorSecret: true, sucursalId: true,
      },
    });

    const hash = empleado?.passwordHash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(dto.password, hash);

    if (!empleado || !ok || empleado.rol !== 'DUENO') {
      await this.registrarFalloNegocio(negocio.id);
      throw new UnauthorizedException('Credenciales invalidas');
    }

    await this.limpiarFallosNegocio(negocio.id);

    // Si tiene 2FA, se emite un challenge temporal (5 min) y NO tokens.
    if (empleado.twoFactorEnabled && empleado.twoFactorSecret) {
      const { token: challengeToken } = this.firmar(
        { sub: empleado.id, negocioId: negocio.id, negocioSlug: negocio.slug },
        '2fa',
      );
      return { requiere2FA: true, challengeToken };
    }

    return this.emitirSesionDueno(empleado, negocio, ip, userAgent);
  }

  /** Refinamiento 2: valida el claim tipo del challenge y el codigo TOTP. */
  async verificar2FA(dto: Verificar2FaDto, ip?: string, userAgent?: string) {
    let payload: { sub: string; negocioId: string; negocioSlug: string; tipo?: string };
    try {
      payload = this.jwt.verify(dto.challengeToken, { secret: requireEnv('JWT_SECRET', 'dev-general-solo-desarrollo') }) as never;
    } catch {
      throw new UnauthorizedException('Challenge invalido o expirado');
    }
    if (payload.tipo !== '2fa') throw new UnauthorizedException('Token no es un challenge de 2FA');

    const empleado = await this.prisma.empleado.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, nombre: true, rol: true, activo: true, sucursalId: true,
        twoFactorEnabled: true, twoFactorSecret: true,
      },
    });
    if (!empleado?.activo || !empleado.twoFactorSecret) {
      throw new UnauthorizedException('Usuario no valido');
    }

    const valido = speakeasy.totp.verify({
      secret: empleado.twoFactorSecret,
      encoding: 'base32',
      token: dto.codigo,
      window: 1,
    });
    if (!valido) throw new UnauthorizedException('Codigo 2FA incorrecto');

    const negocio = await this.prisma.negocio.findUnique({
      where: { id: payload.negocioId },
      select: { id: true, slug: true, nombre: true },
    });
    if (!negocio) throw new UnauthorizedException('Negocio no valido');

    return this.emitirSesionDueno(empleado, negocio, ip, userAgent);
  }

  private async emitirSesionDueno(
    empleado: { id: string; nombre: string; rol: string; sucursalId: string },
    negocio: { id: string; slug: string; nombre: string },
    ip?: string,
    userAgent?: string,
  ) {
    const { token, expiraEn } = this.firmar(
      { sub: empleado.id, negocioId: negocio.id, negocioSlug: negocio.slug, rol: empleado.rol, sucursalId: empleado.sucursalId },
      'dueno',
    );
    const refreshToken = this.jwt.sign(
      // jti unico: permite invalidar el token anterior al rotar (anti-replay)
      { sub: empleado.id, negocioId: negocio.id, tipo: 'refresh', jti: randomUUID() },
      { secret: requireEnv('JWT_REFRESH_SECRET', 'dev-refresh-solo-desarrollo'), expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d' } as never,
    );

    await this.prisma.sesionDueno.create({
      data: { empleadoId: empleado.id, token, refreshToken, expiraEn, ip: ip ?? null, userAgent: userAgent ?? null },
    });
    await this.prisma.empleado.update({ where: { id: empleado.id }, data: { ultimoAcceso: new Date() } });

    return {
      accessToken: token,
      refreshToken,
      expiresIn: Math.floor((expiraEn.getTime() - Date.now()) / 1000),
      empleado: { id: empleado.id, nombre: empleado.nombre, rol: empleado.rol },
      negocio: { id: negocio.id, slug: negocio.slug, nombre: negocio.nombre },
    };
  }

  // =========================================================================
  // 3) ROTACION DE REFRESH TOKEN (refinamiento 4)
  // =========================================================================
  async refreshDueno(dto: RefreshTokenDto, ip?: string, userAgent?: string) {
    let payload: { sub: string; negocioId: string; tipo?: string };
    try {
      payload = this.jwt.verify(dto.refreshToken, { secret: requireEnv('JWT_REFRESH_SECRET', 'dev-refresh-solo-desarrollo') }) as never;
    } catch {
      throw new UnauthorizedException('Refresh token invalido o expirado');
    }
    if (payload.tipo !== 'refresh') throw new UnauthorizedException('Token no es un refresh token');

    // El refresh debe existir en la sesion (si ya se roto, no existe -> replay detectado).
    const sesion = await this.prisma.sesionDueno.findFirst({
      where: { refreshToken: dto.refreshToken, empleadoId: payload.sub },
      select: { id: true, empleadoId: true },
    });
    if (!sesion) {
      // Reutilizacion de un refresh ya rotado: se invalidan TODAS las sesiones del usuario.
      await this.prisma.sesionDueno.deleteMany({ where: { empleadoId: payload.sub } });
      throw new UnauthorizedException('Refresh token reutilizado: sesiones invalidadas');
    }

    const empleado = await this.prisma.empleado.findUnique({
      where: { id: sesion.empleadoId },
      select: { id: true, nombre: true, rol: true, activo: true, sucursalId: true },
    });
    if (!empleado?.activo) throw new UnauthorizedException('Usuario inactivo');

    const negocio = await this.prisma.negocio.findUnique({
      where: { id: payload.negocioId },
      select: { id: true, slug: true, nombre: true },
    });
    if (!negocio) throw new UnauthorizedException('Negocio no valido');

    // Rotacion: se invalida la sesion anterior y se emite una nueva.
    await this.prisma.sesionDueno.delete({ where: { id: sesion.id } });

    return this.emitirSesionDueno(empleado, negocio, ip, userAgent);
  }

  // =========================================================================
  // 4) CLIENTE: alta y recuperacion (refinamiento 3: telefono E.164)
  // =========================================================================
  async registrarCliente(dto: RegistrarClienteDto) {
    const negocio = await this.resolverNegocio(dto.negocioSlug);
    const telefono = normalizarTelefonoE164(dto.telefono);

    const existente = await this.prisma.cliente.findUnique({
      where: { negocioId_telefono: { negocioId: negocio.id, telefono } },
      select: { id: true, nombre: true },
    });

    const cliente = existente
      ? await this.prisma.cliente.update({
          where: { id: existente.id },
          data: { nombre: dto.nombre, aceptaNotificaciones: dto.aceptaNotificaciones ?? undefined },
          select: { id: true, nombre: true, telefono: true, sellosActuales: true, totalVisitas: true },
        })
      : await this.prisma.cliente.create({
          data: {
            negocioId: negocio.id,
            nombre: dto.nombre,
            telefono,
            aceptaNotificaciones: dto.aceptaNotificaciones ?? false,
          },
          select: { id: true, nombre: true, telefono: true, sellosActuales: true, totalVisitas: true },
        });

    // #2.11: alta publica. Se resuelve la sucursal del QR y se le crea la tarjeta,
    // igual que hace el alta manual del staff (antes el cliente que se registraba
    // solo quedaba SIN TarjetaClienteSucursal con modoClientes = POR_SUCURSAL).
    const sucursal = await this.resolver.resolverSucursal(negocio.id, {
      sucursalId: dto.sucursalId,
      sucursalSlug: dto.sucursalSlug,
    });
    await this.prisma.tarjetaClienteSucursal.upsert({
      where: {
        clienteId_sucursalId: { clienteId: cliente.id, sucursalId: sucursal.id as string },
      },
      update: {},
      create: { clienteId: cliente.id, sucursalId: sucursal.id as string },
    });

    // DISPAROS BIENVENIDA: solo para el alta REAL (no cuando el cliente ya existia).
    if (!existente) {
      try {
        await this.disparos.onClienteNuevo({
          negocioId: negocio.id,
          clienteId: cliente.id,
          sucursalId: sucursal.id as string,
        });
      } catch (e) {
        this.logger.warn(`Disparos de bienvenida fallaron: ${(e as Error).message}`);
      }
    }

    return {
      // El claim `sucursalId` solo se agrega con modoClientes = POR_SUCURSAL:
      // con GLOBAL la sucursal se resuelve por request (y el claim seria ruido).
      ...this.emitirTokenCliente(
        cliente.id, negocio,
        negocio.modoClientes === 'POR_SUCURSAL' ? (sucursal.id as string) : null,
      ),
      cliente,
      sucursal: { id: sucursal.id, nombre: sucursal.nombre, slug: sucursal.slug },
      recienCreado: !existente,
    };
  }

  async recuperarCliente(dto: RecuperarClienteDto) {
    const negocio = await this.resolverNegocio(dto.negocioSlug);
    const telefono = normalizarTelefonoE164(dto.telefono);

    const cliente = await this.prisma.cliente.findUnique({
      where: { negocioId_telefono: { negocioId: negocio.id, telefono } },
      select: { id: true, nombre: true, telefono: true, sellosActuales: true, totalVisitas: true },
    });
    if (!cliente) throw new UnauthorizedException('No hay un cliente con ese telefono');

    // Se mantiene la sucursal del cliente si el negocio es POR_SUCURSAL.
    let sucursalId: string | null = null;
    if (negocio.modoClientes === 'POR_SUCURSAL') {
      const tarjeta = await this.prisma.tarjetaClienteSucursal.findFirst({
        where: { clienteId: cliente.id, sucursal: { negocioId: negocio.id, activa: true } },
        orderBy: [{ ultimaVisita: 'desc' }, { creadoEn: 'desc' }],
        select: { sucursalId: true },
      });
      sucursalId = tarjeta?.sucursalId ?? null;
    }
    return { ...this.emitirTokenCliente(cliente.id, negocio, sucursalId), cliente };
  }

  /**
   * #2.11: el JWT del cliente lleva `sucursalId` solo si el negocio usa
   * modoClientes = POR_SUCURSAL (asi el resolver lo toma como fuente 4). Con
   * GLOBAL el claim no se agrega: la sucursal se resuelve por request.
   */
  private emitirTokenCliente(clienteId: string, negocio: { id: string; slug: string }, sucursalId?: string | null) {
    const payload: Record<string, unknown> = { sub: clienteId, negocioId: negocio.id, negocioSlug: negocio.slug };
    if (sucursalId) payload.sucursalId = sucursalId;
    const { token, expiraEn } = this.firmar(payload, 'cliente');
    return {
      accessToken: token,
      expiresIn: Math.floor((expiraEn.getTime() - Date.now()) / 1000),
      negocio: { id: negocio.id, slug: negocio.slug },
    };
  }

  // =========================================================================
  // 5) ESTADO DEL CLIENTE (QR #2: punto de entrada de la PWA Cliente)
  // =========================================================================

  /**
   * GET /auth/cliente/me.
   *
   * La PWA resuelve con esto su estado inicial: si devuelve 401 muestra el
   * registro; si devuelve 200 sabe quien es, cuantos sellos lleva en cada
   * sucursal y si YA SUMO HOY (para no ofrecerle sumar dos veces).
   */
  async meCliente(clienteId: string) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, eliminadoEn: null },
      select: {
        id: true, negocioId: true, nombre: true, telefono: true, aceptaNotificaciones: true,
        sellosActuales: true, puntosActuales: true, totalVisitas: true, etiqueta: true,
        ultimaVisita: true, creadoEn: true,
      },
    });
    if (!cliente) throw new UnauthorizedException('Cliente no valido');

    const negocio = await this.prisma.negocio.findFirst({
      where: { id: cliente.negocioId, activo: true },
      select: {
        id: true, slug: true, nombre: true, modoClientes: true, plan: true,
        logoUrl: true, colorPrimario: true, colorSecundario: true, placeId: true,
      },
    });
    if (!negocio) throw new UnauthorizedException('Negocio no disponible');

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);

    const [config, sucursales, tarjetas, visitasHoy] = await Promise.all([
      this.prisma.configuracionClub.findUnique({
        where: { negocioId: negocio.id },
        select: {
          modoFidelizacion: true, sellosParaPremio: true, premioTexto: true,
          menuActivo: true, mostrarResenaPostVisita: true,
          tiposPedidoHabilitados: true, modosPagoHabilitados: true,
        },
      }),
      this.prisma.sucursal.findMany({
        where: { negocioId: negocio.id, activa: true },
        select: { id: true, nombre: true, slug: true, esPrincipal: true, direccion: true },
        orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }],
      }),
      this.prisma.tarjetaClienteSucursal.findMany({
        where: { clienteId },
        select: {
          sucursalId: true, sellosActuales: true, puntosActuales: true,
          totalVisitas: true, premiosCanjeados: true, ultimaVisita: true,
        },
      }),
      this.prisma.visita.count({
        where: { clienteId, negocioId: negocio.id, aprobadoEn: { gte: inicioHoy } },
      }),
    ]);

    const porSucursal = negocio.modoClientes === 'POR_SUCURSAL';

    return {
      cliente: {
        id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono,
        etiqueta: cliente.etiqueta, totalVisitas: cliente.totalVisitas,
        ultimaVisita: cliente.ultimaVisita, aceptaNotificaciones: cliente.aceptaNotificaciones,
      },
      negocio: {
        id: negocio.id, slug: negocio.slug, nombre: negocio.nombre, plan: negocio.plan,
        logoUrl: negocio.logoUrl, colorPrimario: negocio.colorPrimario,
        colorSecundario: negocio.colorSecundario, placeId: negocio.placeId,
      },
      modoClientes: negocio.modoClientes,
      configuracion: config,
      sucursales,
      tarjetas,
      // El saldo "global" solo tiene sentido con GLOBAL; con POR_SUCURSAL la
      // fuente de verdad es la tarjeta de cada sucursal.
      sellosActuales: porSucursal ? null : cliente.sellosActuales,
      puntosActuales: porSucursal ? null : cliente.puntosActuales,
      sumoHoy: visitasHoy > 0,
      visitasHoy,
    };
  }

  /** POST /auth/cliente/logout. El JWT de cliente es stateless: solo se limpia la cookie. */
  logoutCliente() {
    return { ok: true };
  }

  // =========================================================================
  // LOGOUT
  // =========================================================================
  async logoutEmpleado(empleadoId: string) {
    await this.prisma.sesionEmpleado.deleteMany({ where: { empleadoId } });
    return { ok: true };
  }

  async logoutDueno(empleadoId: string) {
    await this.prisma.sesionDueno.deleteMany({ where: { empleadoId } });
    return { ok: true };
  }

  /**
   * Sesion de STAFF (PWA Staff): quien soy, en que negocio y en que sucursal.
   *
   * Simetrico a `meCliente`. El guard ya revalido el token contra la DB y dejo
   * `req.user` con tipo/rol/sucursal, asi que aca solo se completa lo que el
   * token no trae (el nombre y el slug de la sucursal).
   *
   * `tipo` sale en MAYUSCULAS ('DUENO' | 'EMPLEADO') porque es el vocabulario de
   * las PWAs; adentro del backend el claim viaja en minusculas.
   */
  async meEmpleado(user: {
    id: string;
    nombre: string;
    rol: string;
    negocioId: string;
    negocioSlug: string;
    sucursalId: string | null;
    accesoMultiSucursal: boolean;
    tipo: string;
  }) {
    const sucursal = user.sucursalId
      ? await this.prisma.sucursal.findUnique({
          where: { id: user.sucursalId },
          select: { id: true, nombre: true, slug: true, esPrincipal: true, direccion: true, telefono: true },
        })
      : null;

    return {
      tipo: user.tipo === 'dueno' ? 'DUENO' : 'EMPLEADO',
      empleado: {
        id: user.id,
        nombre: user.nombre,
        rol: user.rol,
        accesoMultiSucursal: user.accesoMultiSucursal,
        sucursal,
      },
      sucursal,
    };
  }

  /**
   * Datos del dueno para la PWA Admin (`GET /auth/dueno/me`).
   *
   * Simetrico a `meEmpleado`: devuelve IDENTIDAD, no sesion. El email se lee de la DB porque el
   * token no lo lleva (para autorizar no hace falta, y un dato de mas en el token es un dato de
   * mas que viaja).
   */
  async meDueno(user: { id: string; nombre: string; negocioId: string; negocioSlug: string }) {
    const empleado = await this.prisma.empleado.findUnique({
      where: { id: user.id },
      select: { email: true, nombre: true },
    });

    return {
      dueno: {
        id: user.id,
        nombre: empleado?.nombre ?? user.nombre,
        email: empleado?.email ?? null,
      },
    };
  }
}
