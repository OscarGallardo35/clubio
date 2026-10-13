import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { requireEnv } from '../common/utils/env.util';
import type { LoginSuperAdminDto } from './dto/login-superadmin.dto';
import type { Verificar2FaSuperAdminDto } from './dto/verificar-2fa-superadmin.dto';
import type { RefreshSuperAdminDto } from './dto/refresh-superadmin.dto';
import type { ListarLocalesSuperAdminDto } from './dto/listar-locales.dto';

// Secreto PROPIO del panel de plataforma. Se reusa la variable que YA existe en el
// repo (`JWT_SUPER_ADMIN_SECRET`, documentada en `.env.example` y en DEPLOY_SECRETS.md
// como "para el panel de super admin") en vez de inventar un nombre nuevo: un secreto
// mas es una variable mas que puede faltar en el deploy.
const SECRETO = () => requireEnv('JWT_SUPER_ADMIN_SECRET', 'dev-superadmin-solo-desarrollo');

// ---- Lockout de login (mismo mecanismo que el del dueno, pero por IDENTIDAD) ----
// El dueno se bloquea por negocio (varias cuentas comparten el local). Aca la unidad
// es el email: son pocas cuentas de plataforma y cada intento cuenta contra una sola.
const LOCKOUT_PREFIX = 'lockout:superadmin:';
const MAX_FALLOS = 5;
const LOCKOUT_TTL_SEG = 600; // 10 min

/** Convierte '2h' | '7d' | '30m' | '45s' a milisegundos. */
function duracionMs(expr: string | undefined, fallbackMs: number): number {
  const m = /^(\d+)([smhd])$/.exec((expr ?? '').trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[m[2]] ?? 3_600_000);
}

/** Hash "dummy" valido: se compara igual cuando el email no existe, para no filtrar
 *  por tiempo de respuesta si la cuenta existe o no. */
const HASH_FALSO = '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva';

interface SuperAdminBasico {
  id: string;
  email: string;
  nombre: string;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
}

