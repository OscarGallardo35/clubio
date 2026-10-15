import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { VisitasGateway } from '../../visitas/visitas.gateway';
import type { SaldoCambiadoPayload, SaldoPar } from '@repo/types';

/** Nombre del evento WS. UNA sola constante: la usan el emisor y (por doc) el listener. */
export const EVENTO_SALDO_CAMBIADO = 'saldo:cambiado';

export interface CambioSaldo {
  /** Cuanto sumo (o resto, con signo) este cambio. Es el delta que el llamador YA conoce. */
  sellos: number;
  puntos: number;
  /**
   * Saldo EFECTIVO (sellos+puntos, segun GLOBAL/POR_SUCURSAL) DESPUES del cambio, sacado de la
   * MISMA fila que el llamador acaba de escribir. Se pasa explicito a proposito: el llamador
   * puede estar dentro de una transaccion y leerlo con la conexion global daria el valor VIEJO.
   */
  saldoDespues: SaldoPar;
  /** Que lo movio (ver los literales en `SaldoCambiadoPayload`). */
  motivo: string;
  /** Id de la visita/pedido/premio/disparo que lo origino. */
  ref?: string | null;
}

/**
 * EVENTO UNICO de saldo: avisa a la PWA Cliente que su tarjeta cambio y deja la auditoria.
 *
 * Cierra los tres huecos del diagnostico (los tres lugares que movian el saldo y NO avisaban a
 * la app): `FidelizacionService.acreditar`, `DisparosService.aplicarRegalo` y
 * `VisitasService.editarMonto` (el historico: la tarjeta abierta no se refrescaba cuando el
 * staff corregia el monto de la visita).
 *
 * POR QUE EL SERVICIO NO INYECTA EL GATEWAY: `VisitasGateway` vive en `VisitasModule`, que
 * importa `PushModule`; y este notificador lo usan `DisparosService`/`PremiosService`
 * (PushModule) y `FidelizacionService` (FidelizacionModule, @Global). Inyectarlo directo arma
 * un ciclo de modulos (Visitas -> Push -> Visitas) que Nest solo resuelve con `forwardRef` en
 * los dos lados. En vez de eso, el gateway se REGISTRA en `afterInit` (mismo patron que
 * `@WebSocketServer`): el notificador es @Global, no depende de nadie del grafo y la sala se
 * resuelve con el helper estatico `VisitasGateway.salaCliente` (una sola definicion del nombre).
 */
@Injectable()
export class SaldoNotificador {
  private readonly logger = new Logger('SaldoNotificador');
  private server: Server | null = null;

  constructor(
    private readonly auditoria: AuditoriaService,
    private readonly prisma: PrismaService,
  ) {}

  /** Lo llama `VisitasGateway.afterInit`. Sin server (tests unitarios) el aviso es no-op. */
  registrarServer(server: Server) {
    this.server = server;
  }

  /**
   * Saldo EFECTIVO (sellos+puntos) del cliente, con la MISMA regla que
   * `VisitasService.saldosEfectivos`: con `modoClientes = POR_SUCURSAL` manda la TARJETA de esa
   * sucursal; con GLOBAL, el contador del cliente.
   *
   * Es la version minima (solo el par) que necesitan la modal de un premio y el regalo de un
   * disparo. Si en algun momento hace falta tambien el progreso/meta, el lugar sigue siendo
   * `VisitasService.saldosEfectivos` (que devuelve el resto) — este metodo no lo reemplaza.
   */
  async parActual(negocioId: string, clienteId: string, sucursalId: string): Promise<SaldoPar> {
    const [negocio, cliente, tarjeta] = await Promise.all([
      this.prisma.negocio.findUnique({ where: { id: negocioId }, select: { modoClientes: true } }),
      this.prisma.cliente.findUnique({
        where: { id: clienteId },
        select: { sellosActuales: true, puntosActuales: true },
      }),
      this.prisma.tarjetaClienteSucursal.findUnique({
        where: { clienteId_sucursalId: { clienteId, sucursalId } },
        select: { sellosActuales: true, puntosActuales: true },
      }),
    ]);

    if (negocio?.modoClientes === 'POR_SUCURSAL') {
      return { sellos: tarjeta?.sellosActuales ?? 0, puntos: tarjeta?.puntosActuales ?? 0 };
    }
    return { sellos: cliente?.sellosActuales ?? 0, puntos: cliente?.puntosActuales ?? 0 };
  }

  /**
   * Emite `saldo:cambiado` a la sala `cliente:{id}`, registra la auditoria `saldo.cambiado` y
   * devuelve el par REAL antes/despues. NUNCA lanza: un fallo del aviso no puede revertir la
   * acreditacion que ya se hizo (misma regla que el resto del motor de push).
   */
  async avisar(
    negocioId: string,
    clienteId: string,
    cambio: CambioSaldo,
  ): Promise<{ antes: SaldoPar; despues: SaldoPar }> {
    const despues = cambio.saldoDespues;
    // `antes` sale del MISMO par que el llamador leyo, deshaciendo el delta que el ya conoce:
    // no se re-consulta la base (dentro de una transaccion devolveria el saldo viejo).
    const antes: SaldoPar = {
      sellos: despues.sellos - cambio.sellos,
      puntos: despues.puntos - cambio.puntos,
    };
    const ref = cambio.ref ?? null;

    const payload: SaldoCambiadoPayload = {
      negocioId,
      clienteId,
      sellos: cambio.sellos,
      puntos: cambio.puntos,
      saldo: { antes, despues },
      motivo: cambio.motivo,
      ref,
      emitidoEn: new Date().toISOString(),
    };

    try {
      this.server?.to(VisitasGateway.salaCliente(clienteId)).emit(EVENTO_SALDO_CAMBIADO, payload);
    } catch (e) {
      this.logger.warn(`No se pudo emitir ${EVENTO_SALDO_CAMBIADO}: ${(e as Error).message}`);
    }

    // `registrar` ya es a prueba de fallos (nunca lanza), pero se aislaba igual por si el
    // llamador corre dentro de una transaccion: la auditoria no puede romper el negocio.
    await this.auditoria
      .registrar({
        negocioId,
        clienteId,
        accion: 'saldo.cambiado',
        detalle: { sellos: cambio.sellos, puntos: cambio.puntos, motivo: cambio.motivo, ref, antes, despues },
      })
      .catch(() => undefined);

    return { antes, despues };
  }
}
