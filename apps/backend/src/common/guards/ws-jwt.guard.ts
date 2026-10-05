import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../utils/env.util';

/** Identidad resuelta desde el JWT del handshake del socket. */
export type WsIdentity =
  | { tipo: 'cliente'; clienteId: string; negocioId: string; negocioSlug?: string }
  | {
      tipo: 'empleado' | 'dueno';
      empleadoId: string; negocioId: string; negocioSlug?: string;
      rol: string; sucursalId: string | null; accesoMultiSucursal: boolean;
    };

/**
 * Autenticacion de WebSockets.
 *
 * - `validarToken()` se usa en handleConnection para autenticar el handshake.
 * - `canActivate()` protege los @SubscribeMessage (revisa socket.data.identidad).
 *
 * Igual que StaffGuard: prueba los 3 secretos y exige el claim `tipo` correcto,
 * asi un token de cliente jamas pasa por un canal de empleado.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async validarToken(token: string): Promise<WsIdentity | null> {
    if (!token) return null;

    const candidatos: Array<[string, string]> = [
      [requireEnv('JWT_CLIENTE_SECRET', 'dev-cliente-solo-desarrollo'), 'cliente'],
      [requireEnv('JWT_EMPLEADO_SECRET', 'dev-empleado-solo-desarrollo'), 'empleado'],
      [requireEnv('JWT_DUENO_SECRET', 'dev-dueno-solo-desarrollo'), 'dueno'],
    ];

    for (const [secret, tipoEsperado] of candidatos) {
      try {
        const p = this.jwt.verify(token, { secret }) as {
          sub?: string; tipo?: string; negocioId?: string; negocioSlug?: string;
        };
        if (p.tipo !== tipoEsperado || !p.sub || !p.negocioId) continue;

        if (tipoEsperado === 'cliente') {
          const cli = await this.prisma.cliente.findFirst({
            where: { id: p.sub, negocioId: p.negocioId, eliminadoEn: null },
            select: { id: true },
          });
          if (!cli) continue;
          return { tipo: 'cliente', clienteId: p.sub, negocioId: p.negocioId, negocioSlug: p.negocioSlug };
        }

        const emp = await this.prisma.empleado.findFirst({
          where: { id: p.sub, negocioId: p.negocioId, activo: true, eliminadoEn: null },
          select: { id: true, rol: true, sucursalId: true, accesoMultiSucursal: true },
        });
        if (!emp) continue;

        return {
          tipo: tipoEsperado === 'dueno' ? 'dueno' : 'empleado',
          empleadoId: emp.id,
          negocioId: p.negocioId,
          negocioSlug: p.negocioSlug,
          rol: emp.rol,
          sucursalId: emp.sucursalId,
          accesoMultiSucursal: emp.accesoMultiSucursal,
        };
      } catch {
        // siguiente secreto
      }
    }
    return null;
  }

  canActivate(context: ExecutionContext): boolean {
    const socket = context.switchToWs().getClient<{ data?: { identidad?: WsIdentity } }>();
    if (!socket?.data?.identidad) {
      throw new WsException('No autenticado');
    }
    return true;
  }
}
