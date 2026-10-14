import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolEmpleado } from '@prisma/client';
import { PERMISO_KEY } from '../decorators/permiso.decorator';
import type { ClavePermiso } from '../decorators/permiso.decorator';

/**
 * Un permiso por empleado: que campo lo habilita y que roles ya podian el endpoint.
 *
 * El permiso es la EXCEPCION, no el reemplazo: `rolesBase` es exactamente lo que el endpoint
 * exigia antes (`@Roles(...)`), asi que un dueno o un encargado no notan ninguna diferencia.
 */
interface DefinicionPermiso {
  /** Campo del empleado que lo habilita. `StaffGuard` lo re-lee de la DB en CADA request. */
  campo: 'puedeEditarCarta';
  rolesBase: RolEmpleado[];
}

const PERMISOS: Record<ClavePermiso, DefinicionPermiso> = {
  /**
   * Carta completa (listar/crear/editar/disponibilidad/eliminar/reordenar). El baseline es el que
   * ya existia: DUENO y ENCARGADO.
   */
  editar_carta: {
    campo: 'puedeEditarCarta',
    rolesBase: [RolEmpleado.DUENO, RolEmpleado.ENCARGADO],
  },
  /**
   * Firma de subidas a Cloudinary (la foto de la carta). El baseline es DUENO UNICAMENTE, que es
   * como estaba `POST /media/firmar-subida`: un ENCARGADO sin el permiso sigue recibiendo 403.
   */
  subir_carta: {
    campo: 'puedeEditarCarta',
    rolesBase: [RolEmpleado.DUENO],
  },
};

/**
 * Autoriza por PERMISO (ademas del rol), nunca por rol solo.
 *
 * Contrato (simetrico a `RolesGuard`): sin el decorador `@PermiteSi(...)` este guard NO
 * restringe. Se aplica endpoint por endpoint, a proposito: la excepcion del permiso no puede
 * existir en el `RolesGuard` generico o quedaria abierta en todo el producto.
 *
 * La verdad del permiso es la DB: `StaffGuard` re-valida el empleado y arma `req.user` en cada
 * request, asi que prender/apagar el switch aplica sin re-login.
 */
@Injectable()
export class PermisoGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const clave = this.reflector.getAllAndOverride<ClavePermiso>(PERMISO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!clave) return true;

    const definicion = PERMISOS[clave];
    // Clave desconocida: falla CERRADO. Un typo en el decorador no puede abrir el endpoint.
    if (!definicion) throw new ForbiddenException(`Permiso desconocido: ${clave}`);

    const { user } = context.switchToHttp().getRequest();
    if (!user?.rol) throw new ForbiddenException('Sin rol asignado');

    // El permiso del empleado gana: es la razon de existir de este guard.
    if (user[definicion.campo] === true) return true;

    // Si no, se mantiene lo de antes.
    if (definicion.rolesBase.includes(user.rol as RolEmpleado)) return true;

    throw new ForbiddenException(
      `Requiere rol: ${definicion.rolesBase.join(', ')} o el permiso "${clave}" habilitado`,
    );
  }
}
