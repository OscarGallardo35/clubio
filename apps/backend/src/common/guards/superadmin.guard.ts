import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard del panel de PLATAFORMA (PWA Superadmin).
 *
 * Envuelve la estrategia `jwt-superadmin`, que es la que valida el claim
 * `tipo === 'superadmin'` y que el SuperAdmin siga activo en la DB. La estrategia
 * lee UNICAMENTE la cookie `superadmin_token` (host-only) o el Bearer: nunca las
 * cookies de cliente/empleado/dueno, asi que una sesion de local no puede abrir
 * este panel aunque el token sea valido para las otras PWAs.
 *
 * NO reemplaza ni envuelve a los guards existentes (JwtDuenoGuard, StaffGuard,
 * TenantGuard): los endpoints de plataforma no pasan por TenantGuard porque el
 * super-admin no tiene `negocioId`.
 */
@Injectable()
export class SuperAdminGuard extends AuthGuard('jwt-superadmin') {}
