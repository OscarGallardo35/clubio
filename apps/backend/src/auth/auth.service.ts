import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
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
  ) {}

  // =========================================================================
  // HELPERS
  // =========================================================================

  private async resolverNegocio(slug: string) {
    const negocio = await this.prisma.negocio.findFirst({
      where: { slug, activo: true },
      select: { id: true, slug: true, nombre: true },
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

    return { ...this.emitirTokenCliente(cliente.id, negocio), cliente, recienCreado: !existente };
  }

  async recuperarCliente(dto: RecuperarClienteDto) {
    const negocio = await this.resolverNegocio(dto.negocioSlug);
    const telefono = normalizarTelefonoE164(dto.telefono);

    const cliente = await this.prisma.cliente.findUnique({
      where: { negocioId_telefono: { negocioId: negocio.id, telefono } },
      select: { id: true, nombre: true, telefono: true, sellosActuales: true, totalVisitas: true },
    });
    if (!cliente) throw new UnauthorizedException('No hay un cliente con ese telefono');

    return { ...this.emitirTokenCliente(cliente.id, negocio), cliente };
  }

  private emitirTokenCliente(clienteId: string, negocio: { id: string; slug: string }) {
    const { token, expiraEn } = this.firmar(
      { sub: clienteId, negocioId: negocio.id, negocioSlug: negocio.slug },
      'cliente',
    );
    return {
      accessToken: token,
      expiresIn: Math.floor((expiraEn.getTime() - Date.now()) / 1000),
      negocio: { id: negocio.id, slug: negocio.slug },
    };
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
}
