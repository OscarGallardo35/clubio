import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { requireEnv } from '../utils/env.util';
import { COOKIE_DUENO, COOKIE_EMPLEADO, leerCookie } from '../utils/cookie.util';

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

    // Dos vias, y el orden importa poco porque cada una se prueba contra los dos
    // secretos:
    //   - la cookie HttpOnly `empleado_token` (via principal de la PWA Staff)
    //   - `Authorization: Bearer` (fallback: harness de integracion y llamadas
    //     server-to-server; el WS tampoco puede leer cookies desde JS)
    // El dueno no tiene cookie: sigue entrando por Bearer.
    const tokens: string[] = [];
    const tokenCookie = leerCookie(req.headers?.cookie, COOKIE_EMPLEADO);
    if (tokenCookie) tokens.push(tokenCookie);
    // La PWA Admin manda su PROPIA cookie (`dueno_token`). El guard ya aceptaba el TOKEN de dueno
    // por Bearer, pero no la cookie: los endpoints de gestion que la PWA Admin consume (carta,
    // empleados, sucursales, configuracion...) le respondian 401 aunque tuviera sesion.
    const tokenDueno = leerCookie(req.headers?.cookie, COOKIE_DUENO);
    if (tokenDueno) tokens.push(tokenDueno);
    const [scheme, tokenHeader] = String(req.headers.authorization ?? '').split(' ');
    if (scheme === 'Bearer' && tokenHeader) tokens.push(tokenHeader);
    if (tokens.length === 0) {
      throw new UnauthorizedException('Falta el token de autenticacion');
    }

    const candidatos: Array<[string, string]> = [
      [requireEnv('JWT_DUENO_SECRET', 'dev-dueno-solo-desarrollo'), 'dueno'],
      [requireEnv('JWT_EMPLEADO_SECRET', 'dev-empleado-solo-desarrollo'), 'empleado'],
    ];

    for (const token of tokens) {
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
        // prueba con el siguiente secreto (y despues con el siguiente token)
      }
      }
    }

    throw new UnauthorizedException('Token invalido');
  }
}
