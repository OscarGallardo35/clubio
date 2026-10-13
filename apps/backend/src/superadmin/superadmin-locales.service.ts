import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModoClientes, Plan, Prisma, RolEmpleado } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ActualizarConfiguracionDto } from '../configuracion/dto/actualizar-configuracion.dto';
import { PLANTILLAS_DEMO } from './plantillas-demo';
import type { PlantillaDemo } from './plantillas-demo';
import type { CrearLocalSuperAdminDto } from './dto/crear-local.dto';
import type { ActualizarLocalSuperAdminDto } from './dto/actualizar-local.dto';
import type { EmpleadoDemoDto, ProvisionarLocalSuperAdminDto } from './dto/provisionar-local.dto';

/**
 * Locales de la PLATAFORMA: alta, edicion, detalle, la FABRICA DE DEMOS y el reset.
 *
 * Rieles (ver `superadmin-locales.controller.ts`):
 *  - el `negocioId` es SIEMPRE parametro explicito y se valida contra la DB (el super-admin no
 *    tiene tenant). Nunca se asume "el negocio del token".
 *  - NO pasa por `LimitesService` a proposito: el operador configura un local demo en nombre de
 *    un local que todavia no compro plan. Un limite de plan FREE (items_carta = 0, empleados = 1)
 *    dejaria la demo vacia y sin poder mostrarla. La logica de escritura es la MISMA que la del
 *    admin del dueno (mismo modelo, mismo criterio de soft-delete y de clave natural); lo unico
 *    que no se aplica es el gate de plan.
 *  - `provisionar` es IDEMPOTENTE y va TODO en una transaccion: si algo falla no queda un local
 *    a medio armar. La referencia exacta de que crea (y con que valores) es
 *    `apps/backend/scripts/seed-que-lomitos.cjs`.
 */

/** Slug de la sucursal principal (el mismo que usa el seed y el resto del sistema). */
const SLUG_SUCURSAL = 'centro';

/** Telefono del cliente demo: es la clave natural de idempotencia (`@@unique([negocioId, telefono])`). */
const DEMO_TELEFONO = '+5491100000001';
const DEMO_SELLOS = 3;

/**
 * Credenciales de los empleados de EJEMPLO. Son las mismas que ya documenta
 * `seed-que-lomitos.cjs` (o sea: no hay un secreto nuevo en el repo) y se pueden pisar
 * mandando `empleados` en el body del provisioning. NUNCA se devuelven en la respuesta.
 */
const DEMO_DUENO_PASSWORD = 'dueno123456';
const DEMO_ENCARGADO_PIN = '1111';

/** Campos que la respuesta puede exponer de un local. */
const SELECT_LOCAL = {
  id: true, nombre: true, slug: true, plan: true, activo: true,
  colorPrimario: true, colorSecundario: true, logoUrl: true, direccion: true,
  telefono: true, email: true, placeId: true, urlMenu: true, urlClub: true,
  modoClientes: true, theme: true, creadoEn: true, actualizadoEn: true,
} as const;

@Injectable()
export class SuperadminLocalesService {
  private readonly logger = new Logger('SuperadminLocales');

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // HELPERS
  // =========================================================================

  /**
   * Local existente (no eliminado). Es la validacion del `negocioId` explicito.
   *
   * PUBLICO a proposito: los controllers del panel que reciben el `negocioId` en el body
   * (`superadmin-media.controller.ts`) tienen que validarlo contra la DB antes de operar.
   */
  async exigirNegocio(negocioId: string) {
    const negocio = await this.prisma.negocio.findFirst({
      where: { id: negocioId, eliminadoEn: null },
      select: { id: true, slug: true, nombre: true, colorPrimario: true, theme: true },
    });
    if (!negocio) throw new NotFoundException('Local no encontrado');
    return negocio;
  }

