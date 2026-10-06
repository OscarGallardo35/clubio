import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../../common/utils/env.util';
import { COOKIE_EMPLEADO, leerCookie } from '../../common/utils/cookie.util';

export interface JwtEmpleadoPayload {
  sub: string;
  tipo: string;
  negocioId: string;
  negocioSlug: string;
  rol: string;
  sucursalId: string;
}

/** Valida tokens de STAFF. Solo acepta tokens con claim tipo === 'empleado'. */
@Injectable()
export class JwtEmpleadoStrategy extends PassportStrategy(Strategy, 'jwt-empleado') {
  constructor(private readonly prisma: PrismaService) {
    super({
      // La cookie HttpOnly es la via principal de la PWA Staff; el header Bearer
      // queda como fallback para el harness de integracion y para llamadas
      // server-to-server (el WebSocket no puede leer cookies desde JS, asi que
      // tambien las usa).
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: { headers?: { cookie?: string } }) =>
          leerCookie(req?.headers?.cookie, COOKIE_EMPLEADO) || null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      // Secreto PROPIO del contexto empleado (distinto de dueno/cliente).
      secretOrKey: requireEnv('JWT_EMPLEADO_SECRET', 'dev-empleado-solo-desarrollo'),
    });
  }

  async validate(payload: JwtEmpleadoPayload) {
    // Refinamiento 2: un token de cliente o dueno NO sirve aca.
    if (payload?.tipo !== 'empleado') {
      throw new UnauthorizedException('Token no es de empleado');
    }

    const empleado = await this.prisma.empleado.findUnique({
      where: { id: payload.sub },
      select: { id: true, nombre: true, rol: true, negocioId: true, sucursalId: true, activo: true, eliminadoEn: true },
    });
    if (!empleado || !empleado.activo || empleado.eliminadoEn) {
      throw new UnauthorizedException('Empleado inactivo');
    }

    return {
      id: empleado.id,
      nombre: empleado.nombre,
      rol: empleado.rol,
      negocioId: empleado.negocioId,
      negocioSlug: payload.negocioSlug,
      sucursalId: empleado.sucursalId,
      tipo: 'empleado',
    };
  }
}
