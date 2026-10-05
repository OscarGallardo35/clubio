import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from './plan.service';
import { FEATURE_KEY } from './requiere-feature.decorator';

/**
 * Gating por plan.
 *
 * El guard es GLOBAL pero solo actua cuando el handler (o el controller) tiene
 * @RequiereFeature(...). Sin decorador devuelve true sin tocar la BD ni Redis.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly plan: PlanService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * El guard corre DESPUES de StaffGuard y TenantGuard (orden importa), asi que
   * normalmente alcanza con req.user. Pero hay endpoints PUBLICOS gateados
   * (POST /pedidos, POST /upsell/calcular): ahi no hay JWT y el negocio se
   * resuelve por el slug del tenant.
   */
  private async resolverNegocioId(req: Record<string, any>): Promise<string | null> {
    if (req.user?.negocioId) return req.user.negocioId;
    if (req.negocioId) return req.negocioId;
    const slug = req.tenant ?? req.headers?.['x-tenant-slug'];
    if (!slug) return null;
    const neg = await this.prisma.negocio.findFirst({
      where: { slug: String(slug).toLowerCase(), activo: true }, select: { id: true },
    });
    return neg?.id ?? null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    const req = context.switchToHttp().getRequest();
    const negocioId = await this.resolverNegocioId(req);
    if (!negocioId) {
      throw new ForbiddenException('No se pudo determinar el negocio para validar el plan');
    }

    if (await this.plan.estaSuspendido(negocioId)) {
      throw new ForbiddenException('El negocio esta suspendido. Contacta al soporte.');
    }

    const plan = await this.plan.planDeNegocio(negocioId);
    const habilitada = await this.plan.tieneFeature(plan, feature);
    if (!habilitada) {
      req.featureCheck = { plan, feature, habilitada: false };
      throw new ForbiddenException({
        message: `Tu plan ${plan} no incluye "${feature}". Mejora a un plan superior para usar esta funcion.`,
        feature,
        plan,
      });
    }

    req.featureCheck = { plan, feature, habilitada: true };
    return true;
  }
}