import {
  BadRequestException, ForbiddenException, GoneException, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, TipoVisita } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { SegmentosService } from '../clientes/segmentos.service';
import { enmascararTelefono } from '../common/utils/phone.util';
import { getPagination, paginar } from '../common/utils/pagination.util';
import { VisitasGateway } from './visitas.gateway';
import { FidelizacionService } from '../fidelizacion/fidelizacion.service';
import type { SolicitarVisitaDto } from './dto/solicitar-visita.dto';
import type { AprobarVisitaDto } from './dto/aprobar-visita.dto';
import type { CanjearPremioDto } from './dto/canjear-premio.dto';
import type { RechazarVisitaDto } from './dto/rechazar-visita.dto';
import type { HistorialVisitasDto } from './dto/historial-visitas.dto';

/** Empleado autenticado (staff o dueño) resuelto por StaffGuard. */
export interface EmpleadoCtx {
  id: string; negocioId: string; rol: string; sucursalId: string; ip?: string;
}

export interface ClienteCtx {
  id: string; negocioId: string; nombre: string; telefono: string; negocioSlug?: string;
}

const TTL_TOKEN_MS = 5 * 60 * 1000; // 5 min

/**
 * El RECHAZO se guarda en Redis, no en la tabla.
 *
 * Motivo: `TokenValidacion` solo tiene `usado`, asi que aprobar y rechazar dejan
 * la fila IDENTICA y `GET /visitas/estado/:token` no podria distinguirlos. El
 * evento de auditoria de `visita.rechazada` tampoco guarda el tokenId, asi que
 * no sirve para consultarlo.
 *
 * Alternativa durable (requiere migracion): agregar `rechazadoEn DateTime?` a
 * TokenValidacion. La clave de Redis alcanza para el caso real (la PWA consulta
 * dentro de la ventana de 5 min del token) y no toca el schema consolidado.
 */
const CLAVE_RECHAZO = (token: string) => `visita:rechazada:${token}`;

