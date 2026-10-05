import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** P2002 = violacion de unique constraint. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un webhook de forma IDEMPOTENTE.
   *
   * @returns `true`  si YA habia sido procesado (duplicado -> el caller debe cortar)
   *          `false` si es NUEVO (quedo registrado)
   *
   * La garantia la da `WebhookLog.@@unique([origen, externalId])`: si dos
   * entregas del mismo evento llegan a la vez, solo una inserta y la otra
   * recibe P2002. No hace falta un SELECT previo (que tendria una condicion
   * de carrera entre el check y el insert).
   */
  async procesar(origen: string, externalId: string, payload: unknown): Promise<boolean> {
    try {
      await this.prisma.webhookLog.create({
        data: {
          origen,
          externalId,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
        },
      });
      return false; // nuevo
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === UNIQUE_VIOLATION) {
        this.logger.log(`Webhook duplicado ignorado: ${origen}/${externalId}`);
        return true; // ya procesado
      }
      throw e;
    }
  }

  async listar(origen?: string, limit = 50) {
    const data = await this.prisma.webhookLog.findMany({
      where: origen ? { origen } : {},
      orderBy: { procesadoEn: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return { data, total: data.length };
  }
}