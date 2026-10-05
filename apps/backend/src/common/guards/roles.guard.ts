import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolEmpleado } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

/** Autoriza segun @Roles(...). Sin decorador, deja pasar. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RolEmpleado[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.rol) throw new ForbiddenException('Sin rol asignado');
    if (!required.includes(user.rol)) {
      throw new ForbiddenException(`Requiere rol: ${required.join(', ')}`);
    }
    return true;
  }
}