@Injectable()
export class SuperAdminService {
  private readonly logger = new Logger('SuperAdminService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // =========================================================================
  // HELPERS
  // =========================================================================

  /** Firma un token del panel con el secreto de plataforma. */
  private firmar(payload: Record<string, unknown>, tipo: 'superadmin' | 'superadmin-refresh' | '2fa') {
    const conf = {
      superadmin: { exp: process.env.JWT_SUPER_ADMIN_EXPIRES_IN ?? '2h' },
      'superadmin-refresh': { exp: process.env.JWT_SUPER_ADMIN_REFRESH_EXPIRES_IN ?? '7d' },
      // Challenge de 2FA: 5 minutos, igual que el del dueno.
      '2fa': { exp: '5m' },
    }[tipo];
    const { token, expiraEn } = this.firmarCon(payload, tipo, conf.exp);
    return { token, expiraEn };
  }

  private firmarCon(payload: Record<string, unknown>, tipo: string, exp: string) {
    // jti: dos tokens del mismo sub/segundo serian IDENTICOS (mismo bug que se
    // detecto en el login del dueno: la rotacion de refresh no invalidaba nada).
    const token = this.jwt.sign({ ...payload, tipo, jti: randomUUID() }, { secret: SECRETO(), expiresIn: exp } as never);
    return { token, expiraEn: new Date(Date.now() + duracionMs(exp, 2 * 3_600_000)) };
  }

  private async assertNoBloqueado(email: string): Promise<void> {
    if (await this.redis.exists(`${LOCKOUT_PREFIX}${email}`)) {
      const ttl = await this.redis.ttl(`${LOCKOUT_PREFIX}${email}`);
      throw new ForbiddenException(
        `Cuenta temporalmente bloqueada por intentos fallidos. Reintenta en ${ttl}s.`,
      );
    }
  }

  private async registrarFallo(email: string): Promise<void> {
    const fails = await this.redis.incr(`${LOCKOUT_PREFIX}${email}:fails`, LOCKOUT_TTL_SEG);
    if (fails >= MAX_FALLOS) {
      await this.redis.set(`${LOCKOUT_PREFIX}${email}`, 'bloqueado', LOCKOUT_TTL_SEG);
      this.logger.warn(`Super-admin ${email} bloqueado por ${fails} intentos fallidos`);
    }
  }

  private async limpiarFallos(email: string): Promise<void> {
    await this.redis.del(`${LOCKOUT_PREFIX}${email}:fails`);
    await this.redis.del(`${LOCKOUT_PREFIX}${email}`);
  }

  /** Emite la sesion (access + refresh), la persiste y actualiza ultimoAcceso. */
  private async emitirSesion(sa: SuperAdminBasico, ip?: string, userAgent?: string) {
    const { token, expiraEn } = this.firmar({ sub: sa.id, email: sa.email }, 'superadmin');
    const { token: refreshToken } = this.firmar({ sub: sa.id }, 'superadmin-refresh');

    await this.prisma.sesionSuperAdmin.create({
      data: {
        superAdminId: sa.id,
        token,
        refreshToken,
        expiraEn,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
    await this.prisma.superAdmin.update({
      where: { id: sa.id },
      data: { ultimoAcceso: new Date() },
    });

    return {
      accessToken: token,
      refreshToken,
      expiresIn: Math.floor((expiraEn.getTime() - Date.now()) / 1000),
      superadmin: { id: sa.id, email: sa.email, nombre: sa.nombre },
    };
  }

  // =========================================================================
  // 1) LOGIN (email + password, con 2FA opcional)
  // =========================================================================
  async login(dto: LoginSuperAdminDto, ip?: string, userAgent?: string) {
    const email = dto.email.toLowerCase().trim();
    await this.assertNoBloqueado(email);

    const sa = await this.prisma.superAdmin.findUnique({
      where: { email },
      select: {
        id: true, email: true, nombre: true, passwordHash: true,
        twoFactorEnabled: true, twoFactorSecret: true, activo: true,
      },
    });

    const ok = await bcrypt.compare(dto.password, sa?.passwordHash ?? HASH_FALSO);

    if (!sa || !ok || !sa.activo) {
      await this.registrarFallo(email);
      // La auditoria exige una FK a SuperAdmin: si el email no existe no hay a quien
      // atribuir el intento (y `registrarSuperAdmin` nunca lanza, igual queda el log).
      if (sa) {
        await this.auditoria.registrarSuperAdmin({
          superAdminId: sa.id,
          accion: 'superadmin.login.fallido',
          detalle: { email, motivo: !ok ? 'password' : 'inactivo' },
          ip: ip ?? null,
          userAgent: userAgent ?? null,
        });
      } else {
        this.logger.warn(`Intento de login de super-admin con email inexistente: ${email}`);
      }
      throw new UnauthorizedException('Credenciales invalidas');
    }

    await this.limpiarFallos(email);

    // Con 2FA prendido el primer paso NO emite sesion: challenge temporal (5 min).
    if (sa.twoFactorEnabled && sa.twoFactorSecret) {
      const { token: challengeToken } = this.firmar({ sub: sa.id, email: sa.email }, '2fa');
      return { requiere2FA: true as const, challengeToken };
    }

    const sesion = await this.emitirSesion(sa, ip, userAgent);
    await this.auditoria.registrarSuperAdmin({
      superAdminId: sa.id,
      accion: 'superadmin.login',
      detalle: { metodo: 'password' },
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    });
    return sesion;
  }

  /** Segundo paso del login: valida el challenge (5 min) y el codigo TOTP. */
  async verificar2FA(dto: Verificar2FaSuperAdminDto, ip?: string, userAgent?: string) {
    let payload: { sub: string; tipo?: string };
    try {
      payload = this.jwt.verify(dto.challengeToken, { secret: SECRETO() }) as never;
    } catch {
      throw new UnauthorizedException('Challenge invalido o expirado');
    }
    // El mismo claim que el challenge del dueno, pero firmado con el secreto de
    // plataforma: el challenge del dueno NO verifica aca, ni al reves.
    if (payload.tipo !== '2fa') throw new UnauthorizedException('Token no es un challenge de 2FA');

    const sa = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, nombre: true, activo: true,
        twoFactorEnabled: true, twoFactorSecret: true,
      },
    });
    if (!sa?.activo || !sa.twoFactorSecret) {
      throw new UnauthorizedException('Usuario no valido');
    }

    const valido = speakeasy.totp.verify({
      secret: sa.twoFactorSecret,
      encoding: 'base32',
      token: dto.codigo,
      window: 1,
    });
    if (!valido) {
      await this.auditoria.registrarSuperAdmin({
        superAdminId: sa.id,
        accion: 'superadmin.login.2fa_fallido',
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      });
      throw new UnauthorizedException('Codigo 2FA incorrecto');
    }

    const sesion = await this.emitirSesion(sa, ip, userAgent);
    await this.auditoria.registrarSuperAdmin({
      superAdminId: sa.id,
      accion: 'superadmin.login',
      detalle: { metodo: 'password+2fa' },
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    });
    return sesion;
  }

  // =========================================================================
  // 2) REFRESH (rotacion, mismo patron que el del dueno)
  // =========================================================================
  async refresh(dto: RefreshSuperAdminDto, ip?: string, userAgent?: string) {
    let payload: { sub: string; tipo?: string };
    try {
      payload = this.jwt.verify(dto.refreshToken, { secret: SECRETO() }) as never;
    } catch {
      throw new UnauthorizedException('Refresh token invalido o expirado');
    }
    if (payload.tipo !== 'superadmin-refresh') {
      throw new UnauthorizedException('Token no es un refresh del panel');
    }

    // El refresh tiene que existir en la sesion: si ya se roto, no esta (replay).
    const sesion = await this.prisma.sesionSuperAdmin.findFirst({
      where: { refreshToken: dto.refreshToken, superAdminId: payload.sub },
      select: { id: true },
    });
    if (!sesion) {
      await this.prisma.sesionSuperAdmin.deleteMany({ where: { superAdminId: payload.sub } });
      throw new UnauthorizedException('Refresh token reutilizado: sesiones invalidadas');
    }

    const sa = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, nombre: true, activo: true, twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!sa?.activo) throw new UnauthorizedException('Super-admin inactivo');

    await this.prisma.sesionSuperAdmin.delete({ where: { id: sesion.id } });
    return this.emitirSesion(sa, ip, userAgent);
  }

