import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../../common/utils/env.util';

export interface JwtClientePayload {
  sub: string;
  tipo: string;
  negocioId: string;
  negocioSlug: string;
}

/** Valida tokens de CLIENTE. Solo acepta tokens con claim tipo === 'cliente'. */
@Injectable()
export class JwtClienteStrategy extends PassportStrategy(Strategy, 'jwt-cliente') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Secreto PROPIO del contexto cliente (distinto de empleado/dueno).
      secretOrKey: requireEnv('JWT_CLIENTE_SECRET', 'dev-cliente-solo-desarrollo'),
    });
  }

  async validate(payload: JwtClientePayload) {
    if (payload?.tipo !== 'cliente') {
      throw new UnauthorizedException('Token no es de cliente');
    }

    const cliente = await this.prisma.cliente.findUnique({
      where: { id: payload.sub },
      select: { id: true, nombre: true, telefono: true, negocioId: true },
    });
    if (!cliente) throw new UnauthorizedException('Cliente no valido');

    return {
      id: cliente.id,
      nombre: cliente.nombre,
      telefono: cliente.telefono,
      negocioId: cliente.negocioId,
      negocioSlug: payload.negocioSlug,
      tipo: 'cliente',
    };
  }
}
