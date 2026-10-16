import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EstadoPremio, PremioOtorgado, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SaldoNotificador } from '../common/saldo/saldo-notificador.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { PushService } from './push.service';
import { DisparosService } from './disparos.service';
import { vencimientoLegible } from './premio.types';
import type { SaldoPar } from '@repo/types';

/** Par antes/despues del saldo del cliente que la modal del premio muestra para verificar el cambio. */
export interface SaldoPremio {
  antes: SaldoPar;
  despues: SaldoPar;
}

/**
 * Contexto del mecanismo de canje, leido UNA vez por request: el negocio (nombre + slug) y el numero
 * de atencion EFECTIVO del club y de cada sucursal involucrada. Evita las 3-4 consultas por premio
 * del listado de la tarjeta.
 */
interface ContextoCanje {
  nombre: string | null;
  slug: string | null;
  numeroDelClub: string | null;
  /** Numero efectivo por sucursal (la clave es el `sucursalId`). */
  numeros: Map<string, string | null>;
}

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
    private readonly saldo: SaldoNotificador,
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
    // Par antes/despues REAL de esta aceptacion: lo usan la respuesta y la modal.
    let saldoPar: SaldoPremio | null = null;
    const sucursalId = await this.sucursalDe(premio);
    if (premio.tipo !== 'LIBRE' && premio.cantidad > 0) {
      try {
        const cfg = await this.disparos.contexto(premio.negocioId);
        const res = await this.disparos.aplicarRegalo(
          premio.negocioId, premio.clienteId, sucursalId, this.regaloDe(premio), cfg,
          'premio_aceptado', premio.id,
        );
        aplicado = { sellos: res.sellos, puntos: res.puntos };
        // El par sale de las filas que `aplicarRegalo` acaba de escribir (misma fuente que la
        // acreditacion): no se recalcula a mano ni se re-consulta el saldo.
        saldoPar = { antes: res.saldoAntes, despues: res.saldoDespues };
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
            saldo: saldoPar,
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

    // Un premio LIBRE (o una acreditacion que fallo) no mueve el saldo: el par es el saldo del
    // momento, con antes == despues. Asi la modal del LIBRE tampoco miente.
    if (!saldoPar) {
      const actual = await this.saldo
        .parActual(premio.negocioId, premio.clienteId, sucursalId)
        .catch(() => ({ sellos: 0, puntos: 0 }));
      saldoPar = { antes: actual, despues: actual };
    }

    // Persistir el par: el GET publico lo devuelve al RECARGAR la pagina (el saldo actual ya no
    // sirve para reconstruirlo). Best-effort: si falla, la aceptacion ya esta hecha y el GET cae
    // al saldo actual con antes == despues.
    await this.prisma.premioOtorgado
      .update({ where: { token }, data: { saldoJson: saldoPar as unknown as Prisma.InputJsonValue } })
      .catch((e) =>
        this.logger.warn(`No se pudo persistir el saldo del premio ${premio.id}: ${(e as Error).message}`),
      );

    const aceptado = await this.exigir(token);
    const det = await this.detalle(aceptado);
    return {
      ...det,
      // El par de ESTA aceptacion manda sobre el que leyo `detalle` (que puede ser el actual).
      saldo: saldoPar,
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
  // LISTADO PROPIO (PWA Cliente -> "Mis premios" en /tarjeta)
  // ==========================================================================

  /**
   * Premios del CLIENTE autenticado, SIEMPRE scoped por `negocioId + clienteId` (nunca por token
   * suelto: un premio de otro cliente o de otro negocio no puede aparecer en esta lista).
   *
   * POR QUE EXISTE: el mecanismo de canje (link del staff + WhatsApp) vivia SOLO dentro de la modal
   * de aceptar. Si el cliente la cerraba —o descartaba el push— un premio ACEPTADO quedaba
   * IRRECUPERABLE, y en un LIBRE (que no mueve saldo: su unico valor es canjearlo en el local) eso
   * significa perder el premio. Este listado es la fuente del bloque "Tus premios ganados".
   *
   * ESTADO COMPUTADO (clave): `VENCIDO` solo se PERSISTE cuando alguien intenta aceptar
   * (`aceptar()`) o cuando pasa el cron de `PushScheduler.marcarPremiosVencidos`. En la DB puede
   * haber filas PENDIENTE con `expiraEn` ya pasado, asi que aca el vencimiento se COMPUTA
   * (`expiraEn < now` -> VENCIDO) para no mostrar como "pendiente" algo que ya no se puede aceptar.
   * Un GET no escribe: la fila queda como estaba.
   *
   * ORDEN: por relevancia. Primero lo que el cliente YA puede canjear (ACEPTADO: es el que trae su
   * link para mostrar en el local y el que el cliente viene a buscar), despues lo accionable
   * (PENDIENTE: le falta aceptarlo) y al final el historial (CANJEADO -> VENCIDO). Dentro de cada
   * grupo, el mas nuevo primero.
   * TOPE: `LIMITE_PREMIOS` (el diagnostico avisa que la acumulacion no tenia tope). Los activos se
   * leen APARTE para que un PENDIENTE viejo no quede afuera por un tope de "los N mas nuevos".
   */
  async mios(negocioId: string, clienteId: string) {
    const donde: Prisma.PremioOtorgadoWhereInput = { negocioId, clienteId };

    const [total, activos, historial] = await Promise.all([
      this.prisma.premioOtorgado.count({ where: donde }),
      this.prisma.premioOtorgado.findMany({
        where: { ...donde, estado: { in: ['PENDIENTE', 'ACEPTADO'] } },
        orderBy: { creadoEn: 'desc' },
        take: LIMITE_PREMIOS,
      }),
      this.prisma.premioOtorgado.findMany({
        where: { ...donde, estado: { in: ['CANJEADO', 'VENCIDO'] } },
        orderBy: { creadoEn: 'desc' },
        take: LIMITE_PREMIOS,
      }),
    ]);

    const ahora = Date.now();
    const filas = [...activos, ...historial]
      .map((fila) => ({ fila, estado: estadoComputado(fila, ahora) }))
      .sort(
        (a, b) =>
          PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado] ||
          b.fila.creadoEn.getTime() - a.fila.creadoEn.getTime(),
      )
      .slice(0, LIMITE_PREMIOS);

    // El mecanismo de canje se resuelve DESPUES del tope: son 2-3 queries por premio (slug del
    // negocio + numero de atencion) y no tiene sentido pagarlas por premios que no se muestran.
    // Solo en ACEPTADO (para poder mostrarlo en el local) y CANJEADO (comprobante del historial):
    // un PENDIENTE todavia no tiene nada que verificar y uno VENCIDO ya no se puede canjear.
    //
    // BATCHEADO: el contexto (negocio + numero de atencion de cada sucursal involucrada) se arma
    // UNA vez para TODOS los premios mostrados. Antes cada uno disparaba sus propias 3-4 consultas
    // (`slugDelNegocio` + `negocio.findUnique` + `resolverNumeroAtendiente`, que son 2): con 10
    // premios en la tarjeta eso eran 30-40 consultas por request.
    const conCanje = filas.filter(
      ({ estado }) => estado === 'ACEPTADO' || estado === 'CANJEADO',
    );
    const ctxCanje = conCanje.length
      ? await this.contextoCanje(negocioId, conCanje.map(({ fila }) => fila.sucursalId))
      : null;

    const premios = filas.map(async ({ fila, estado }) => ({
      token: fila.token,
      tipo: fila.tipo,
      cantidad: fila.cantidad,
      texto: fila.texto,
      expiraEn: fila.expiraEn ? fila.expiraEn.toISOString() : null,
      expiraLegible: vencimientoLegible(fila.expiraEn),
      aceptadoEn: fila.aceptadoEn ? fila.aceptadoEn.toISOString() : null,
      canjeadoEn: fila.canjeadoEn ? fila.canjeadoEn.toISOString() : null,
      creadoEn: fila.creadoEn.toISOString(),
      disparoNombre: fila.disparoNombre ?? null,
      campanaNombre: fila.campanaNombre ?? null,
      /** Computado (ver arriba): NO es el `estado` crudo de la fila. */
      estado,
      verificacion:
        ctxCanje && (estado === 'ACEPTADO' || estado === 'CANJEADO')
          ? await this.linkCanje(fila, ctxCanje)
          : null,
    }));

    // `map` con `await` (no `Promise.all`): los premios con canje comparten el MISMO contexto ya
    // leido, asi que no hay consultas que paralelizar — solo armado de strings.
    const premiosResueltos = await Promise.all(premios);

    return { total, mostrados: premiosResueltos.length, premios: premiosResueltos };
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
      /**
       * Par antes/despues del saldo: es lo que la modal usa para VERIFICAR el cambio. Sale de la
       * MISMA fuente que la acreditacion (ver `saldoDe`), nunca de un recalculo a mano.
       */
      saldo: await this.saldoDe(premio, cfg?.modoFidelizacion),
    };
  }

  /**
   * Par antes/despues del saldo del cliente para la modal.
   *
   *  - Premio ACEPTADO/CANJEADO con el par persistido: el MISMO que quedo registrado al aceptar
   *    (`saldoJson`). Es el caso del cliente que RECARGA la pagina: el saldo actual ya no sirve
   *    para reconstruirlo.
   *  - Premio PENDIENTE: el saldo actual y la PROYECCION de lo que acreditara (misma regla que
   *    `DisparosService.calcularRegalo`), asi la modal puede anticipar "vas a quedar en X".
   *  - Cualquier otro (VENCIDO, o aceptado antes de que existiera `saldoJson`): el saldo actual
   *    con antes == despues. No se inventa un historico que no esta.
   */
  private async saldoDe(premio: PremioOtorgado, modoFidelizacion?: string | null): Promise<SaldoPremio> {
    const guardado = leerSaldoJson(premio.saldoJson);
    if (guardado && premio.estado !== 'PENDIENTE') return guardado;

    const sucursalId = await this.sucursalDe(premio);
    const actual = await this.saldo
      .parActual(premio.negocioId, premio.clienteId, sucursalId)
      .catch(() => ({ sellos: 0, puntos: 0 }));

    if (premio.estado !== 'PENDIENTE') return { antes: actual, despues: actual };

    const modo = modoFidelizacion ?? (await this.disparos.contexto(premio.negocioId)).modo;
    const suma = this.disparos.calcularRegalo(this.regaloDe(premio), modo);
    return {
      antes: actual,
      despues: { sellos: actual.sellos + suma.sellos, puntos: actual.puntos + suma.puntos },
    };
  }

  /** Sucursal del premio: la que quedo registrada o, si es legacy, la que resuelve el club. */
  private async sucursalDe(premio: PremioOtorgado): Promise<string> {
    if (premio.sucursalId) return premio.sucursalId;
    const resuelta = await this.resolver
      .resolverSucursal(premio.negocioId, { clienteId: premio.clienteId })
      .catch(() => null);
    return (resuelta?.id as string | undefined) ?? '';
  }

  /**
   * Descriptor del premio -> regalo. UNA sola definicion: la usan la acreditacion real
   * (`aceptar`) y la proyeccion que muestra la modal (`saldoDe`). LIBRE no mueve saldo.
   */
  private regaloDe(premio: PremioOtorgado): { sellos?: number; puntos?: number } {
    if (premio.tipo === 'LIBRE' || premio.cantidad <= 0) return {};
    return premio.tipo === 'SELLOS' ? { sellos: premio.cantidad } : { puntos: premio.cantidad };
  }

  /**
   * Mecanismo de canje = el MISMO flujo de verificacion que ya existe: un link ABSOLUTO
   * generado por el SERVIDOR (STAFF_APP_URL + slug) + el boton de WhatsApp que lo manda
   * al numero de atencion del local. NUNCA `window.location.origin`.
   *
   * `ctxCanje`: contexto YA leido (lo arma el listado una vez para todos los premios). Sin el se
   * resuelve aca (los caminos de UN solo premio: aceptar/verificar/canjear).
   */
  private async linkCanje(premio: PremioOtorgado, ctxCanje?: ContextoCanje) {
    const ctx = ctxCanje ?? await this.contextoCanje(premio.negocioId, [premio.sucursalId]);
    const url = await this.push.urlVerificacionPremio(premio.negocioId, premio.token, ctx.slug);
    const nombreLocal = ctx.nombre ? ` en ${ctx.nombre}` : '';
    const mensaje =
      `Hola! Gane "${premio.texto}"${nombreLocal} y quiero canjearlo. ` +
      `Te muestro el premio para verificarlo: ${url}`;
    const numero = ctx.numeros.get(premio.sucursalId ?? '') ?? ctx.numeroDelClub;
    const whatsapp = numero
      ? `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(mensaje)}`
      : null;

    return { url, whatsapp, numero, mensaje, texto: premio.texto };
  }

  /**
   * Contexto del canje para VARIOS premios a la vez: el negocio (1 consulta) y el numero de atencion
   * EFECTIVO de cada sucursal DISTINTA involucrada (2 consultas por sucursal, resueltas por
   * `SucursalResolverService` — la unica fuente de la regla club-vs-sucursal).
   *
   * Con esto, una tarjeta con 10 premios ACEPTADO/CANJEADO pasa de 30-40 consultas a 3-5.
   */
  private async contextoCanje(
    negocioId: string,
    sucursales: (string | null)[],
  ): Promise<ContextoCanje> {
    const distintas = [...new Set(sucursales.filter((s): s is string => !!s))];
    const [negocio, numeroDelClub, ...porSucursal] = await Promise.all([
      this.prisma.negocio.findUnique({
        where: { id: negocioId },
        select: { nombre: true, slug: true },
      }),
      this.resolver.resolverNumeroAtendiente(negocioId).catch(() => null),
      ...distintas.map((s) =>
        this.resolver.resolverNumeroAtendiente(negocioId, s).catch(() => null),
      ),
    ]);

    const numeros = new Map<string, string | null>();
    distintas.forEach((sucursalId, i) => numeros.set(sucursalId, porSucursal[i] ?? null));

    return {
      nombre: negocio?.nombre ?? null,
      slug: negocio?.slug ?? null,
      numeroDelClub: numeroDelClub ?? null,
      numeros,
    };
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

/**
 * TOPE del listado "Mis premios". El diagnostico avisa que la acumulacion no tenia tope: con
 * decenas de premios la tarjeta se vuelve ilegible. Los activos (PENDIENTE/ACEPTADO) se leen aparte,
 * asi que el tope nunca esconde uno accionable.
 */
const LIMITE_PREMIOS = 20;

/**
 * Orden por RELEVANCIA del listado: primero lo que el cliente YA puede canjear (ACEPTADO, que trae su
 * link para mostrarlo en el local), despues lo accionable (PENDIENTE: le falta aceptarlo) y al final
 * el historial (CANJEADO -> VENCIDO). Dentro de cada grupo, el mas nuevo primero.
 */
const PESO_ESTADO: Record<EstadoPremio, number> = {
  ACEPTADO: 0,
  PENDIENTE: 1,
  CANJEADO: 2,
  VENCIDO: 3,
};

/**
 * Estado EFECTIVO de un premio: el de la fila, salvo que este PENDIENTE y ya haya pasado `expiraEn`.
 *
 * `VENCIDO` solo se persiste al intentar aceptar (o en el cron de vencimiento), asi que sin este
 * computo el listado mostraria como "pendiente" —con boton de Aceptar— un premio que el backend
 * va a rechazar. Solo lectura: no escribe nada.
 */
function estadoComputado(premio: PremioOtorgado, ahoraMs: number): EstadoPremio {
  if (premio.estado !== 'PENDIENTE') return premio.estado;
  return premio.expiraEn && premio.expiraEn.getTime() < ahoraMs ? 'VENCIDO' : 'PENDIENTE';
}

/** Primer nombre: corta en el primer espacio. Un solo nombre se devuelve entero. */
function primerNombre(nombre: string): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Lee el par antes/despues persistido en `PremioOtorgado.saldoJson`.
 *
 * Devuelve null si el premio es de antes de esa columna o si el JSON no tiene la forma esperada:
 * el consumidor cae al saldo actual (antes == despues) en vez de mostrar un historico inventado.
 */
function leerSaldoJson(valor: unknown): SaldoPremio | null {
  if (!valor || typeof valor !== 'object') return null;
  const v = valor as { antes?: unknown; despues?: unknown };
  const par = (x: unknown): SaldoPar | null => {
    if (!x || typeof x !== 'object') return null;
    const p = x as { sellos?: unknown; puntos?: unknown };
    const sellos = Number(p.sellos);
    const puntos = Number(p.puntos);
    if (!Number.isFinite(sellos) || !Number.isFinite(puntos)) return null;
    return { sellos, puntos };
  };
  const antes = par(v.antes);
  const despues = par(v.despues);
  return antes && despues ? { antes, despues } : null;
}
