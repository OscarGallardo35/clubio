import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../utils/env.util';

/**
 * Guard de endpoints de GESTION del negocio.
 *
 * Acepta DOS tipos de token:
 *   - `dueno`    -> PWA Admin (rol DUENO)
 *   - `empleado` -> PWA Staff (ENCARGADO/CAJERO/MESERO/...)
 *
 * Motivo: el dueno administra clientes/empleados desde la PWA Admin con su
 * token de dueno, y un ENCARGADO lo hace desde la PWA Staff con su token de
 * empleado. Un solo guard evita duplicar endpoints.
 * El claim `tipo` sigue validandose: un token de cliente nunca pasa.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Falta el token de autenticacion');
    }

    const candidatos: Array<[string, string]> = [
      [requireEnv('JWT_DUENO_SECRET', 'dev-dueno-solo-desarrollo'), 'dueno'],
      [requireEnv('JWT_EMPLEADO_SECRET', 'dev-empleado-solo-desarrollo'), 'empleado'],
    ];

    for (const [secret, tipoEsperado] of candidatos) {
      try {
        const payload = this.jwt.verify(token, { secret }) as {
          sub?: string; tipo?: string; negocioSlug?: string;
        };
        if (payload.tipo !== tipoEsperado || !payload.sub) continue;

        const emp = await this.prisma.empleado.findUnique({
          where: { id: payload.sub },
          select: {
            id: true, nombre: true, rol: true, negocioId: true,
            sucursalId: true, activo: true, eliminadoEn: true,
            accesoMultiSucursal: true,
          },
        });
        if (!emp || !emp.activo || emp.eliminadoEn) continue;

        req.user = {
          id: emp.id,
          nombre: emp.nombre,
          rol: emp.rol,
          negocioId: emp.negocioId,
          negocioSlug: payload.negocioSlug,
          sucursalId: emp.sucursalId,
          // Lo necesita /sucursales/mis-sucursales (#2.10): un ENCARGADO con
          // accesoMultiSucursal ve todas las sucursales, el resto solo la suya.
          accesoMultiSucursal: emp.accesoMultiSucursal,
          tipo: tipoEsperado,
        };
        return true;
      } catch {
        // prueba con el siguiente secreto
      }
    }

    throw new UnauthorizedException('Token invalido');
  }
}
