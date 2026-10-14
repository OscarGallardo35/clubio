import { SetMetadata } from '@nestjs/common';

export const PERMISO_KEY = 'permiso_carta';

/**
 * Claves de permiso por empleado.
 *
 * Se leen POR CLAVE (no por rol ni por un booleano suelto) para que el dia que haya mas de uno
 * se pueda migrar a una tabla de permisos sin tocar los controllers: el controller declara la
 * clave y sigue igual.
 */
export type ClavePermiso = 'editar_carta' | 'subir_carta';

/**
 * Habilita un endpoint si el empleado tiene el permiso `clave` prendido, ADEMAS de los roles que
 * ya lo tenian (los define `PERMISOS` en `PermisoGuard`).
 *
 * **Se aplica SOLO en los endpoints de carta y en la firma de media.** Deliberadamente NO vive
 * dentro de `RolesGuard`: ahi la excepcion valdria para TODOS los endpoints del producto
 * (pedidos, empleados, visitas, configuracion), que es justo lo que no queremos.
 */
export const PermiteSi = (clave: ClavePermiso) => SetMetadata(PERMISO_KEY, clave);