  // =========================================================================
  // 3) SESION
  // =========================================================================
  /** Identidad del operador (`GET /superadmin/auth/me`). */
  async me(user: { id: string; email: string; nombre: string; twoFactorEnabled: boolean }) {
    const sa = await this.prisma.superAdmin.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, nombre: true, twoFactorEnabled: true, ultimoAcceso: true },
    });

    return {
      tipo: 'SUPERADMIN',
      superadmin: {
        id: sa?.id ?? user.id,
        email: sa?.email ?? user.email,
        nombre: sa?.nombre ?? user.nombre,
        twoFactorEnabled: sa?.twoFactorEnabled ?? user.twoFactorEnabled,
        ultimoAcceso: sa?.ultimoAcceso ?? null,
      },
    };
  }

  async logout(superAdminId: string, ip?: string, userAgent?: string) {
    await this.prisma.sesionSuperAdmin.deleteMany({ where: { superAdminId } });
    await this.auditoria.registrarSuperAdmin({
      superAdminId,
      accion: 'superadmin.logout',
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    });
    return { ok: true };
  }

  // =========================================================================
  // 4) PLATAFORMA — locales y resumen
  //
  // Scope de PLATAFORMA: NO hay filtro por tenant. El super-admin no tiene
  // `negocioId`, asi que cualquier endpoint que mire UN local puntual tiene que
  // recibir el `negocioId` como parametro EXPLICITO y validarlo (el dia que exista
  // "ver detalle de local"). Hoy estos dos son de solo lectura y globales.
  // =========================================================================

  /** Listado de TODOS los locales (`GET /superadmin/locales`). Read-only en la Fase 0. */
  async listarLocales(filtros: ListarLocalesSuperAdminDto = {}) {
    const search = filtros.search?.trim();
    const where = {
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' as const } },
              { slug: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(filtros.plan ? { plan: filtros.plan as Plan } : {}),
      ...(filtros.activo !== undefined ? { activo: filtros.activo === 'true' } : {}),
      // Los borrados logicamente NO son locales de la plataforma.
      eliminadoEn: null,
    };

    const data = await this.prisma.negocio.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        slug: true,
        plan: true,
        activo: true,
        theme: true,
        creadoEn: true,
        _count: { select: { sucursales: true, empleados: true, clientes: true } },
      },
      orderBy: { creadoEn: 'asc' },
    });

    return {
      total: data.length,
      data: data.map((n) => ({
        id: n.id,
        nombre: n.nombre,
        slug: n.slug,
        plan: n.plan,
        activo: n.activo,
        // El `theme` completo puede pesar; la lista solo necesita saber si existe
        // (es el flag "tarjeta personalizada" que se mira de un vistazo).
        tieneTheme: n.theme !== null,
        creadoEn: n.creadoEn,
        sucursales: n._count.sucursales,
        empleados: n._count.empleados,
        clientes: n._count.clientes,
      })),
    };
  }

  /** Metricas basicas para el dashboard del shell (`GET /superadmin/resumen`). */
  async resumen() {
    const [total, activos, conTheme, porPlan] = await Promise.all([
      this.prisma.negocio.count({ where: { eliminadoEn: null } }),
      this.prisma.negocio.count({ where: { eliminadoEn: null, activo: true } }),
      // `theme` es Json?: se cuenta con not: null (Prisma no admite isSet para Json).
      this.prisma.negocio.count({ where: { eliminadoEn: null, theme: { not: null } } }),
      this.prisma.negocio.groupBy({
        by: ['plan'],
        where: { eliminadoEn: null },
        _count: { _all: true },
      }),
    ]);

    return {
      locales: { total, activos, inactivos: total - activos, conTheme },
      porPlan: porPlan
        .map((p) => ({ plan: p.plan, total: p._count._all }))
        .sort((a, b) => b.total - a.total),
    };
  }
}
