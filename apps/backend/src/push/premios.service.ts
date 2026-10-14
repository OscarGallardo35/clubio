import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PremioOtorgado } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { PushService } from './push.service';
import { DisparosService } from './disparos.service';
import { vencimientoLegible } from './premio.types';

/**
 * Ciclo de vida de un premio que el cliente ACEPTA desde la notificacion.
 *
 *   otorgar (disparo/campaña) -> PENDIENTE
 *   el cliente ACEPTA la modal -> claim atomico PENDIENTE -> ACEPTADO + acreditacion
 *   el staff lo CANJEA desde el link -> ACEPTADO -> CANJEADO
 *   o PENDIENTE -> VENCIDO (si paso el vencimiento)
 *
 * REGLAS:
 *  - El saldo (SELLOS/PUNTOS) se acredita SOLO al aceptar, con la MISMA logica del club
 *    (`DisparosService.aplicarRegalo`, que respeta GLOBAL/POR_SUCURSAL/SOLO_PUNTOS/
 *    SOLO_VISITAS). El premio LIBRE no mueve saldo.
 *  - El claim es ATOMICO (`updateMany {token, estado:PENDIENTE} -> ACEPTADO`, exigiendo
 *    `count === 1`): un doble tap no acredita dos veces.
 *  - El canje usa el MISMO mecanismo del flujo de verificacion que ya existe: un link
 *    generado por el SERVIDOR con el slug (`STAFF_APP_URL/<slug>/validar-premio?ref=`)
 *    que el cliente le manda por WhatsApp al numero de atencion del local.
 */
