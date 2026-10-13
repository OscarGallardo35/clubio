import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../../common/utils/env.util';
import { COOKIE_SUPERADMIN, leerCookie } from '../../common/utils/cookie.util';

export interface JwtSuperAdminPayload {
  sub: string;
  tipo: string;
}

/**
 * Valida tokens del SUPER-ADMIN (panel de plataforma).
 *
 * Tres cosas que lo separan de las otras estrategias:
 *  1. Secreto PROPIO (`JWT_SUPER_ADMIN_SECRET`): un token de dueno/staff/cliente no
 *     verifica aca ni aunque se lo presenten.
 *  2. Solo acepta `tipo === 'superadmin'` (el claim es obligatorio, igual que en el
 *     resto del repo). El challenge de 2FA viaja con `tipo: '2fa'` y por eso NO sirve
 *     como sesion.
 *  3. Solo lee la cookie `superadmin_token` (host-only) o el Bearer. Nunca
 *     `dueno_token`/`empleado_token`/`cliente_token`.
 */
@Injectable()
export class JwtSuperAdminStrategy extends PassportStrategy(Strategy, 'jwt-superadmin') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: { headers?: { cookie?: string } }) =>
          leerCookie(req?.headers?.cookie, COOKIE_SUPERADMIN) || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: requireEnv('JWT_SUPER_ADMIN_SECRET', 'dev-superadmin-solo-desarrollo'),
    });
  }

  async validate(payload: JwtSuperAdminPayload) {
    if (payload?.tipo !== 'superadmin') {
      throw new UnauthorizedException('Token no es de super-admin');
    }

    const sa = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, nombre: true, activo: true, twoFactorEnabled: true },
    });
    if (!sa || !sa.activo) {
      throw new UnauthorizedException('Super-admin inactivo');
    }

    return {
      id: sa.id,
      email: sa.email,
      nombre: sa.nombre,
      twoFactorEnabled: sa.twoFactorEnabled,
      tipo: 'superadmin',
    };
  }
}
