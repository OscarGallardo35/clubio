import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import type { CrearItemCartaDto } from '../carta/dto/crear-item-carta.dto';
import type { ActualizarItemCartaDto } from '../carta/dto/actualizar-item-carta.dto';
import type { ActualizarConfiguracionDto } from '../configuracion/dto/actualizar-configuracion.dto';
import type { CrearEmpleadoSuperAdminDto, ActualizarEmpleadoSuperAdminDto } from './dto/actualizar-empleado.dto';
import type { ActualizarThemeSuperAdminDto } from './dto/actualizar-theme.dto';

/**
 * Recursos de UN local vistos desde la PLATAFORMA: carta, empleados, configuracion del club
 * y theme/branding.
 *
 * Criterio (mismo riel que `./superadmin-locales.service.ts`): la escritura es la MISMA que la
 * del admin del dueno — mismos modelos, mismo soft-delete (`ItemCarta.disponible = false`,
 * `Empleado.eliminadoEn`), misma serializacion (`Decimal` -> number) y la MISMA regla de PIN
 * unico. Lo unico que NO se aplica es el gate de plan (`LimitesService`), porque el operador
 * configura locales demo que todavia no tienen plan comercial.
 *
 * La `configuracion` SI delega en `ConfiguracionService` (el servicio real del dueno): reusa su
 * DTO, su merge de overrides y la invalidacion de cache en Redis.
 */

const SELECT_EMPLEADO = {
  id: true, negocioId: true, sucursalId: true, nombre: true, rol: true,
  email: true, telefono: true, avatarUrl: true, activo: true,
  twoFactorEnabled: true, ultimoAcceso: true, creadoEn: true,
  pinHash: true, passwordHash: true,
  sucursal: { select: { id: true, nombre: true, slug: true } },
} as const;

/** El precio es Decimal(10,2) en la DB; la API lo expone como number (igual que CartaService). */
function serializarItem<T extends { precio?: unknown }>(item: T) {
  return { ...item, precio: item.precio !== undefined ? Number(item.precio) : undefined };
}

function agrupar<T extends { categoria: string }>(items: T[]) {
  const mapa = new Map<string, T[]>();
  for (const it of items) {
    const lista = mapa.get(it.categoria) ?? [];
    lista.push(it);
    mapa.set(it.categoria, lista);
  }
  return [...mapa.entries()].map(([categoria, items]) => ({ categoria, items }));
}

