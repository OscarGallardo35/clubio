import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../../common/utils/env.util';

export interface JwtDuenoPayload {
  sub: string;
  tipo: string;
  negocioId: string;
  negocioSlug: string;
  rol: string;
}

/** Valida tokens del DUENO. Solo acepta tokens con claim tipo === 'dueno'. */
@Injectable()
export class JwtDuenoStrategy extends PassportStrategy(Strategy, 'jwt-dueno') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Secreto PROPIO del contexto dueno (distinto de empleado/cliente).
      secretOrKey: requireEnv('JWT_DUENO_SECRET', 'dev-dueno-solo-desarrollo'),
    });
  }

  async validate(payload: JwtDuenoPayload) {
    if (payload?.tipo !== 'dueno') {
      throw new UnauthorizedException('Token no es de dueno');
    }

    const empleado = await this.prisma.empleado.findUnique({
      where: { id: payload.sub },
      select: { id: true, nombre: true, rol: true, negocioId: true, sucursalId: true, activo: true, eliminadoEn: true },
    });
    if (!empleado || !empleado.activo || empleado.eliminadoEn) {
      throw new UnauthorizedException('Usuario inactivo');
    }
    if (empleado.rol !== 'DUENO') {
      throw new UnauthorizedException('El token no pertenece a un dueno');
    }

    return {
      id: empleado.id,
      nombre: empleado.nombre,
      rol: empleado.rol,
      negocioId: empleado.negocioId,
      negocioSlug: payload.negocioSlug,
      sucursalId: empleado.sucursalId,
      tipo: 'dueno',
    };
  }
}