@Injectable()
export class VisitasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditoria: AuditoriaService,
    private readonly resolver: SucursalResolverService,
    private readonly segmentos: SegmentosService,
    private readonly gateway: VisitasGateway,
    private readonly fidelizacion: FidelizacionService,
  ) {}

  /**
   * Refinamiento (Lote 4): valida que el empleado pueda operar sobre la
   * sucursal del token. Si es de otra sucursal y NO tiene accesoMultiSucursal
   * -> 403. Se aplica a aprobar / rechazar / validar.
   */
  private async exigirAccesoSucursal(empleadoId: string, sucursalTokenId: string | null) {
    if (!sucursalTokenId) return; // token legacy sin sucursal

    const empleado = await this.prisma.empleado.findFirst({
      where: { id: empleadoId },
      select: { sucursalId: true, accesoMultiSucursal: true },
    });
    if (!empleado) throw new ForbiddenException('Empleado no valido');

    if (empleado.sucursalId === sucursalTokenId) return;
    if (empleado.accesoMultiSucursal) return;

    throw new ForbiddenException('No tenes acceso a la sucursal de esta visita');
  }

  /** POST /visitas/solicitar (cliente). Resuelve la sucursal y crea el token de 5 min. */
  async solicitar(negocioId: string, clienteCtx: ClienteCtx, dto: SolicitarVisitaDto) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteCtx.id, negocioId, eliminadoEn: null },
      select: { id: true, nombre: true, telefono: true, sellosActuales: true, ultimaVisita: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    // La sucursal del token se resuelve con SucursalResolverService.
    // El cliente no tiene claim sucursalId -> cae a la sucursal principal.
    const sucursal = await this.resolver.resolverSucursal(negocioId, {
      sucursalId: dto.sucursalId ?? null,
      sucursalSlug: dto.sucursalSlug ?? null,
    });

    const config = await this.prisma.configuracionClub.findUnique({
      where: { negocioId },
      select: { horasMinimasEntreVisitas: true, limiteVisitasPorDia: true },
    });

    // Horas minimas entre visitas
    const horas = config?.horasMinimasEntreVisitas ?? 0;
    if (horas > 0 && cliente.ultimaVisita) {
      const transcurridas = (Date.now() - cliente.ultimaVisita.getTime()) / 3_600_000;
      if (transcurridas < horas) {
        const faltan = Math.ceil(horas - transcurridas);
        throw new BadRequestException(
          `Todavia no podes sumar otra visita: espera ${faltan} hora(s) mas`,
        );
      }
    }

    // Limite diario
    const limite = config?.limiteVisitasPorDia ?? 0;
    if (limite > 0) {
      const desde = new Date();
      desde.setHours(0, 0, 0, 0);
      const hoy = await this.prisma.visita.count({ where: { negocioId, clienteId: cliente.id, aprobadoEn: { gte: desde } } });
      if (hoy >= limite) throw new BadRequestException('Alcanzaste el limite de visitas por dia');
    }

    // Si ya hay un token activo PARA ESA SUCURSAL, se reutiliza (evita que un
    // doble tap genere dos). El filtro por sucursalId es imprescindible: sin el,
    // una solicitud a Norte reutilizaba el token activo de Centro, la respuesta
    // informaba "Norte" y el token apuntaba a Centro (bug detectado en el e2e).
    const activo = await this.prisma.tokenValidacion.findFirst({
      where: {
        negocioId, clienteId: cliente.id, sucursalId: sucursal.id as string,
        usado: false, expiraEn: { gt: new Date() },
      },
      orderBy: { creadoEn: 'desc' },
    });
    const token = activo ?? await this.prisma.tokenValidacion.create({
      data: {
        negocioId,
        clienteId: cliente.id,
        sucursalId: sucursal.id as string, // Opción A: el token sabe donde se pidio
        token: randomUUID(),
        expiraEn: new Date(Date.now() + TTL_TOKEN_MS),
      },
    });

    if (!activo) {
      await this.auditoria.registrar({
        negocioId, accion: 'visita.solicitada', clienteId: cliente.id,
        detalle: { tokenId: token.id, sucursalId: sucursal.id },
      });
    }

    const telefonoEnmascarado = enmascararTelefono(cliente.telefono);
    // El link de validacion va en el mensaje: el staff lo abre desde el WhatsApp y cae
    // directo en la pantalla de aprobacion, con el token ya puesto.
    const urlValidacion = `${(process.env.STAFF_APP_URL ?? 'https://staff.clubio.lat').replace(/\/$/, '')}/validar?ref=${token.token}`;
    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId },
      select: { nombre: true },
    });
    const mensajeWhatsApp =
      `Hola, soy ${cliente.nombre}. Quiero sumar mi visita en ${negocio?.nombre ?? 'el local'}. ` +
      `Ref: ${token.token}. Validar aqui: ${urlValidacion}`;

    // WebSocket: solo a la sucursal destino + a los dueños
    this.gateway.emitirSolicitada({
      negocioId,
      sucursalId: sucursal.id as string,
      token: token.token,
      expiraEn: token.expiraEn,
      origen: dto.origen,
      cliente: {
        id: cliente.id, nombre: cliente.nombre,
        telefonoEnmascarado, sellosActuales: cliente.sellosActuales,
      },
    });

    return {
      token: token.token,
      // E (#3.0): la URL del staff sale del entorno, no hardcodeada.
      urlValidacion: `${(process.env.STAFF_APP_URL ?? 'https://staff.clubio.lat').replace(/\/$/, '')}/validar?ref=${token.token}`,
      mensajeWhatsApp,
      expiraEn: token.expiraEn,
      reutilizado: !!activo,
      // Se informa la sucursal del TOKEN almacenado (fuente de verdad).
      sucursal: { id: sucursal.id, nombre: sucursal.nombre, slug: sucursal.slug },
    };
  }

  /** GET /visitas/validar/:token (staff). */
  async validar(negocioId: string, token: string, empleadoId: string) {
    const fila = await this.cargarToken(negocioId, token);
    await this.exigirAccesoSucursal(empleadoId, fila.sucursalId);

    return {
      token: fila.token,
      estado: fila.usado ? 'USADO' : fila.expiraEn < new Date() ? 'EXPIRADO' : 'VALIDO',
      expiraEn: fila.expiraEn,
      sucursalId: fila.sucursalId,
      sucursal: fila.sucursal,
      cliente: {
        id: fila.cliente.id,
        nombre: fila.cliente.nombre,
        telefono: enmascararTelefono(fila.cliente.telefono),
        sellosActuales: fila.cliente.sellosActuales,
        puntosActuales: fila.cliente.puntosActuales,
        totalVisitas: fila.cliente.totalVisitas,
        etiqueta: fila.cliente.etiqueta,
        ultimaVisita: fila.cliente.ultimaVisita,
      },
    };
  }

  /** POST /visitas/aprobar/:token (staff). */
  async aprobar(negocioId: string, token: string, empleado: EmpleadoCtx, dto: AprobarVisitaDto) {
    const fila = await this.cargarToken(negocioId, token);
    await this.exigirAccesoSucursal(empleado.id, fila.sucursalId);

    if (fila.usado) throw new BadRequestException('Este token ya fue usado');
    if (fila.expiraEn < new Date()) throw new GoneException('El token expiro');

    // Sucursal efectiva de la visita: la del TOKEN (Opción A). Si es legacy
    // (sin sucursalId), se usa la del empleado que aprueba.
    const sucursalId = fila.sucursalId ?? empleado.sucursalId;

    const config = await this.prisma.configuracionClub.findUnique({
      where: { negocioId },
      select: { mostrarResenaPostVisita: true },
    });
    // Estaba HARDCODEADO en true: el dueño apaga las resenas y la PWA igual las
    // mostraba. Ahora manda la configuracion del club.
    const mostrarResena = config?.mostrarResenaPostVisita ?? false;

    const resultado = await this.prisma.$transaction(async (tx) => {
      const marcado = await tx.tokenValidacion.updateMany({
        where: { id: fila.id, usado: false }, data: { usado: true },
      });
      if (marcado.count === 0) throw new BadRequestException('Este token ya fue usado');

      // Sellos + puntos: los decide FidelizacionService segun el modo del negocio y el monto.
      // (Antes era `sellosOtorgados = 1` fijo y los puntos siempre 0.)
      const acreditado = await this.fidelizacion.acreditar(tx, {
        negocioId,
        clienteId: fila.clienteId,
        sucursalId,
        empleadoId: empleado.id,
        monto: dto.montoConsumido ?? null,
        tipo: TipoVisita.VISITA,
        metodo: 'QR_DINAMICO',
        origen: dto.origen ?? null,
        notas: dto.notas ?? null,
      });

      return acreditado;
    });

    await this.auditoria.registrar({
      negocioId, accion: 'visita.aprobada', empleadoId: empleado.id, clienteId: fila.clienteId,
      detalle: {
        visitaId: resultado.visitaId, sucursalId, origen: dto.origen ?? null,
        sellos: resultado.sellos, puntos: resultado.puntos, monto: dto.montoConsumido ?? null,
      },
      ip: empleado.ip,
    });

    this.gateway.emitirAprobada(fila.clienteId, {
      visitaId: resultado.visitaId,
      sucursalId,
      sellosActuales: resultado.sellosActuales,
      sellosCliente: resultado.sellosActuales,
      sellosTarjetaSucursal: resultado.sellosTarjetaSucursal,
      premioDesbloqueado: resultado.premioDesbloqueado,
      // Lo que OTORGO esta visita + el saldo de puntos: la PWA Cliente los muestra en la
      // confirmacion (con HIBRIDO son dos incrementos, no uno).
      sellosOtorgados: resultado.sellos,
      puntosOtorgados: resultado.puntos,
      puntosActuales: resultado.puntosActuales,
      modoFidelizacion: resultado.modoFidelizacion,
      premioPuntosDesbloqueado: resultado.premioPuntosDesbloqueado,
      aprobadoEn: new Date().toISOString(),
    });

    return {
      success: true,
      visitaId: resultado.visitaId,
      sucursalId,
      modoClientes: resultado.modoClientes,
      modoFidelizacion: resultado.modoFidelizacion,
      sellosOtorgados: resultado.sellos,
      puntosOtorgados: resultado.puntos,
      sellosActuales: resultado.sellosActuales,
      sellosCliente: resultado.sellosActuales,
      sellosTarjetaSucursal: resultado.sellosTarjetaSucursal,
      puntosActuales: resultado.puntosActuales,
      puntosTarjetaSucursal: resultado.puntosTarjetaSucursal,
      sellosParaPremio: resultado.sellosParaPremio,
      premioPorPuntos: resultado.premioPorPuntos,
      premioDesbloqueado: resultado.premioDesbloqueado,
      premioPuntosDesbloqueado: resultado.premioPuntosDesbloqueado,
      mostrarResena,
    };
  }

  /**
   * POST /visitas/canjear (staff).
   *
   * Canjea un premio YA desbloqueado y RESTA el saldo. Hasta ahora el premio era solo visual
   * (`premioDesbloqueado` en la tarjeta) y ningun saldo bajaba nunca.
   *
   * Cual saldo: con `modoClientes = POR_SUCURSAL` manda la tarjeta de la sucursal; con GLOBAL, el
   * contador del cliente. Igual que en la acreditacion, el cliente solo se toca con GLOBAL (con
   * POR_SUCURSAL su contador queda en 0 y restarlo lo mandaria a negativo).
   */
  async canjear(negocioId: string, dto: CanjearPremioDto, empleado: EmpleadoCtx) {
    const cfg = await this.fidelizacion.contexto(negocioId);

    const cliente = await this.prisma.cliente.findFirst({
      where: { id: dto.clienteId, negocioId, eliminadoEn: null },
      select: { id: true, nombre: true, sellosActuales: true, puntosActuales: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const sucursalId = dto.sucursalId ?? empleado.sucursalId;
    await this.exigirAccesoSucursal(empleado.id, sucursalId);

    const tarjeta = await this.prisma.tarjetaClienteSucursal.findUnique({
      where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId } },
      select: { sellosActuales: true, puntosActuales: true },
    });

    const esSellos = dto.tipo === 'SELLOS';
    const saldo = esSellos
      ? (cfg.porSucursal ? (tarjeta?.sellosActuales ?? 0) : cliente.sellosActuales)
      : (cfg.porSucursal ? (tarjeta?.puntosActuales ?? 0) : cliente.puntosActuales);
    const costo = esSellos ? cfg.sellosParaPremio : cfg.premioPorPuntos;

    if (saldo < costo) {
      throw new BadRequestException(
        `Saldo insuficiente: tiene ${saldo} ${esSellos ? 'sellos' : 'puntos'} y el premio cuesta ${costo}`,
      );
    }

    const ahora = new Date();
    // El descuento va en UN solo lado: el que tiene la verdad del saldo. Con POR_SUCURSAL es la
    // tarjeta de esa sucursal; con GLOBAL, el contador del cliente.
    //
    // Descontar en los DOS (lo que hacia antes) mandaba la tarjeta a NEGATIVO en cuanto el cliente
    // habia acumulado en mas de una sucursal: la tarjeta es un contador POR SUCURSAL, no un espejo
    // del saldo global. Lo cazo la verificacion en el navegador (tarjeta en -66 sobre un cliente con
    // 24 puntos).
    const actualizado = await this.prisma.$transaction(async (tx) => {
      if (cfg.porSucursal) {
        await tx.tarjetaClienteSucursal.updateMany({
          where: { clienteId: cliente.id, sucursalId },
          data: esSellos
            ? { sellosActuales: { decrement: costo } }
            : { puntosActuales: { decrement: costo } },
        });
      }
      return tx.cliente.update({
        where: { id: cliente.id },
        data: {
          ...(cfg.porSucursal
            ? {}
            : esSellos
              ? { sellosActuales: { decrement: costo } }
              : { puntosActuales: { decrement: costo } }),
          premiosCanjeados: { increment: 1 },
          ultimoCanjeEn: ahora,
        },
        select: { sellosActuales: true, puntosActuales: true, premiosCanjeados: true, ultimoCanjeEn: true },
      });
    });

    await this.auditoria.registrar({
      negocioId, accion: 'premio.canjeado', empleadoId: empleado.id, clienteId: cliente.id,
      detalle: { tipo: dto.tipo, costo, saldoAntes: saldo, sucursalId },
      ip: empleado.ip,
    });

    // Lo que quedo disponible despues del canje, con la misma regla de alcance.
    const tarjetaDespues = await this.prisma.tarjetaClienteSucursal.findUnique({
      where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId } },
      select: { sellosActuales: true, puntosActuales: true },
    });
    const sellosEfectivos = cfg.porSucursal
      ? (tarjetaDespues?.sellosActuales ?? 0)
      : actualizado.sellosActuales;
    const puntosEfectivos = cfg.porSucursal
      ? (tarjetaDespues?.puntosActuales ?? 0)
      : actualizado.puntosActuales;

    return {
      success: true,
      tipo: dto.tipo,
      costo,
      premioTexto: esSellos ? cfg.premioTexto : cfg.premioTextoPuntos,
      sellosActuales: sellosEfectivos,
      puntosActuales: puntosEfectivos,
      premiosCanjeados: actualizado.premiosCanjeados,
      ultimoCanjeEn: actualizado.ultimoCanjeEn,
      premioDesbloqueado: sellosEfectivos >= cfg.sellosParaPremio,
      premioPuntosDesbloqueado: puntosEfectivos >= cfg.premioPorPuntos,
    };
  }

  /** POST /visitas/rechazar/:token (staff). */
  async rechazar(negocioId: string, token: string, empleado: EmpleadoCtx, dto: RechazarVisitaDto) {
    const fila = await this.cargarToken(negocioId, token);
    await this.exigirAccesoSucursal(empleado.id, fila.sucursalId);

    if (fila.usado) throw new BadRequestException('Este token ya fue usado');

    await this.prisma.tokenValidacion.update({ where: { id: fila.id }, data: { usado: true } });

    // Para que la PWA pueda distinguir "rechazada" de "aprobada" al consultar
    // el estado del token (la tabla no lo distingue).
    await this.redis
      .set(
        CLAVE_RECHAZO(token),
        JSON.stringify({ motivo: dto.motivo ?? 'Rechazada por el local', rechazadoEn: new Date().toISOString() }),
        Math.ceil(TTL_TOKEN_MS / 1000) * 6,
      )
      .catch(() => undefined);

    await this.auditoria.registrar({
      negocioId, accion: 'visita.rechazada', empleadoId: empleado.id, clienteId: fila.clienteId,
      detalle: { motivo: dto.motivo ?? null, sucursalId: fila.sucursalId }, ip: empleado.ip,
    });

    this.gateway.emitirRechazada(fila.clienteId, {
      motivo: dto.motivo ?? 'Rechazada por el local',
      sucursalId: fila.sucursalId,
      rechazadoEn: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * GET /visitas/pendientes (staff): la cola de solicitudes VIVAS.
   *
   * Es la fuente de verdad de la lista del staff; el WS `visita:solicitada` solo
   * adelanta el aviso. Existe porque `mis-aprobaciones` NO es esto: aquel devuelve
   * lo que el empleado YA aprobo hoy.
   *
   * OJO con el schema: el campo es `usado: Boolean` (no hay `usadoEn`).
   *
   * Alcance:
   * - con `accesoMultiSucursal` ve las de todo el negocio;
   * - si no, SOLO las de su sucursal;
   * - las legacy (sucursalId null) quedan afuera en los dos casos: no se sabe de
   *   que sucursal son, asi que no se pueden atender desde ninguna.
   * Mismo criterio que `exigirAccesoSucursal`, para que la lista no muestre algo
   * que despues la aprobacion va a rechazar con 403.
   */
  async pendientes(negocioId: string, empleadoId: string) {
    const emp = await this.prisma.empleado.findFirst({
      where: { id: empleadoId },
      select: { sucursalId: true, accesoMultiSucursal: true },
    });
    if (!emp) throw new ForbiddenException('Empleado no valido');

    const where: Prisma.TokenValidacionWhereInput = {
      negocioId,
      usado: false,
      expiraEn: { gt: new Date() },
    };
    where.sucursalId = emp.accesoMultiSucursal
      ? { not: null }
      : (emp.sucursalId ?? '__sin_sucursal__');

    const filas = await this.prisma.tokenValidacion.findMany({
      where,
      orderBy: { creadoEn: 'asc' },
      take: 100,
      select: {
        token: true,
        expiraEn: true,
        creadoEn: true,
        cliente: { select: { id: true, nombre: true, telefono: true } },
        sucursal: { select: { id: true, nombre: true, slug: true } },
      },
    });

    // `segundosRestantes` se calcula en el backend: si lo calculara cada cliente,
    // dos dispositivos con relojes distintos mostrarian vencimientos distintos.
    const ahora = Date.now();
    return {
      data: filas.map((f) => ({
        token: f.token,
        expiraEn: f.expiraEn,
        segundosRestantes: Math.max(0, Math.round((f.expiraEn.getTime() - ahora) / 1000)),
        cliente: {
          id: f.cliente.id,
          nombre: f.cliente.nombre,
          telefonoEnmascarado: enmascararTelefono(f.cliente.telefono),
        },
        sucursal: f.sucursal,
      })),
      total: filas.length,
    };
  }

  /** GET /visitas/historial (dueño/encargado). */
  async historial(negocioId: string, filtros: HistorialVisitasDto) {
    const { page, pageSize, skip, take } = getPagination(filtros);
    const where: Prisma.VisitaWhereInput = { negocioId };
    if (filtros.sucursalId) where.sucursalId = filtros.sucursalId;
    if (filtros.clienteId) where.clienteId = filtros.clienteId;
    if (filtros.empleadoId) where.empleadoId = filtros.empleadoId;
    if (filtros.tipo) where.tipo = filtros.tipo;
    if (filtros.metodo) where.metodo = filtros.metodo;
    if (filtros.desde || filtros.hasta) {
      where.aprobadoEn = {
        ...(filtros.desde ? { gte: new Date(filtros.desde) } : {}),
        ...(filtros.hasta ? { lte: new Date(filtros.hasta) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.visita.findMany({
        where, orderBy: { aprobadoEn: 'desc' }, skip, take,
        include: {
          cliente: { select: { id: true, nombre: true } },
          empleado: { select: { id: true, nombre: true, rol: true } },
          sucursal: { select: { id: true, nombre: true, slug: true } },
        },
      }),
      this.prisma.visita.count({ where }),
    ]);
    return paginar(data, total, page, pageSize);
  }

  /** GET /visitas/mis-aprobaciones (staff): las que aprobo hoy. */
  async misAprobaciones(negocioId: string, empleadoId: string) {
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    const where: Prisma.VisitaWhereInput = { negocioId, empleadoId, aprobadoEn: { gte: desde } };

    const [data, total] = await Promise.all([
      this.prisma.visita.findMany({
        where, orderBy: { aprobadoEn: 'desc' }, take: 100,
        include: {
          cliente: { select: { id: true, nombre: true } },
          sucursal: { select: { id: true, nombre: true, slug: true } },
        },
      }),
      this.prisma.visita.count({ where }),
    ]);
    return { data, total, desde };
  }

  // ---------------------------------------------------------------------------
  // PWA Cliente: estado del token, tarjeta e historial (JWT de cliente)
  // ---------------------------------------------------------------------------

  /**
   * Sellos efectivos segun el modo del negocio. Con POR_SUCURSAL manda la
   * TARJETA de esa sucursal; con GLOBAL, el contador del cliente.
   */
  private async sellosEfectivos(negocioId: string, clienteId: string, sucursalId: string) {
    const [negocio, config, cliente, tarjeta] = await Promise.all([
      this.prisma.negocio.findUnique({ where: { id: negocioId }, select: { modoClientes: true } }),
      this.prisma.configuracionClub.findUnique({
        where: { negocioId },
        select: {
          sellosParaPremio: true, premioTexto: true, mostrarResenaPostVisita: true,
          // Programa por puntos: el cliente necesita el modo y el premio para dibujar la 2da barra.
          modoFidelizacion: true, premioPorPuntos: true, premioTextoPuntos: true,
        },
      }),
      this.prisma.cliente.findFirst({
        where: { id: clienteId, eliminadoEn: null },
        select: { sellosActuales: true, puntosActuales: true, totalVisitas: true },
      }),
      this.prisma.tarjetaClienteSucursal.findUnique({
        where: { clienteId_sucursalId: { clienteId, sucursalId } },
        select: { sellosActuales: true, puntosActuales: true, totalVisitas: true },
      }),
    ]);

    const porSucursal = negocio?.modoClientes === 'POR_SUCURSAL';
    const sellos = porSucursal ? (tarjeta?.sellosActuales ?? 0) : (cliente?.sellosActuales ?? 0);
    const sellosParaPremio = config?.sellosParaPremio ?? 10;
    const progreso = this.segmentos.progreso(sellos, sellosParaPremio);

    return {
      sucursalId,
      modoClientes: porSucursal ? 'POR_SUCURSAL' : 'GLOBAL',
      sellosActuales: sellos,
      sellosParaPremio,
      premioTexto: config?.premioTexto ?? '',
      premioDesbloqueado: progreso.completado,
      faltantes: progreso.faltantes,
      porcentaje: progreso.porcentaje,
      mostrarResena: config?.mostrarResenaPostVisita ?? false,
      sellosCliente: cliente?.sellosActuales ?? 0,
      sellosTarjetaSucursal: tarjeta?.sellosActuales ?? 0,
      puntosActuales: porSucursal ? (tarjeta?.puntosActuales ?? 0) : (cliente?.puntosActuales ?? 0),
      totalVisitas: porSucursal ? (tarjeta?.totalVisitas ?? 0) : (cliente?.totalVisitas ?? 0),
      // El modo y el premio por puntos: con HIBRIDO la PWA Cliente dibuja DOS barras.
      modoFidelizacion: config?.modoFidelizacion ?? 'SOLO_VISITAS',
      premioPorPuntos: config?.premioPorPuntos ?? 100,
      premioTextoPuntos: config?.premioTextoPuntos ?? 'Postre gratis',
    };
  }

  /**
   * GET /visitas/estado/:token (cliente). Respaldo del WebSocket: la PWA lo
   * consulta cada 5s si el socket no conecta.
   */
  async estadoParaCliente(negocioId: string, clienteId: string, token: string) {
    const fila = await this.prisma.tokenValidacion.findFirst({
      where: { negocioId, token },
      select: { id: true, clienteId: true, sucursalId: true, usado: true, expiraEn: true },
    });

    // Un token de OTRO cliente responde 404 igual que uno inexistente: no hay
    // que revelar que existe.
    if (!fila || fila.clienteId !== clienteId) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    const sucursalId =
      fila.sucursalId ??
      ((await this.resolver.resolverSucursal(negocioId, { clienteId })).id as string);
    const base = await this.sellosEfectivos(negocioId, clienteId, sucursalId);

    if (fila.usado) {
      const rechazo = await this.redis.get(CLAVE_RECHAZO(token)).catch(() => null);
      if (rechazo) {
        let motivo = 'Rechazada por el local';
        try {
          motivo = (JSON.parse(rechazo) as { motivo?: string }).motivo ?? motivo;
        } catch {
          // si el valor no es JSON se usa el motivo por defecto
        }
        return { estado: 'RECHAZADA', motivo, ...base };
      }
      return { estado: 'APROBADA', ...base };
    }

    if (fila.expiraEn < new Date()) return { estado: 'EXPIRADA', ...base };
    return { estado: 'PENDIENTE', expiraEn: fila.expiraEn, ...base };
  }

  /** GET /visitas/mi-tarjeta (cliente). */
  async miTarjeta(negocioId: string, clienteId: string, sucursalSlug?: string) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, negocioId, eliminadoEn: null },
      select: {
        id: true, nombre: true, telefono: true, etiqueta: true,
        sellosActuales: true, puntosActuales: true, totalVisitas: true, ultimaVisita: true,
      },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const sucursal = await this.resolver.resolverSucursal(negocioId, { sucursalSlug, clienteId });
    const base = await this.sellosEfectivos(negocioId, clienteId, sucursal.id as string);

    // Con POR_SUCURSAL la PWA muestra una tarjeta por sucursal.
    const tarjetas = await this.prisma.tarjetaClienteSucursal.findMany({
      where: { clienteId },
      select: {
        sucursalId: true, sellosActuales: true, puntosActuales: true,
        totalVisitas: true, premiosCanjeados: true, ultimaVisita: true,
      },
    });

    return {
      cliente,
      sucursal: {
        id: sucursal.id, nombre: sucursal.nombre, slug: sucursal.slug,
        esPrincipal: sucursal.esPrincipal ?? false,
      },
      tarjetas,
      ...base,
    };
  }

  /** GET /visitas/mi-historial (cliente): sus propias visitas. */
  async miHistorial(
    negocioId: string,
    clienteId: string,
    opts: { page?: number | string; pageSize?: number | string; sucursalSlug?: string } = {},
  ) {
    const { page, pageSize, skip, take } = getPagination(opts);

    const where: Prisma.VisitaWhereInput = { negocioId, clienteId };
    if (opts.sucursalSlug) {
      const s = await this.resolver.resolverSucursal(negocioId, {
        sucursalSlug: opts.sucursalSlug,
        clienteId,
      });
      where.sucursalId = s.id as string;
    }

    const [data, total] = await Promise.all([
      this.prisma.visita.findMany({
        where, orderBy: { aprobadoEn: 'desc' }, skip, take,
        select: {
          id: true, tipo: true, metodo: true, sellosOtorgados: true, puntosOtorgados: true,
          aprobadoEn: true, origen: true, notas: true,
          sucursal: { select: { id: true, nombre: true, slug: true } },
          empleado: { select: { id: true, nombre: true, rol: true } },
        },
      }),
      this.prisma.visita.count({ where }),
    ]);
    return paginar(data, total, page, pageSize);
  }

  private async cargarToken(negocioId: string, token: string) {
    const fila = await this.prisma.tokenValidacion.findFirst({
      where: { negocioId, token },
      include: {
        cliente: {
          select: {
            id: true, nombre: true, telefono: true, sellosActuales: true, puntosActuales: true,
            totalVisitas: true, etiqueta: true, ultimaVisita: true,
          },
        },
        sucursal: { select: { id: true, nombre: true, slug: true, esPrincipal: true } },
      },
    });
    if (!fila) throw new NotFoundException('Token de visita no encontrado');
    return fila;
  }
}