@Injectable()
export class SuperadminRecursosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  private async exigirNegocio(negocioId: string) {
    const negocio = await this.prisma.negocio.findFirst({
      where: { id: negocioId, eliminadoEn: null },
      select: { id: true, slug: true, nombre: true, theme: true },
    });
    if (!negocio) throw new NotFoundException('Local no encontrado');
    return negocio;
  }

  /** Sucursal donde se cuelgan los empleados nuevos: la principal. */
  private async sucursalPrincipal(negocioId: string) {
    const sucursal =
      (await this.prisma.sucursal.findFirst({
        where: { negocioId, esPrincipal: true }, select: { id: true },
      })) ??
      (await this.prisma.sucursal.findFirst({
        where: { negocioId }, select: { id: true }, orderBy: { creadoEn: 'asc' },
      }));
    if (!sucursal) throw new ConflictException('El local no tiene ninguna sucursal todavia');
    return sucursal;
  }

  // =========================================================================
  // CARTA
  // =========================================================================

  /** Grupos + items (incluye los NO disponibles: es el panel de administracion). */
  async listarCarta(negocioId: string) {
    await this.exigirNegocio(negocioId);
    const items = await this.prisma.itemCarta.findMany({
      where: { negocioId },
      orderBy: [{ categoria: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
    });
    const planos = items.map((it) => serializarItem(it));
    return { negocioId, total: planos.length, items: planos, categorias: agrupar(planos) };
  }

  async crearItemCarta(negocioId: string, dto: CrearItemCartaDto) {
    await this.exigirNegocio(negocioId);
    const item = await this.prisma.itemCarta.create({
      data: {
        negocioId,
        categoria: dto.categoria,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        precio: new Prisma.Decimal(dto.precio),
        fotoUrl: dto.fotoUrl ?? null,
        etiquetas: dto.etiquetas ?? [],
        disponible: dto.disponible ?? true,
        orden: dto.orden ?? 0,
      },
    });
    return serializarItem(item);
  }

  async actualizarItemCarta(negocioId: string, itemId: string, dto: ActualizarItemCartaDto) {
    await this.exigirItem(negocioId, itemId);
    const item = await this.prisma.itemCarta.update({
      where: { id: itemId },
      data: {
        ...(dto.categoria !== undefined ? { categoria: dto.categoria } : {}),
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion } : {}),
        ...(dto.precio !== undefined ? { precio: new Prisma.Decimal(dto.precio) } : {}),
        ...(dto.fotoUrl !== undefined ? { fotoUrl: dto.fotoUrl } : {}),
        ...(dto.etiquetas !== undefined ? { etiquetas: dto.etiquetas } : {}),
        ...(dto.disponible !== undefined ? { disponible: dto.disponible } : {}),
        ...(dto.orden !== undefined ? { orden: dto.orden } : {}),
      },
    });
    return serializarItem(item);
  }

  /** Baja logica: el item queda `disponible: false` (los pedidos historicos lo referencian). */
  async eliminarItemCarta(negocioId: string, itemId: string) {
    await this.exigirItem(negocioId, itemId);
    return this.prisma.itemCarta.update({
      where: { id: itemId },
      data: { disponible: false },
      select: { id: true, nombre: true, disponible: true },
    });
  }

  private async exigirItem(negocioId: string, itemId: string) {
    const item = await this.prisma.itemCarta.findFirst({
      where: { id: itemId, negocioId }, select: { id: true },
    });
    if (!item) throw new NotFoundException('Item de carta no encontrado en este local');
    return item;
  }

  // =========================================================================
  // EMPLEADOS
  // =========================================================================

  /** Nunca devuelve el hash: expone `tienePin` / `tienePassword`. */
  async listarEmpleados(negocioId: string) {
    await this.exigirNegocio(negocioId);
    const data = await this.prisma.empleado.findMany({
      where: { negocioId, eliminadoEn: null },
      orderBy: [{ rol: 'asc' }, { nombre: 'asc' }],
      select: SELECT_EMPLEADO,
    });
    return {
      total: data.length,
      data: data.map(({ pinHash, passwordHash, ...resto }) => ({
        ...resto,
        tienePin: !!pinHash,
        tienePassword: !!passwordHash,
      })),
    };
  }

  async crearEmpleado(negocioId: string, dto: CrearEmpleadoSuperAdminDto) {
    await this.exigirNegocio(negocioId);
    const sucursal = await this.sucursalPrincipal(negocioId);

    const email = dto.email ? dto.email.toLowerCase().trim() : null;
    if (email) {
      const dup = await this.prisma.empleado.findFirst({
        where: { negocioId, email, eliminadoEn: null }, select: { id: true },
      });
      if (dup) throw new ConflictException('Ya existe un empleado con ese email en este local');
    }
    if (dto.pin) await this.exigirPinLibre(negocioId, dto.pin);

    const empleado = await this.prisma.empleado.create({
      data: {
        negocioId,
        sucursalId: sucursal.id,
        nombre: dto.nombre,
        rol: dto.rol,
        email,
        telefono: dto.telefono ?? null,
        pinHash: dto.pin ? await bcrypt.hash(dto.pin, 10) : null,
        passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : null,
        twoFactorEnabled: false,
      },
      select: SELECT_EMPLEADO,
    });
    const { pinHash, passwordHash, ...resto } = empleado;
    return { ...resto, tienePin: !!pinHash, tienePassword: !!passwordHash };
  }

  async actualizarEmpleado(negocioId: string, empleadoId: string, dto: ActualizarEmpleadoSuperAdminDto) {
    const actual = await this.exigirEmpleado(negocioId, empleadoId);

    const email = dto.email !== undefined ? (dto.email ? dto.email.toLowerCase().trim() : null) : undefined;
    if (email) {
      const dup = await this.prisma.empleado.findFirst({
        where: { negocioId, email, eliminadoEn: null, id: { not: empleadoId } }, select: { id: true },
      });
      if (dup) throw new ConflictException('Ya existe un empleado con ese email en este local');
    }
    if (dto.pin) await this.exigirPinLibre(negocioId, dto.pin, empleadoId);

    const empleado = await this.prisma.empleado.update({
      where: { id: actual.id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.rol !== undefined ? { rol: dto.rol } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(dto.telefono !== undefined ? { telefono: dto.telefono } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10) } : {}),
        ...(dto.pin ? { pinHash: await bcrypt.hash(dto.pin, 10) } : {}),
      },
      select: SELECT_EMPLEADO,
    });
    const { pinHash, passwordHash, ...resto } = empleado;
    return { ...resto, tienePin: !!pinHash, tienePassword: !!passwordHash };
  }

  /** Baja logica (igual que `EmpleadosService.desactivar`) + invalida sus sesiones. */
  async eliminarEmpleado(negocioId: string, empleadoId: string) {
    const actual = await this.exigirEmpleado(negocioId, empleadoId);
    const empleado = await this.prisma.empleado.update({
      where: { id: actual.id },
      data: { activo: false, eliminadoEn: new Date() },
      select: { id: true, nombre: true, activo: true, eliminadoEn: true },
    });
    await this.prisma.sesionEmpleado.deleteMany({ where: { empleadoId: actual.id } });
    await this.prisma.sesionDueno.deleteMany({ where: { empleadoId: actual.id } });
    return empleado;
  }

  private async exigirEmpleado(negocioId: string, empleadoId: string) {
    const empleado = await this.prisma.empleado.findFirst({
      where: { id: empleadoId, negocioId, eliminadoEn: null }, select: { id: true },
    });
    if (!empleado) throw new NotFoundException('Empleado no encontrado en este local');
    return empleado;
  }

  /**
   * Un PIN no puede repetirse DENTRO del negocio. Copiado de `EmpleadosService`: el
   * `@@unique([negocioId, pinHash])` NO alcanza porque bcrypt usa salt aleatorio (el mismo PIN
   * produce hashes distintos y el indice nunca colisiona). Con dos PIN iguales el login le
   * asigna a un empleado la identidad del otro (y su rol) segun el orden de la tabla.
   */
  private async exigirPinLibre(negocioId: string, pin: string, exceptoId?: string): Promise<void> {
    const candidatos = await this.prisma.empleado.findMany({
      where: {
        negocioId, activo: true, eliminadoEn: null, pinHash: { not: null },
        ...(exceptoId ? { id: { not: exceptoId } } : {}),
      },
      select: { nombre: true, pinHash: true },
    });
    for (const c of candidatos) {
      if (c.pinHash && (await bcrypt.compare(pin, c.pinHash))) {
        throw new ConflictException(`Ese PIN ya lo usa ${c.nombre} en este local. Elegi otro.`);
      }
    }
  }

  // =========================================================================
  // CONFIGURACION DEL CLUB (delega en el servicio del dueno)
  // =========================================================================

  async actualizarConfiguracion(negocioId: string, dto: ActualizarConfiguracionDto, ctx: { ip?: string }) {
    await this.exigirNegocio(negocioId);
    // `ConfiguracionService.actualizar` hace un UPDATE: si el local no tiene config (vino de
    // otro lado) se la crea primero, si no el PATCH muere con P2025.
    const existe = await this.prisma.configuracionClub.findUnique({
      where: { negocioId }, select: { id: true },
    });
    if (!existe) {
      await this.prisma.configuracionClub.create({
        data: { negocioId, premioTexto: 'Premio de bienvenida' },
      });
    }
    return this.configuracion.actualizar(negocioId, dto, { ip: ctx.ip });
  }

  // =========================================================================
  // THEME / BRANDING
  // =========================================================================

  /**
   * Hace MERGE del theme con el que ya tiene el local (para que mandar solo `colores` no borre
   * el `sello`). Con `{}` da 400: no hay nada que escribir.
   */
  async actualizarTheme(negocioId: string, dto: ActualizarThemeSuperAdminDto) {
    const negocio = await this.exigirNegocio(negocioId);

    const previo = (negocio as unknown as { theme?: unknown }).theme;
    const base: Record<string, unknown> =
      previo && typeof previo === 'object' && !Array.isArray(previo) ? { ...(previo as Record<string, unknown>) } : {};

    if (dto.colores !== undefined) base.colores = dto.colores;
    if (dto.sello !== undefined) base.sello = dto.sello;
    if (dto.imagenFondo !== undefined) base.imagenFondo = dto.imagenFondo;
    if (dto.mostrarPuntos !== undefined) base.mostrarPuntos = dto.mostrarPuntos;

    if (Object.keys(base).length === 0) {
      throw new BadRequestException('El theme no puede estar vacio');
    }

    const actualizado = await this.prisma.negocio.update({
      where: { id: negocioId },
      data: { theme: base as Prisma.InputJsonValue },
      select: { id: true, slug: true, theme: true },
    });
    return { ...actualizado, tieneTheme: actualizado.theme !== null };
  }
}
