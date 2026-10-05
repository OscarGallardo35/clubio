import { SetMetadata } from '@nestjs/common';
import { RolEmpleado } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restringe un endpoint a los roles indicados (se evalua en RolesGuard). */
export const Roles = (...roles: RolEmpleado[]) => SetMetadata(ROLES_KEY, roles);
