
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TipoModificador } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import type { CrearGrupoDto, CrearOpcionDto } from './dto/crear-grupo.dto';
import type { ActualizarGrupoDto } from './dto/actualizar-grupo.dto';
import type { CrearOpcionSueltaDto } from './dto/crear-opcion.dto';
import type { ActualizarOpcionSueltaDto } from './dto/actualizar-opcion.dto';
import type { ReordenarGruposDto, ReordenarOpcionesDto } from './dto/reordenar-grupos.dto';
import type { GrupoResuelto } from './interfaces/modificador-resuelto.interface';

export const CACHE_GRUPOS = (negocioId: string) => `modificadores:grupos:${negocioId}`;
export const TTL_GRUPOS = 600; // 10 min

export interface CtxMod {
  empleadoId: string;
  ip?: string;
}

const SELECT_GRUPO = {
  id: true, nombre: true, descripcion: true, tipo: true, obligatorio: true,
  minSelecciones: true, maxSelecciones: true, orden: true,
  opciones: {
    orderBy: { orden: 'asc' },
    select: { id: true, nombre: true, precioExtra: true, disponible: true, orden: true },
  },
} as const;

@Injectable()
export class ModificadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ---------------------------------------------------------------- cache ----

  async invalidarCache(negocioId: string) {
    await this.redis.del(CACHE_GRUPOS(negocioId)).catch(() => undefined);
  }

  /**
   * Grupos + opciones del negocio, cacheados 10 min.
   * Se invalidan en cada CUD (incluida la asignacion bulk: ver asignacion.service).
   */
  async listarGrupos(negocioId: string): Promise<GrupoResuelto[]> {
    const clave = CACHE_GRUPOS(negocioId);
    const cacheado = await this.redis.get(clave).catch(() => null);
    if (cacheado) return JSON.parse(cacheado) as GrupoResuelto[];

    const grupos = await this.prisma.grupoModificador.findMany({
      where: { negocioId },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      select: SELECT_GRUPO,
    });

    const serializados = grupos.map((g) => this.serializar(g));
    await this.redis.set(clave, JSON.stringify(serializados), TTL_GRUPOS).catch(() => undefined);
    return serializados;
  }

  private serializar(g: Record<string, any>): GrupoResuelto {
    return {
      id: g.id, nombre: g.nombre, descripcion: g.descripcion, tipo: g.tipo,
      obligatorio: g.obligatorio, minSelecciones: g.minSelecciones,
      maxSelecciones: g.maxSelecciones, orden: g.orden,
      opciones: (g.opciones ?? []).map((o: Record<string, any>) => ({
        id: o.id, nombre: o.nombre, precioExtra: Number(o.precioExtra),
        disponible: o.disponible, orden: o.orden,
      })),
    };
  }

  // ----------------------------------------------------------- validacion ----

  /**
   * Validaciones que NO van en el DTO porque dependen del tipo y del conteo
   * de opciones (refinamiento 1).
   */
  private validarCoherencia(
    tipo: TipoModificador, obligatorio: boolean,
    minSelecciones: number, maxSelecciones: number | null | undefined,
    cantidadOpciones: number,
  ) {
    if (tipo === TipoModificador.UNICA_SELECCION) {
      if (minSelecciones > 1) {
        throw new BadRequestException('Con UNICA_SELECCION, minSelecciones no puede ser mayor a 1');
      }
      if (maxSelecciones !== null && maxSelecciones !== undefined && maxSelecciones > 1) {
        throw new BadRequestException('Con UNICA_SELECCION, maxSelecciones no puede ser mayor a 1');
      }
    }
    if (tipo === TipoModificador.MULTIPLE_SELECCION && obligatorio && minSelecciones < 1) {
      throw new BadRequestException(
        'Un grupo MULTIPLE_SELECCION obligatorio necesita minSelecciones >= 1',
      );
    }
    if (maxSelecciones !== null && maxSelecciones !== undefined) {
      if (maxSelecciones < minSelecciones) {
        throw new BadRequestException('maxSelecciones no puede ser menor que minSelecciones');
      }
      if (maxSelecciones > cantidadOpciones) {
        throw new BadRequestException(
          `maxSelecciones (${maxSelecciones}) no puede superar la cantidad de opciones (${cantidadOpciones})`,
        );
      }
    }
  }

  // ---------------------------------------------------------------- CRUD ----

  async obtenerGrupo(negocioId: string, id: string) {
    const g = await this.prisma.grupoModificador.findFirst({
      where: { id, negocioId }, select: SELECT_GRUPO,
    });
    if (!g) throw new NotFoundException('Grupo de modificadores no encontrado');
    // Incluye en que items esta asignado (util para el admin)
    const items = await this.prisma.itemCarta.findMany({
      where: { negocioId, gruposModificadores: { some: { id } } },
      select: { id: true, nombre: true, categoria: true },
    });
    return { ...this.serializar(g), asignadoAItems: items };
  }

  /** Refinamiento 1: grupo + opciones en UNA transaccion. */
  async crearGrupo(negocioId: string, dto: CrearGrupoDto, ctx: CtxMod) {
    const tipo = dto.tipo;
    const obligatorio = dto.obligatorio ?? false;
    const min = dto.minSelecciones ?? 0;
    const max = dto.maxSelecciones ?? null;
    this.validarCoherencia(tipo, obligatorio, min, max, dto.opciones.length);

    const grupo = await this.prisma.$transaction(async (tx) => {
      const created = await tx.grupoModificador.create({
        data: {
          negocioId, nombre: dto.nombre, descripcion: dto.descripcion ?? null,
          tipo, obligatorio, minSelecciones: min, maxSelecciones: max,
          orden: dto.orden ?? 0,
          opciones: { create: dto.opciones.map((o, i) => this.datosOpcion(o, i)) },
        },
        select: SELECT_GRUPO,
      });
      return created;
    });

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.grupo_creado', empleadoId: ctx.empleadoId,
      detalle: { grupoId: grupo.id, nombre: grupo.nombre, opciones: grupo.opciones.length },
      ip: ctx.ip,
    });
    return this.serializar(grupo);
  }

  private datosOpcion(o: CrearOpcionDto, i: number) {
    return {
      nombre: o.nombre,
      precioExtra: new Prisma.Decimal(o.precioExtra ?? 0),
      disponible: o.disponible ?? true,
      orden: o.orden ?? i,
    };
  }

  async actualizarGrupo(negocioId: string, id: string, dto: ActualizarGrupoDto, ctx: CtxMod) {
    const actual = await this.prisma.grupoModificador.findFirst({
      where: { id, negocioId },
      select: { id: true, tipo: true, obligatorio: true, minSelecciones: true, maxSelecciones: true, _count: { select: { opciones: true } } },
    });
    if (!actual) throw new NotFoundException('Grupo de modificadores no encontrado');

    const tipo = dto.tipo ?? actual.tipo;
    const obligatorio = dto.obligatorio ?? actual.obligatorio;
    const min = dto.minSelecciones ?? actual.minSelecciones;
    const max = dto.maxSelecciones !== undefined ? dto.maxSelecciones : actual.maxSelecciones;
    const cantidadOpciones = dto.opciones?.length ?? actual._count.opciones;
    this.validarCoherencia(tipo, obligatorio, min, max, cantidadOpciones);

    const grupo = await this.prisma.$transaction(async (tx) => {
      // Si vienen opciones, se REEMPLAZA el set: se borran las que ya no estan
      // y se actualizan/crean las demas.
      if (dto.opciones) {
        const idsEnviados = dto.opciones.map((o) => o.id).filter((v): v is string => !!v);
        // Las opciones que vienen CON id tienen que ser de ESTE grupo. Sin este chequeo el
        // grupo se validaba contra `negocioId` pero la opcion no: un id de otro grupo (o de
        // otro NEGOCIO) se actualizaba igual — IDOR cross-tenant de escritura.
        // Mismo patron que `eliminarOpcion` y `reordenarOpciones`.
        if (idsEnviados.length) {
          const propias = await tx.opcionModificador.count({
            where: { id: { in: idsEnviados }, grupoModificadorId: id },
          });
          if (propias !== idsEnviados.length) {
            throw new NotFoundException('Alguna opcion no pertenece a ese grupo');
          }
        }
        const previas = await tx.opcionModificador.findMany({
          where: { grupoModificadorId: id }, select: { id: true },
        });
        const aBorrar = previas.map((p) => p.id).filter((pid) => !idsEnviados.includes(pid));
        if (aBorrar.length) {
          await tx.opcionModificador.deleteMany({ where: { id: { in: aBorrar } } });
        }
        for (const [i, o] of dto.opciones.entries()) {
          const datos = {
            nombre: o.nombre,
            precioExtra: new Prisma.Decimal(o.precioExtra ?? 0),
            disponible: o.disponible ?? true,
            orden: o.orden ?? i,
          };
          if (o.id) await tx.opcionModificador.update({ where: { id: o.id }, data: datos });
          else await tx.opcionModificador.create({ data: { grupoModificadorId: id, ...datos } });
        }
      }

      return tx.grupoModificador.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
          ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion } : {}),
          ...(dto.tipo !== undefined ? { tipo: dto.tipo } : {}),
          ...(dto.obligatorio !== undefined ? { obligatorio: dto.obligatorio } : {}),
          ...(dto.minSelecciones !== undefined ? { minSelecciones: dto.minSelecciones } : {}),
          ...(dto.maxSelecciones !== undefined ? { maxSelecciones: dto.maxSelecciones } : {}),
          ...(dto.orden !== undefined ? { orden: dto.orden } : {}),
        },
        select: SELECT_GRUPO,
      });
    });

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.grupo_actualizado', empleadoId: ctx.empleadoId,
      detalle: { grupoId: id, campos: Object.keys(dto) }, ip: ctx.ip,
    });
    return this.serializar(grupo);
  }

  /**
   * Elimina un grupo. Si esta asignado a algun item hace falta `force=true`
   * (refinamiento aprobado: se exige SIEMPRE que este asignado, no solo si es
   * obligatorio). Con force se desasigna y se borra en una transaccion.
   */
  async eliminarGrupo(negocioId: string, id: string, force: boolean, ctx: CtxMod) {
    const grupo = await this.prisma.grupoModificador.findFirst({
      where: { id, negocioId },
      select: {
        id: true, nombre: true,
        itemsCarta: { select: { id: true, nombre: true } },
      },
    });
    if (!grupo) throw new NotFoundException('Grupo de modificadores no encontrado');

    const asignados = grupo.itemsCarta.length;
    if (asignados > 0 && !force) {
      throw new ConflictException(
        `El grupo "${grupo.nombre}" esta asignado a ${asignados} item(s). ` +
        `Repeti la operacion con ?force=true para desasignarlo y eliminarlo.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (asignados > 0) {
        // updateMany NO soporta operaciones de relacion (disconnect): hay que
        // hacer un update por item dentro de la transaccion.
        for (const it of grupo.itemsCarta) {
          await tx.itemCarta.update({
            where: { id: it.id },
            data: { gruposModificadores: { disconnect: { id } } },
          });
        }
      }
      await tx.grupoModificador.delete({ where: { id } });
    });

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.grupo_eliminado', empleadoId: ctx.empleadoId,
      detalle: { grupoId: id, nombre: grupo.nombre, itemsDesasignados: asignados, force },
      ip: ctx.ip,
    });
    return { ok: true, eliminado: id, itemsDesasignados: asignados };
  }

  async duplicarGrupo(negocioId: string, id: string, ctx: CtxMod) {
    const original = await this.prisma.grupoModificador.findFirst({
      where: { id, negocioId }, select: SELECT_GRUPO,
    });
    if (!original) throw new NotFoundException('Grupo de modificadores no encontrado');

    const copia = await this.prisma.grupoModificador.create({
      data: {
        negocioId,
        nombre: `${original.nombre} (copia)`.slice(0, 100),
        descripcion: original.descripcion,
        tipo: original.tipo, obligatorio: original.obligatorio,
        minSelecciones: original.minSelecciones, maxSelecciones: original.maxSelecciones,
        orden: original.orden + 1,
        opciones: {
          create: original.opciones.map((o) => ({
            nombre: o.nombre, precioExtra: o.precioExtra,
            disponible: o.disponible, orden: o.orden,
          })),
        },
      },
      select: SELECT_GRUPO,
    });

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.grupo_duplicado', empleadoId: ctx.empleadoId,
      detalle: { origen: id, copia: copia.id }, ip: ctx.ip,
    });
    return this.serializar(copia);
  }

  async reordenarGrupos(negocioId: string, dto: ReordenarGruposDto, ctx: CtxMod) {
    const ids = dto.items.map((i) => i.id);
    const propios = await this.prisma.grupoModificador.count({ where: { negocioId, id: { in: ids } } });
    if (propios !== ids.length) throw new NotFoundException('Algun grupo no pertenece a este negocio');

    await this.prisma.$transaction(
      dto.items.map((i) => this.prisma.grupoModificador.update({ where: { id: i.id }, data: { orden: i.orden } })),
    );
    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.grupos_reordenados', empleadoId: ctx.empleadoId,
      detalle: { items: dto.items.length }, ip: ctx.ip,
    });
    return { ok: true, actualizados: dto.items.length };
  }

  // ------------------------------------------------------------- opciones ----

  async crearOpcion(negocioId: string, grupoId: string, dto: CrearOpcionSueltaDto, ctx: CtxMod) {
    const grupo = await this.obtenerGrupoSimple(negocioId, grupoId);
    const total = await this.prisma.opcionModificador.count({ where: { grupoModificadorId: grupoId } });
    // Crear una opcion puede invalidar maxSelecciones si el grupo lo tenia igual al total
    if (grupo.maxSelecciones !== null && grupo.maxSelecciones > total + 1) {
      throw new BadRequestException(
        `maxSelecciones (${grupo.maxSelecciones}) superaria la cantidad de opciones (${total + 1})`,
      );
    }

    const opcion = await this.prisma.opcionModificador.create({
      data: {
        grupoModificadorId: grupoId, nombre: dto.nombre,
        precioExtra: new Prisma.Decimal(dto.precioExtra ?? 0),
        disponible: dto.disponible ?? true, orden: dto.orden ?? total,
      },
      select: { id: true, nombre: true, precioExtra: true, disponible: true, orden: true },
    });

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.opcion_creada', empleadoId: ctx.empleadoId,
      detalle: { grupoId, opcionId: opcion.id }, ip: ctx.ip,
    });
    return { ...opcion, precioExtra: Number(opcion.precioExtra) };
  }

  private async obtenerGrupoSimple(negocioId: string, grupoId: string) {
    const g = await this.prisma.grupoModificador.findFirst({
      where: { id: grupoId, negocioId },
      select: { id: true, tipo: true, obligatorio: true, minSelecciones: true, maxSelecciones: true },
    });
    if (!g) throw new NotFoundException('Grupo de modificadores no encontrado');
    return g;
  }

  async actualizarOpcion(
    negocioId: string, grupoId: string, opcionId: string,
    dto: ActualizarOpcionSueltaDto, ctx: CtxMod,
  ) {
    await this.obtenerGrupoSimple(negocioId, grupoId);
    const existe = await this.prisma.opcionModificador.findFirst({
      where: { id: opcionId, grupoModificadorId: grupoId }, select: { id: true },
    });
    if (!existe) throw new NotFoundException('Opcion no encontrada en ese grupo');

    const opcion = await this.prisma.opcionModificador.update({
      where: { id: opcionId },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.precioExtra !== undefined ? { precioExtra: new Prisma.Decimal(dto.precioExtra) } : {}),
        ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
        ...(dto.orden !== undefined ? { orden: dto.orden } : {}),
      },
      select: { id: true, nombre: true, precioExtra: true, disponible: true, orden: true },
    });

    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.opcion_actualizada', empleadoId: ctx.empleadoId,
      detalle: { grupoId, opcionId }, ip: ctx.ip,
    });
    return { ...opcion, precioExtra: Number(opcion.precioExtra) };
  }

  async eliminarOpcion(negocioId: string, grupoId: string, opcionId: string, ctx: CtxMod) {
    const grupo = await this.obtenerGrupoSimple(negocioId, grupoId);
    const total = await this.prisma.opcionModificador.count({ where: { grupoModificadorId: grupoId } });
    if (total <= 1) {
      throw new BadRequestException('No se puede eliminar la unica opcion del grupo');
    }
    const existe = await this.prisma.opcionModificador.findFirst({
      where: { id: opcionId, grupoModificadorId: grupoId }, select: { id: true },
    });
    if (!existe) throw new NotFoundException('Opcion no encontrada en ese grupo');

    // maxSelecciones podria quedar por encima del nuevo total
    if (grupo.maxSelecciones !== null && grupo.maxSelecciones > total - 1) {
      throw new BadRequestException(
        `No se puede eliminar: maxSelecciones (${grupo.maxSelecciones}) superaria las opciones restantes (${total - 1}). ` +
        'Ajusta maxSelecciones primero.',
      );
    }

    await this.prisma.opcionModificador.delete({ where: { id: opcionId } });
    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.opcion_eliminada', empleadoId: ctx.empleadoId,
      detalle: { grupoId, opcionId }, ip: ctx.ip,
    });
    return { ok: true, eliminada: opcionId };
  }

  async reordenarOpciones(negocioId: string, grupoId: string, dto: ReordenarOpcionesDto, ctx: CtxMod) {
    await this.obtenerGrupoSimple(negocioId, grupoId);
    const ids = dto.items.map((i) => i.id);
    const propias = await this.prisma.opcionModificador.count({
      where: { grupoModificadorId: grupoId, id: { in: ids } },
    });
    if (propias !== ids.length) throw new NotFoundException('Alguna opcion no pertenece a ese grupo');

    await this.prisma.$transaction(
      dto.items.map((i) => this.prisma.opcionModificador.update({ where: { id: i.id }, data: { orden: i.orden } })),
    );
    await this.invalidarCache(negocioId);
    await this.auditoria.registrar({
      negocioId, accion: 'modificador.opciones_reordenadas', empleadoId: ctx.empleadoId,
      detalle: { grupoId, items: dto.items.length }, ip: ctx.ip,
    });
    return { ok: true, actualizados: dto.items.length };
  }
}