@Injectable()
export class PremiosService {
  private readonly logger = new Logger('Premios');

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly resolver: SucursalResolverService,
    private readonly auditoria: AuditoriaService,
    private readonly disparos: DisparosService,
  ) {}

  // ==========================================================================
  // PAGINA PUBLICA DE ACEPTAR (el token es la única llave, sin login)
  // ==========================================================================

  /** GET /premios/:token -> datos para la modal de aceptar. 404 si el token no existe. */
  async publico(token: string) {
    const premio = await this.exigir(token);
    const det = await this.detalle(premio);
    // Si el premio YA fue aceptado (o canjeado), se devuelve tambien el mecanismo de canje
    // (link + WhatsApp): asi la modal muestra el boton tambien al RECARGAR la pagina, no
    // solo en la respuesta del aceptar (que vive en memoria).
    const verificacion =
      premio.estado === 'ACEPTADO' || premio.estado === 'CANJEADO'
        ? await this.linkCanje(premio)
        : null;
    return { ...det, verificacion };
  }

  /**
   * POST /premios/:token/aceptar -> PENDIENTE -> ACEPTADO (claim atomico) y acredita el
   * saldo UNA sola vez. Idempotente: un segundo tap devuelve `yaAceptado:true` sin volver
   * a acreditar. Un premio vencido no se puede aceptar (queda VENCIDO).
   */
  async aceptar(token: string) {
    const premio = await this.exigir(token);
    const ahora = new Date();

    // Vencido: se marca VENCIDO (sin tocar saldo). No rompe: la modal muestra el mensaje.
    if (premio.estado === 'PENDIENTE' && premio.expiraEn && premio.expiraEn.getTime() < ahora.getTime()) {
      await this.prisma.premioOtorgado.updateMany({
        where: { token, estado: 'PENDIENTE' },
        data: { estado: 'VENCIDO' },
      });
      const vencido = await this.exigir(token);
      return {
        ...(await this.detalle(vencido)),
        ok: false,
        motivo: 'vencido',
        yaAceptado: false,
        acreditado: { sellos: 0, puntos: 0 },
        verificacion: null,
      };
    }

    // Ya aceptado/canjeado: no se vuelve a acreditar. Se devuelve el link de canje.
    if (premio.estado !== 'PENDIENTE') {
      return {
        ...(await this.detalle(premio)),
        ok: premio.estado !== 'VENCIDO',
        motivo: premio.estado === 'VENCIDO' ? 'vencido' : 'ya-aceptado',
        yaAceptado: premio.estado !== 'VENCIDO',
        acreditado: { sellos: 0, puntos: 0 },
        verificacion: premio.estado === 'VENCIDO' ? null : await this.linkCanje(premio),
      };
    }

    // CLAIM ATOMICO: solo gana quien pasa PENDIENTE -> ACEPTADO (count === 1).
    const claim = await this.prisma.premioOtorgado.updateMany({
      where: { token, estado: 'PENDIENTE' },
      data: { estado: 'ACEPTADO', aceptadoEn: ahora },
    });
    if (claim.count !== 1) {
      // Otro request gano la carrera: NO se acredita de nuevo.
      const actual = await this.exigir(token);
      return {
        ...(await this.detalle(actual)),
        ok: actual.estado !== 'VENCIDO',
        motivo: 'ya-aceptado',
        yaAceptado: true,
        acreditado: { sellos: 0, puntos: 0 },
        verificacion: await this.linkCanje(actual),
      };
    }

    // ACREDITACION (una sola vez: el claim ya garantiza el ganador). Se reusa la MISMA
    // logica del club via `DisparosService.aplicarRegalo`.
    let aplicado = { sellos: 0, puntos: 0 };
    if (premio.tipo !== 'LIBRE' && premio.cantidad > 0) {
      try {
        const cfg = await this.disparos.contexto(premio.negocioId);
        const sucursalId =
          premio.sucursalId ??
          ((await this.resolver.resolverSucursal(premio.negocioId, { clienteId: premio.clienteId }))
            .id as string);
        const regalo = premio.tipo === 'SELLOS' ? { sellos: premio.cantidad } : { puntos: premio.cantidad };
        aplicado = await this.disparos.aplicarRegalo(premio.clienteId, sucursalId, regalo, cfg);
        await this.auditoria.registrar({
          negocioId: premio.negocioId,
          accion: 'premio.aceptado',
          clienteId: premio.clienteId,
          detalle: {
            premioId: premio.id,
            token: premio.token,
            tipo: premio.tipo,
            cantidad: premio.cantidad,
            sellos: aplicado.sellos,
            puntos: aplicado.puntos,
            sucursalId,
          },
        });
      } catch (e) {
        // No se pierde el premio: ya quedo ACEPTADO. Se loguea para diagnostico.
        this.logger.error(`Fallo la acreditacion del premio ${premio.id}: ${(e as Error).message}`);
      }
    } else {
      await this.auditoria.registrar({
        negocioId: premio.negocioId,
        accion: 'premio.aceptado',
        clienteId: premio.clienteId,
        detalle: { premioId: premio.id, token: premio.token, tipo: premio.tipo, cantidad: 0 },
      });
    }

    const aceptado = await this.exigir(token);
    return {
      ...(await this.detalle(aceptado)),
      ok: true,
      motivo: null,
      yaAceptado: false,
      acreditado: aplicado,
      verificacion: await this.linkCanje(aceptado),
    };
  }

  // ==========================================================================
  // VERIFICACION / CANJE DEL STAFF (misma pagina de verificacion, adaptada)
  // ==========================================================================

  /** GET /premios/:token/verificacion -> datos que ve el STAFF en el link. */
  async verificacion(token: string) {
    const premio = await this.exigir(token);
    const det = await this.detalle(premio);
    return {
      ...det,
      /** El staff puede marcar CANJEADO solo si el cliente ya lo ACEPTO. */
      canjeable: premio.estado === 'ACEPTADO',
      verificadoEn: new Date().toISOString(),
    };
  }

  /**
   * POST /premios/:token/canjear -> ACEPTADO -> CANJEADO (claim atomico). Lo hace el
   * STAFF desde el link. Un premio LIBRE se "cierra" aca; uno SELLOS/PUNTOS ya acredito
   * el saldo al aceptar.
   */
  async canjear(token: string, empleado: { id: string; negocioId: string }) {
    const premio = await this.exigir(token);
    if (premio.negocioId !== empleado.negocioId) {
      throw new ForbiddenException('El premio no pertenece a tu negocio');
    }

    if (premio.estado === 'CANJEADO') {
      return { ...(await this.detalle(premio)), ok: true, yaCanjeado: true, estado: 'CANJEADO' };
    }
    if (premio.estado !== 'ACEPTADO') {
      throw new ConflictException(
        premio.estado === 'VENCIDO'
          ? 'El premio esta vencido'
          : 'El cliente todavia no acepto el premio',
      );
    }

    const claim = await this.prisma.premioOtorgado.updateMany({
      where: { token, estado: 'ACEPTADO' },
      data: { estado: 'CANJEADO', canjeadoEn: new Date() },
    });
    if (claim.count !== 1) {
      const actual = await this.exigir(token);
      return {
        ...(await this.detalle(actual)),
        ok: actual.estado === 'CANJEADO',
        yaCanjeado: actual.estado === 'CANJEADO',
        estado: actual.estado,
      };
    }

    // Contadores de canje (best-effort, mismo criterio GLOBAL/POR_SUCURSAL del club).
    await this.contarCanje(premio).catch(() => undefined);

    await this.auditoria.registrar({
      negocioId: premio.negocioId,
      accion: 'premio.canjeado',
      empleadoId: empleado.id,
      clienteId: premio.clienteId,
      detalle: { premioId: premio.id, token: premio.token, tipo: premio.tipo },
    });

    const canjeado = await this.exigir(token);
    return { ...(await this.detalle(canjeado)), ok: true, yaCanjeado: false, estado: 'CANJEADO' };
  }

  // ==========================================================================
  // INTERNOS
  // ==========================================================================

  private async exigir(token: string): Promise<PremioOtorgado> {
    if (!token || typeof token !== 'string') throw new NotFoundException('Premio no encontrado');
    const premio = await this.prisma.premioOtorgado.findUnique({ where: { token } });
    if (!premio) throw new NotFoundException('Premio no encontrado');
    return premio;
  }

  /**
   * Datos PUBLICOS del premio (los ve el cliente y el staff). Privacidad: solo el nombre
   * de PILA del cliente; jamas telefono/email/id.
   */
  private async detalle(premio: PremioOtorgado) {
    const [neg, cfg, cli] = await Promise.all([
      this.prisma.negocio.findUnique({
        where: { id: premio.negocioId },
        select: {
          nombre: true,
          slug: true,
          logoUrl: true,
          colorPrimario: true,
          colorSecundario: true,
          theme: true,
        },
      }),
      this.prisma.configuracionClub.findUnique({
        where: { negocioId: premio.negocioId },
        select: { modoFidelizacion: true, premioTexto: true },
      }),
      this.prisma.cliente.findUnique({
        where: { id: premio.clienteId },
        select: { nombre: true },
      }),
    ]);

    return {
      token: premio.token,
      estado: premio.estado,
      tipo: premio.tipo,
      cantidad: premio.cantidad,
      texto: premio.texto,
      expiraEn: premio.expiraEn ? premio.expiraEn.toISOString() : null,
      expiraLegible: vencimientoLegible(premio.expiraEn),
      aceptadoEn: premio.aceptadoEn ? premio.aceptadoEn.toISOString() : null,
      canjeadoEn: premio.canjeadoEn ? premio.canjeadoEn.toISOString() : null,
      disparoNombre: premio.disparoNombre ?? null,
      campanaNombre: premio.campanaNombre ?? null,
      cliente: { nombre: primerNombre(cli?.nombre ?? '') },
      negocio: {
        nombre: neg?.nombre ?? 'el local',
        slug: neg?.slug ?? null,
        logoUrl: neg?.logoUrl ?? null,
        colorPrimario: neg?.colorPrimario ?? null,
        colorSecundario: neg?.colorSecundario ?? null,
        theme: neg?.theme ?? null,
      },
      premioTexto: cfg?.premioTexto ?? null,
      modoFidelizacion: cfg?.modoFidelizacion ?? 'SOLO_VISITAS',
    };
  }

  /**
   * Mecanismo de canje = el MISMO flujo de verificacion que ya existe: un link ABSOLUTO
   * generado por el SERVIDOR (STAFF_APP_URL + slug) + el boton de WhatsApp que lo manda
   * al numero de atencion del local. NUNCA `window.location.origin`.
   */
  private async linkCanje(premio: PremioOtorgado) {
    const url = await this.push.urlVerificacionPremio(premio.negocioId, premio.token);
    const negocio = await this.prisma.negocio.findUnique({
      where: { id: premio.negocioId },
      select: { nombre: true },
    });
    const numero = await this.resolver
      .resolverNumeroAtendiente(premio.negocioId, premio.sucursalId ?? undefined)
      .catch(() => null);

    const nombreLocal = negocio?.nombre ? ` en ${negocio.nombre}` : '';
    const mensaje =
      `Hola! Gane "${premio.texto}"${nombreLocal} y quiero canjearlo. ` +
      `Te muestro el premio para verificarlo: ${url}`;
    const whatsapp = numero
      ? `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(mensaje)}`
      : null;

    return { url, whatsapp, numero, mensaje, texto: premio.texto };
  }

  /** Suma 1 al contador de canjes, con la regla GLOBAL vs POR_SUCURSAL del club. */
  private async contarCanje(premio: PremioOtorgado) {
    const cfg = await this.disparos.contexto(premio.negocioId);
    if (cfg.porSucursal && premio.sucursalId) {
      await this.prisma.tarjetaClienteSucursal.updateMany({
        where: { clienteId: premio.clienteId, sucursalId: premio.sucursalId },
        data: { premiosCanjeados: { increment: 1 }, ultimaVisita: new Date() },
      });
    }
    await this.prisma.cliente.update({
      where: { id: premio.clienteId },
      data: { premiosCanjeados: { increment: 1 }, ultimoCanjeEn: new Date() },
    });
  }
}

/** Primer nombre: corta en el primer espacio. Un solo nombre se devuelve entero. */
function primerNombre(nombre: string): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}