  /** Sucursal principal (o la primera activa) de un local. */
  private async sucursalDe(negocioId: string) {
    const principal = await this.prisma.sucursal.findFirst({
      where: { negocioId, esPrincipal: true },
      select: { id: true, slug: true, nombre: true, esPrincipal: true },
    });
    if (principal) return principal;
    return this.prisma.sucursal.findFirst({
      where: { negocioId },
      select: { id: true, slug: true, nombre: true, esPrincipal: true },
      orderBy: { creadoEn: 'asc' },
    });
  }

  /**
   * Valida el `config` libre del provisioning contra el DTO REAL del admin del dueno
   * (`ActualizarConfiguracionDto`) y devuelve solo los campos validos: clave desconocida se
   * descarta, valor invalido = 400. Asi no se inventa un contrato de config paralelo.
   */
  private async validarConfig(config?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!config) return {};
    const instancia = plainToInstance(ActualizarConfiguracionDto, config);
    const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: false });
    if (errores.length > 0) {
      throw new BadRequestException(
        `config invalida: ${errores.map((e) => e.property).join(', ')}`,
      );
    }
    // `whitelist` ya borro del instance las claves sin decorador.
    return { ...instancia } as Record<string, unknown>;
  }

  /** Empleados de ejemplo (DUENO con email+password, ENCARGADO con PIN). El email del dueno lleva el slug. */
  private empleadosDemo(slug: string): EmpleadoDemoDto[] {
    return [
      { nombre: 'Dueno Demo', rol: RolEmpleado.DUENO, email: `dueno@${slug}.demo`, password: DEMO_DUENO_PASSWORD },
      { nombre: 'Encargado Demo', rol: RolEmpleado.ENCARGADO, pin: DEMO_ENCARGADO_PIN },
    ];
  }

  // =========================================================================
  // 1) ALTA / EDICION / DETALLE
  // =========================================================================

  /**
   * Crea el local: `Negocio` (activo) + `Sucursal` principal (`centro`) + `ConfiguracionClub`
   * con defaults, todo en UNA transaccion. Default de plan: PRO (un local demo necesita `menu`).
   */
  async crear(dto: CrearLocalSuperAdminDto) {
    const slug = dto.slug.toLowerCase();
    const existente = await this.prisma.negocio.findUnique({ where: { slug }, select: { id: true } });
    if (existente) throw new ConflictException(`Ya existe un local con el slug "${slug}"`);

    const numero = dto.numeroAtendiente ?? null;

    const negocio = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.negocio.create({
        data: {
          nombre: dto.nombre,
          slug,
          plan: dto.plan ?? Plan.PRO,
          colorPrimario: dto.colorPrimario ?? '#000000',
          colorSecundario: dto.colorSecundario ?? '#FFFFFF',
          logoUrl: dto.logoUrl ?? null,
          direccion: dto.direccion ?? null,
          telefono: dto.telefono ?? null,
          email: dto.email ?? null,
          modoClientes: dto.modoClientes ?? ModoClientes.GLOBAL,
          activo: dto.activo ?? true,
        },
        select: SELECT_LOCAL,
      });

      const sucursal = await tx.sucursal.create({
        data: {
          negocioId: creado.id,
          nombre: 'Casa Central',
          slug: SLUG_SUCURSAL,
          direccion: dto.direccion ?? null,
          telefono: dto.telefono ?? null,
          numeroAtendiente: numero,
          esPrincipal: true,
          activa: true,
        },
        select: { id: true, nombre: true, slug: true, esPrincipal: true, activa: true },
      });

      // Sin configuracion el local ni siquiera resuelve en la PWA Cliente. `premioTexto` es el
      // unico campo obligatorio sin default del modelo.
      await tx.configuracionClub.create({
        data: { negocioId: creado.id, premioTexto: 'Premio de bienvenida', numeroAtendiente: numero },
      });

      return { ...creado, tieneTheme: creado.theme !== null, sucursalPrincipal: sucursal };
    }, { timeout: 30_000, maxWait: 15_000 });

    this.logger.log(`Local creado desde plataforma: ${slug} (${negocio.id})`);
    return negocio;
  }

  /**
   * Edita los datos base. `activo: false` desactiva el local; `numeroAtendiente` va a la config.
   *
   * Limpieza de valores (misma semantica en todos los campos de texto de este PATCH):
   *  - `undefined` (ausente) o `''`  -> NO tocar (el admin del dueno depende de esto);
   *  - `null` EXPLICITO              -> BORRAR (queda en null).
   * Ojo: `null` es un valor, asi que el chequeo NO es `!== undefined` a secas.
   */
  async actualizar(negocioId: string, dto: ActualizarLocalSuperAdminDto) {
    await this.exigirNegocio(negocioId);

    const negocio = await this.prisma.negocio.update({
      where: { id: negocioId },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.plan !== undefined ? { plan: dto.plan } : {}),
        ...(dto.colorPrimario !== undefined ? { colorPrimario: dto.colorPrimario } : {}),
        ...(dto.colorSecundario !== undefined ? { colorSecundario: dto.colorSecundario } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        ...(dto.direccion !== undefined ? { direccion: dto.direccion } : {}),
        ...(dto.telefono !== undefined ? { telefono: dto.telefono } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
        ...(dto.modoClientes !== undefined ? { modoClientes: dto.modoClientes } : {}),
      },
      select: SELECT_LOCAL,
    });

    // `undefined` y `''` = "no tocar"; `null` = borrar (setea null). El vacio NO cambia de
    // semantica: el admin del dueno manda `undefined` cuando el campo esta vacio.
    if (dto.numeroAtendiente !== undefined && dto.numeroAtendiente !== '') {
      await this.prisma.configuracionClub.upsert({
        where: { negocioId },
        update: { numeroAtendiente: dto.numeroAtendiente },
        create: { negocioId, premioTexto: 'Premio de bienvenida', numeroAtendiente: dto.numeroAtendiente },
      });
    }

    return { ...negocio, tieneTheme: negocio.theme !== null };
  }

  /** Detalle: el local + su configuracion + sucursales + contadores (carta y empleados). */
  async detalle(negocioId: string) {
    await this.exigirNegocio(negocioId);

    const [local, configuracion, sucursales, itemsCarta, empleados, clientes, visitas, pedidos] =
      await Promise.all([
        this.prisma.negocio.findUnique({ where: { id: negocioId }, select: SELECT_LOCAL }),
        this.prisma.configuracionClub.findUnique({ where: { negocioId } }),
        this.prisma.sucursal.findMany({
          where: { negocioId },
          select: { id: true, nombre: true, slug: true, esPrincipal: true, activa: true, direccion: true, telefono: true, numeroAtendiente: true },
          orderBy: [{ esPrincipal: 'desc' }, { creadoEn: 'asc' }],
        }),
        this.prisma.itemCarta.count({ where: { negocioId } }),
        this.prisma.empleado.count({ where: { negocioId, eliminadoEn: null, activo: true } }),
        this.prisma.cliente.count({ where: { negocioId, eliminadoEn: null } }),
        this.prisma.visita.count({ where: { negocioId } }),
        this.prisma.pedido.count({ where: { negocioId } }),
      ]);

    return {
      local: local ? { ...local, tieneTheme: local.theme !== null } : null,
      configuracion,
      sucursales,
      contadores: {
        itemsCarta,
        empleados,
        clientes,
        visitas,
        pedidos,
        sucursales: sucursales.length,
      },
    };
  }

  // =========================================================================
  // 2) LA FABRICA DE DEMOS
  // =========================================================================

  /**
   * Deja el local LISTO PARA LA DEMO en UNA transaccion y de forma IDEMPOTENTE:
   *  - configuracion del club (modo, sellos, premio) — upsert por `negocioId`;
   *  - theme/branding (si viene en el body, si no el de la plantilla);
   *  - items de carta — upsert por clave natural `(negocioId, nombre)`;
   *  - empleados de ejemplo (DUENO con email+password, ENCARGADO con PIN) — upsert por `(negocioId, nombre)`;
   *  - cliente demo con sellos (+ su tarjeta por sucursal) para poder mostrar la tarjeta.
   *
   * Volver a llamarlo NO duplica: los conteos quedan iguales.
   *
   * Dos flags OPCIONALES (aditivos; ausentes = comportamiento historico):
   *  - `reemplazarCarta`: `true` sincroniza la carta (borra los items que sobran del local);
   *    ausente/`false` sigue ACUMULANDO.
   *  - `forzarTheme`: `true` reaplica el theme de la plantilla SIEMPRE; ausente/`false` solo lo
   *    aplica si el local NO tiene theme (no pisa un branding elegido a mano).
   */
  async provisionar(negocioId: string, dto: ProvisionarLocalSuperAdminDto) {
    const negocio = await this.exigirNegocio(negocioId);
    const plantilla: PlantillaDemo = PLANTILLAS_DEMO[dto.plantilla];
    if (!plantilla) throw new BadRequestException(`Plantilla desconocida: ${dto.plantilla}`);

    const configExtra = await this.validarConfig(dto.config);
    const theme = (dto.theme ?? plantilla.theme) as Record<string, unknown> | null;
    const items = dto.carta ?? plantilla.items;
    const empleados = dto.empleados ?? this.empleadosDemo(negocio.slug);

    // Theme: por DEFAULT (sin `forzarTheme`) solo se aplica si el local TODAVIA NO tiene uno,
    // para no pisar un branding elegido a mano. `forzarTheme: true` recupera el comportamiento
    // historico (reaplica el de la plantilla siempre).
    const tieneTheme = negocio.theme !== null;
    const aplicaTheme = dto.forzarTheme === true || !tieneTheme;
    const reemplazarCarta = dto.reemplazarCarta === true;

    // Los hashes se calculan FUERA de la transaccion: bcrypt es CPU-bound (~100ms por hash)
    // y no queremos estirar la transaccion de la DB por eso.
    const empleadosConHash = await Promise.all(
      empleados.map(async (e) => ({
        nombre: e.nombre,
        rol: e.rol,
        email: e.email ? e.email.toLowerCase().trim() : null,
        passwordHash: e.password ? await bcrypt.hash(e.password, 10) : null,
        pinHash: e.pin ? await bcrypt.hash(e.pin, 10) : null,
      })),
    );

    const resultado = await this.prisma.$transaction(
      async (tx) => {
        // --- Sucursal principal (se reusa si ya existe; se crea si el local vino de otro lado) ---
        let sucursal = await tx.sucursal.findFirst({
          where: { negocioId, esPrincipal: true },
          select: { id: true, slug: true },
        });
        if (!sucursal) {
          sucursal = await tx.sucursal.upsert({
            where: { negocioId_slug: { negocioId, slug: SLUG_SUCURSAL } },
            update: { esPrincipal: true, activa: true },
            create: { negocioId, nombre: 'Casa Central', slug: SLUG_SUCURSAL, esPrincipal: true, activa: true },
            select: { id: true, slug: true },
          });
        }

        // --- Configuracion del club ---
        const configData = { ...plantilla.config, ...configExtra };
        await tx.configuracionClub.upsert({
          where: { negocioId },
          update: configData as Prisma.ConfiguracionClubUpdateInput,
          create: { negocioId, ...configData } as Prisma.ConfiguracionClubUncheckedCreateInput,
        });

        // --- Branding / theme ---
        // `DbNull` y no `null`: son cosas distintas para Prisma en un campo Json? (la plantilla
        // `basica` limpia el theme; un `null` de JS no alcanza para eso).
        const dataNegocio: Prisma.NegocioUpdateInput = {};
        if (aplicaTheme) {
          dataNegocio.theme = theme === null ? Prisma.DbNull : (theme as Prisma.InputJsonValue);
        }
        const bg = theme?.colores && typeof (theme.colores as Record<string, unknown>).bg === 'string'
          ? ((theme.colores as Record<string, unknown>).bg as string)
          : null;
        // Solo se pisa el color si se esta aplicando el theme de la plantilla Y el local todavia
        // tiene el default (no se pisa una marca elegida a mano).
        if (aplicaTheme && bg && negocio.colorPrimario === '#000000') dataNegocio.colorPrimario = bg;
        if (Object.keys(dataNegocio).length > 0) {
          await tx.negocio.update({ where: { id: negocioId }, data: dataNegocio });
        }

        // --- Items de carta (clave natural: negocioId + nombre, igual que el seed) ---
        // UN solo findMany + createMany en vez de un findOne+create por item: Neon tiene ~200ms
        // de latencia por query y la transaccion interactiva tiene timeout (ver opciones abajo).
        const existentesItems = await tx.itemCarta.findMany({
          where: { negocioId, nombre: { in: items.map((i) => i.nombre) } },
          select: { id: true, nombre: true },
        });
        const mapaItems = new Map(existentesItems.map((i) => [i.nombre, i.id]));
        const itemsNuevos: Prisma.ItemCartaCreateManyInput[] = [];
        let itemsCreados = 0;
        let itemsActualizados = 0;
        for (const it of items) {
          const data = {
            categoria: it.categoria,
            nombre: it.nombre,
            descripcion: it.descripcion ?? null,
            precio: new Prisma.Decimal(it.precio),
            etiquetas: it.etiquetas ?? [],
            disponible: (it as { disponible?: boolean }).disponible ?? true,
            orden: it.orden ?? 0,
          };
          const idExistente = mapaItems.get(it.nombre);
          if (idExistente) {
            await tx.itemCarta.update({ where: { id: idExistente }, data });
            itemsActualizados++;
          } else {
            itemsNuevos.push({ negocioId, ...data });
            itemsCreados++;
          }
        }
        if (itemsNuevos.length > 0) await tx.itemCarta.createMany({ data: itemsNuevos });

        // --- Sync de carta (solo con `reemplazarCarta: true`) ---
        // Borra los items del local que NO estan en la plantilla: queda SOLO la carta de la
        // plantilla. Sin el flag no se toca nada (el provisioning sigue ACUMULANDO como antes).
        let cartaBorrados = 0;
        if (reemplazarCarta) {
          const borrados = await tx.itemCarta.deleteMany({
            where: { negocioId, nombre: { notIn: items.map((i) => i.nombre) } },
          });
          cartaBorrados = borrados.count;
        }

        // --- Empleados de ejemplo (clave natural: negocioId + nombre, igual que el seed) ---
        const existentesEmpleados = await tx.empleado.findMany({
          where: { negocioId, nombre: { in: empleadosConHash.map((e) => e.nombre) } },
          select: { id: true, nombre: true },
        });
        const mapaEmpleados = new Map(existentesEmpleados.map((e) => [e.nombre, e.id]));
        const empleadosNuevos: Prisma.EmpleadoCreateManyInput[] = [];
        let empleadosCreados = 0;
        let empleadosActualizados = 0;
        for (const e of empleadosConHash) {
          const data: Prisma.EmpleadoCreateManyInput = {
            negocioId,
            sucursalId: sucursal.id,
            nombre: e.nombre,
            rol: e.rol,
            email: e.email,
            activo: true,
            eliminadoEn: null,
            twoFactorEnabled: false,
            ...(e.passwordHash ? { passwordHash: e.passwordHash } : {}),
            ...(e.pinHash ? { pinHash: e.pinHash } : {}),
          };
          const idExistente = mapaEmpleados.get(e.nombre);
          if (idExistente) {
            await tx.empleado.update({ where: { id: idExistente }, data });
            empleadosActualizados++;
          } else {
            empleadosNuevos.push(data);
            empleadosCreados++;
          }
        }
        if (empleadosNuevos.length > 0) await tx.empleado.createMany({ data: empleadosNuevos });

        // --- Cliente demo + su tarjeta (clave natural: negocioId + telefono) ---
        const cliente = await tx.cliente.upsert({
          where: { negocioId_telefono: { negocioId, telefono: DEMO_TELEFONO } },
          update: {
            nombre: 'Cliente Demo',
            sellosActuales: DEMO_SELLOS,
            puntosActuales: 0,
            totalVisitas: DEMO_SELLOS,
            eliminadoEn: null,
          },
          create: {
            negocioId,
            nombre: 'Cliente Demo',
            telefono: DEMO_TELEFONO,
            aceptaNotificaciones: false,
            tienePwaInstalada: false,
            sellosActuales: DEMO_SELLOS,
            puntosActuales: 0,
            totalVisitas: DEMO_SELLOS,
          },
          select: { id: true },
        });
        await tx.tarjetaClienteSucursal.upsert({
          where: { clienteId_sucursalId: { clienteId: cliente.id, sucursalId: sucursal.id } },
          update: { sellosActuales: DEMO_SELLOS, totalVisitas: DEMO_SELLOS },
          create: { clienteId: cliente.id, sucursalId: sucursal.id, sellosActuales: DEMO_SELLOS, totalVisitas: DEMO_SELLOS },
        });

        return {
          sucursalId: sucursal.id,
          items: { creados: itemsCreados, actualizados: itemsActualizados },
          empleados: { creados: empleadosCreados, actualizados: empleadosActualizados },
          clienteDemo: { id: cliente.id, telefono: DEMO_TELEFONO, sellos: DEMO_SELLOS },
          cartaBorrados,
        };
      },
      // El default de Prisma son 5s. Con Neon (latencia por query del orden de 200ms) el
      // provisioning encadena decenas de queries y se pasaba del limite: la transaccion se
      // cerraba y el ultimo upsert moria con "Transaction already closed".
      { timeout: 30_000, maxWait: 15_000 },
    );

    // Contadores FUERA de la transaccion: son lecturas y no hace falta estirar (ni arriesgar) la tx.
    const [totalItems, totalEmpleados, totalClientes] = await Promise.all([
      this.prisma.itemCarta.count({ where: { negocioId } }),
      this.prisma.empleado.count({ where: { negocioId, eliminadoEn: null } }),
      this.prisma.cliente.count({ where: { negocioId, eliminadoEn: null } }),
    ]);

    return {
      negocioId,
      slug: negocio.slug,
      plantilla: dto.plantilla,
      theme: theme === null ? null : 'aplicado',
      // Aditivos: si se aplico el theme de verdad (el local no tenia, o vino `forzarTheme`) y
      // cuantos items se borraron por el sync de carta (0 cuando no se reemplaza).
      themeAplicado: aplicaTheme,
      cartaBorrados: resultado.cartaBorrados,
      ...resultado,
      items: { ...resultado.items, total: totalItems },
      empleados: { ...resultado.empleados, total: totalEmpleados },
      clientes: totalClientes,
    };
  }

  // =========================================================================
  // 3) RESET DE DEMO
  // =========================================================================

  /**
   * Deja el local "como recien provisionado" para poder mostrar la demo otra vez.
   *
   * Borra los datos de DEMO (visitas, pedidos, tokens, tarjetas y clientes de prueba) y
   * regenera al cliente demo con sus sellos. NO toca configuracion, theme, carta ni empleados:
   * el branding que el operador dejo a punto sobrevive al reset.
   */
  async resetDemo(negocioId: string) {
    await this.exigirNegocio(negocioId);

    const sucursal = await this.sucursalDe(negocioId);

    const borrados = await this.prisma.$transaction(async (tx) => {
      // Orden por las FK: primero lo que referencia (Restrict no esta en juego, pero el orden
      // evita depender del cascade de Postgres).
      const tokensValidacion = await tx.tokenValidacion.deleteMany({ where: { negocioId } });
      const visitas = await tx.visita.deleteMany({ where: { negocioId } });
      const pedidos = await tx.pedido.deleteMany({ where: { negocioId } });
      const tarjetas = await tx.tarjetaClienteSucursal.deleteMany({ where: { cliente: { negocioId } } });
      const clientes = await tx.cliente.deleteMany({ where: { negocioId } });

      // Cliente demo regenerado con sellos, para que la tarjeta se vea con progreso.
      const cliente = await tx.cliente.create({
        data: {
          negocioId,
          nombre: 'Cliente Demo',
          telefono: DEMO_TELEFONO,
          aceptaNotificaciones: false,
          tienePwaInstalada: false,
          sellosActuales: DEMO_SELLOS,
          puntosActuales: 0,
          totalVisitas: DEMO_SELLOS,
        },
        select: { id: true },
      });
      if (sucursal) {
        await tx.tarjetaClienteSucursal.create({
          data: { clienteId: cliente.id, sucursalId: sucursal.id, sellosActuales: DEMO_SELLOS, totalVisitas: DEMO_SELLOS },
        });
      }

      return {
        tokensValidacion: tokensValidacion.count,
        visitas: visitas.count,
        pedidos: pedidos.count,
        tarjetas: tarjetas.count,
        clientes: clientes.count,
      };
    }, { timeout: 30_000, maxWait: 15_000 });

    return {
      negocioId,
      borrados,
      clienteDemo: { telefono: DEMO_TELEFONO, sellos: DEMO_SELLOS, sucursalId: sucursal?.id ?? null },
      // Explicito: es lo que el reset NO toca (lo consume la UI para avisar al operador).
      conservado: ['configuracion', 'theme', 'carta', 'empleados'],
    };
  }

  // =========================================================================
  // 4) BAJA TOTAL (limpieza de un local de prueba / demo vendida que se cae)
  // =========================================================================

  /**
   * Borra el local COMPLETO. No es soft delete del contrato original (que solo pide desactivar):
   * es para poder limpiar un local de prueba. Se hace explicito el orden para no depender de que
   * Postgres resuelva bien el cascade contra las FK `Restrict` (Visita.sucursal, Empleado.sucursal).
   */
  async eliminar(negocioId: string) {
    const negocio = await this.exigirNegocio(negocioId);

    const resumen = await this.prisma.$transaction(async (tx) => {
      const tokensValidacion = await tx.tokenValidacion.deleteMany({ where: { negocioId } });
      const visitas = await tx.visita.deleteMany({ where: { negocioId } });
      const pedidos = await tx.pedido.deleteMany({ where: { negocioId } });
      const tarjetas = await tx.tarjetaClienteSucursal.deleteMany({ where: { cliente: { negocioId } } });
      const clientes = await tx.cliente.deleteMany({ where: { negocioId } });
      const empleados = await tx.empleado.deleteMany({ where: { negocioId } });
      // Lo que cuelga de la sucursal se va con el cascade; aca se borra la sucursal misma.
      await tx.sucursal.deleteMany({ where: { negocioId } });
      // El negocio cae con cascade (carta, config, push, auditoria de negocio, etc.).
      await tx.negocio.delete({ where: { id: negocioId } });
      return {
        tokensValidacion: tokensValidacion.count,
        visitas: visitas.count,
        pedidos: pedidos.count,
        tarjetas: tarjetas.count,
        clientes: clientes.count,
        empleados: empleados.count,
      };
    }, { timeout: 30_000, maxWait: 15_000 });

    this.logger.log(`Local borrado desde plataforma: ${negocio.slug} (${negocioId})`);
    return { negocioId, slug: negocio.slug, borrados: resumen };
  }
}
