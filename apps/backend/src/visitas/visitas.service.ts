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
import type { SolicitarVisitaDto } from './dto/solicitar-visita.dto';
import type { AprobarVisitaDto } from './dto/aprobar-visita.dto';
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
      select: { sellosParaPremio: true, sellosBienvenida: true, mostrarResenaPostVisita: true },
    });
    const sellosParaPremio = config?.sellosParaPremio ?? 10;
    // Estaba HARDCODEADO en true: el dueño apaga las resenas y la PWA igual las
    // mostraba. Ahora manda la configuracion del club.
    const mostrarResena = config?.mostrarResenaPostVisita ?? false;

    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId }, select: { modoClientes: true },
    });
    const porSucursal = negocio?.modoClientes === 'POR_SUCURSAL';

    const sellosOtorgados = 1;

    const resultado = await this.prisma.$transaction(async (tx) => {
      const marcado = await tx.tokenValidacion.updateMany({
        where: { id: fila.id, usado: false }, data: { usado: true },
      });
      if (marcado.count === 0) throw new BadRequestException('Este token ya fue usado');

      const visita = await tx.visita.create({
        data: {
          negocioId, sucursalId, clienteId: fila.clienteId, empleadoId: empleado.id,
          tipo: TipoVisita.VISITA,
          sellosOtorgados,
          puntosOtorgados: 0,
          montoConsumido: dto.montoConsumido !== undefined ? new Prisma.Decimal(dto.montoConsumido) : null,
          metodo: 'QR_DINAMICO',
          origen: dto.origen ?? null,
          notas: dto.notas ?? null,
        },
      });

      // Cliente: los AGREGADOS globales (totalVisitas, ultimaVisita, etiqueta) se
      // actualizan siempre. Los SELLOS solo con modoClientes = GLOBAL: con
      // POR_SUCURSAL el saldo vive en la tarjeta de cada sucursal.
      const actualizado = await tx.cliente.update({
        where: { id: fila.clienteId },
        data: {
          ...(porSucursal ? {} : { sellosActuales: { increment: sellosOtorgados } }),
          totalVisitas: { increment: 1 },
          ultimaVisita: new Date(),
          etiqueta: this.segmentos.calcularEtiqueta(fila.cliente.totalVisitas + 1, new Date()),
        },
        select: { id: true, sellosActuales: true, puntosActuales: true, totalVisitas: true, etiqueta: true, ultimaVisita: true },
      });

      // Tarjeta de la sucursal: se actualiza SIEMPRE (con GLOBAL ademas de los
      // sellos del cliente). Antes se actualizaba solo con POR_SUCURSAL, asi que
      // con GLOBAL la tarjeta quedaba en 0 para siempre.
      const tarjeta = await tx.tarjetaClienteSucursal.upsert({
        where: { clienteId_sucursalId: { clienteId: fila.clienteId, sucursalId } },
        update: {
          sellosActuales: { increment: sellosOtorgados },
          totalVisitas: { increment: 1 },
          ultimaVisita: new Date(),
        },
        create: {
          clienteId: fila.clienteId, sucursalId,
          sellosActuales: sellosOtorgados, totalVisitas: 1, ultimaVisita: new Date(),
        },
        select: { sellosActuales: true },
      });

      return { visita, actualizado, tarjeta };
    });

    await this.auditoria.registrar({
      negocioId, accion: 'visita.aprobada', empleadoId: empleado.id, clienteId: fila.clienteId,
      detalle: { visitaId: resultado.visita.id, sucursalId, origen: dto.origen ?? null },
      ip: empleado.ip,
    });

    // El saldo con el que se mide el premio depende del modo: con POR_SUCURSAL es
    // el de la TARJETA de esa sucursal, con GLOBAL el del cliente.
    const sellosEfectivos = porSucursal
      ? resultado.tarjeta.sellosActuales
      : resultado.actualizado.sellosActuales;
    const progreso = this.segmentos.progreso(sellosEfectivos, sellosParaPremio);

    this.gateway.emitirAprobada(fila.clienteId, {
      visitaId: resultado.visita.id,
      sucursalId,
      sellosActuales: sellosEfectivos,
      sellosCliente: resultado.actualizado.sellosActuales,
      sellosTarjetaSucursal: resultado.tarjeta.sellosActuales,
      premioDesbloqueado: progreso.completado,
      aprobadoEn: resultado.visita.aprobadoEn.toISOString(),
    });

    return {
      success: true,
      visitaId: resultado.visita.id,
      sucursalId,
      modoClientes: porSucursal ? 'POR_SUCURSAL' : 'GLOBAL',
      sellosActuales: sellosEfectivos,
      sellosCliente: resultado.actualizado.sellosActuales,
      sellosTarjetaSucursal: resultado.tarjeta.sellosActuales,
      premioDesbloqueado: progreso.completado,
      mostrarResena,
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
        select: { sellosParaPremio: true, premioTexto: true, mostrarResenaPostVisita: true },
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
