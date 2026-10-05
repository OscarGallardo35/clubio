import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../../common/utils/env.util';

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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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
