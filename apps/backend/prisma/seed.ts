// prisma/seed.ts
import { PrismaClient, Plan, RolEmpleado, ModoFidelizacion, TipoModificador, ModoPago, TipoPedido, ModoClientes } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';

const prisma = new PrismaClient();

// ============================================================================
// UTILIDADES
// ============================================================================

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPhone(): string {
  return `+54911${randomInt(10000000, 99999999)}`;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ============================================================================
// SEED DE PLANFEATURES
// ============================================================================

async function seedPlanFeatures() {
  console.log('🌱 Seeding PlanFeatures...');

  const features = [
    // ============ FEATURES BOOLEANAS ============
    // FREE
    { plan: Plan.FREE, feature: 'fidelizacion', habilitada: true, limite: null },
    { plan: Plan.FREE, feature: 'resenas', habilitada: true, limite: null },
    { plan: Plan.FREE, feature: 'menu', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'pedidos', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'modificadores', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'upsell', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'push', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'crm', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'delivery', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'turnos', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'checkin', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'asignacion_pedidos', habilitada: false, limite: null },
    { plan: Plan.FREE, feature: 'google_business', habilitada: false, limite: null },

    // BASIC
    { plan: Plan.BASIC, feature: 'fidelizacion', habilitada: true, limite: null },
    { plan: Plan.BASIC, feature: 'resenas', habilitada: true, limite: null },
    { plan: Plan.BASIC, feature: 'menu', habilitada: true, limite: null },
    { plan: Plan.BASIC, feature: 'pedidos', habilitada: true, limite: null },
    { plan: Plan.BASIC, feature: 'modificadores', habilitada: true, limite: null },
    { plan: Plan.BASIC, feature: 'upsell', habilitada: true, limite: null },
    { plan: Plan.BASIC, feature: 'push', habilitada: true, limite: null },
    { plan: Plan.BASIC, feature: 'crm', habilitada: true, limite: null },
    { plan: Plan.BASIC, feature: 'delivery', habilitada: false, limite: null },
    { plan: Plan.BASIC, feature: 'turnos', habilitada: false, limite: null },
    { plan: Plan.BASIC, feature: 'checkin', habilitada: false, limite: null },
    { plan: Plan.BASIC, feature: 'asignacion_pedidos', habilitada: false, limite: null },
    { plan: Plan.BASIC, feature: 'google_business', habilitada: false, limite: null },

    // PRO
    { plan: Plan.PRO, feature: 'fidelizacion', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'resenas', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'menu', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'pedidos', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'modificadores', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'upsell', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'push', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'crm', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'delivery', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'turnos', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'checkin', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'asignacion_pedidos', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'google_business', habilitada: true, limite: null },

    // ============ LÍMITES NUMÉRICOS ============
    // FREE
    { plan: Plan.FREE, feature: 'clientes', habilitada: true, limite: 100 },
    { plan: Plan.FREE, feature: 'empleados', habilitada: true, limite: 1 },
    { plan: Plan.FREE, feature: 'sucursales', habilitada: true, limite: 1 },
    { plan: Plan.FREE, feature: 'items_carta', habilitada: false, limite: 0 },
    { plan: Plan.FREE, feature: 'pedidos_mes', habilitada: false, limite: 0 },
    { plan: Plan.FREE, feature: 'campanas_push_mes', habilitada: false, limite: 0 },

    // BASIC
    { plan: Plan.BASIC, feature: 'clientes', habilitada: true, limite: 500 },
    { plan: Plan.BASIC, feature: 'empleados', habilitada: true, limite: 5 },
    { plan: Plan.BASIC, feature: 'sucursales', habilitada: true, limite: 2 },
    { plan: Plan.BASIC, feature: 'items_carta', habilitada: true, limite: 100 },
    { plan: Plan.BASIC, feature: 'pedidos_mes', habilitada: true, limite: 500 },
    { plan: Plan.BASIC, feature: 'campanas_push_mes', habilitada: true, limite: 5 },

    // PRO (ilimitados)
    { plan: Plan.PRO, feature: 'clientes', habilitada: true, limite: 5000 },
    { plan: Plan.PRO, feature: 'empleados', habilitada: true, limite: 20 },
    { plan: Plan.PRO, feature: 'sucursales', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'items_carta', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'pedidos_mes', habilitada: true, limite: null },
    { plan: Plan.PRO, feature: 'campanas_push_mes', habilitada: true, limite: null },
  ];

  for (const f of features) {
    await prisma.planFeature.upsert({
      where: { plan_feature: { plan: f.plan, feature: f.feature } },
      update: { habilitada: f.habilitada, limite: f.limite },
      create: f,
    });
  }

  console.log(`✅ ${features.length} PlanFeatures creados/actualizados`);
}

// ============================================================================
// SEED DE SUPER-ADMIN
// ============================================================================

async function seedSuperAdmin() {
  console.log('🌱 Seeding SuperAdmin...');

  const email = process.env.SUPER_ADMIN_INITIAL_EMAIL || 'admin@fideliza.app';
  const password = process.env.SUPER_ADMIN_INITIAL_PASSWORD || 'admin123456';
  const nombre = 'Super Admin';

  const existente = await prisma.superAdmin.findUnique({ where: { email } });
  if (existente) {
    console.log(`⏭️  SuperAdmin ya existe: ${email}`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const twoFactorSecret = speakeasy.generateSecret({ length: 32 }).base32;

  await prisma.superAdmin.create({
    data: {
      email,
      passwordHash,
      nombre,
      twoFactorSecret,
      twoFactorEnabled: true,
    },
  });

  console.log(`✅ SuperAdmin creado: ${email}`);
  console.log(`   Contraseña: ${password}`);
  console.log(`   🔐 Secreto 2FA: ${twoFactorSecret}`);
  console.log(`   ⚠️  Guardá este secreto en Google Authenticator. NO se muestra de nuevo.`);
}

// ============================================================================
// SEED DE NEGOCIO COMPLETO (con 2 sucursales)
// ============================================================================

async function seedNegocioCompleto() {
  console.log('🌱 Seeding Negocio completo (Bar La Esquina)...');

  const slug = 'bar-la-esquina';

  // Si ya existe, saltear
  const existente = await prisma.negocio.findUnique({ where: { slug } });
  if (existente) {
    console.log(`⏭️  Negocio ya existe: ${slug}`);
    return;
  }

  // 1. Crear negocio
  const negocio = await prisma.negocio.create({
    data: {
      nombre: 'Bar La Esquina',
      slug,
      cuit: '30-12345678-9',
      telefono: '+5491112345678',
      direccion: 'Av. Corrientes 1234, CABA',
      email: 'info@barlaesquina.com',
      colorPrimario: '#E63946',
      colorSecundario: '#F1FAEE',
      plan: Plan.PRO,
      modoClientes: ModoClientes.GLOBAL,
      payPerUseActivo: false,
      activo: true,
    },
  });

  // 2. Configuración del club (global)
  await prisma.configuracionClub.create({
    data: {
      negocioId: negocio.id,
      modoFidelizacion: ModoFidelizacion.SOLO_VISITAS,
      sellosParaPremio: 10,
      premioTexto: 'Café gratis',
      sellosBienvenida: 1,
      limiteVisitasPorDia: 1,
      horasMinimasEntreVisitas: 4,
      requiereValidacionEmpleado: true,
      permiteRegaloManual: true,
      mensajeBienvenida: '¡Bienvenido al club! Sumá visitas y ganá premios.',
      mostrarResenaPostVisita: true,
      permitirOverrideSucursal: true,
      colchonGraciaDefault: 50,
      menuActivo: true,
      tiposPedidoHabilitados: [TipoPedido.MESA, TipoPedido.TAKEAWAY, TipoPedido.DELIVERY],
      modosPagoHabilitados: [ModoPago.EFECTIVO, ModoPago.TRANSFERENCIA, ModoPago.MERCADO_PAGO],
      costoEnvio: 500,
      pedidoMinimoDelivery: 3000,
      zonaEntrega: 'CABA y GBA Norte',
      modoPagoPorDefecto: ModoPago.EFECTIVO,
      tipoPedidoPorDefecto: TipoPedido.MESA,
      forzarTakeawaySiNoHayMesas: true,
      numeroAtendiente: '+5491199998888',
      modoAsignacionPedidos: 'BROADCAST',
      transferenciaAlias: 'bar.la.esquina.mp',
      transferenciaCbu: '0000003100010000000001',
      transferenciaTitular: 'Bar La Esquina SA',
      transferenciaBanco: 'Banco Nación',
      upsellActivo: true,
      upsellMaxSugerencias: 3,
      turnosActivos: true,
      checkinObligatorio: false,
      duplicarSemanaAuto: false,
      pushInactividad3Dias: true,
      pushCumpleanos: false,
      pushPremioPorVencer: true,
      pushAUnoDelPremio: true,
      pushInactivos30Dias: false,
    },
  });

  // 3. Crear 2 sucursales
  const sucursalCentro = await prisma.sucursal.create({
    data: {
      negocioId: negocio.id,
      nombre: 'Centro',
      slug: 'centro',
      direccion: 'Av. Corrientes 1234, CABA',
      telefono: '+5491112345678',
      numeroAtendiente: '+5491199998888',
      esPrincipal: true,
      activa: true,
    },
  });

  const sucursalNorte = await prisma.sucursal.create({
    data: {
      negocioId: negocio.id,
      nombre: 'Norte',
      slug: 'norte',
      direccion: 'Av. Cabildo 2500, CABA',
      telefono: '+5491112345679',
      numeroAtendiente: '+5491199998889',
      esPrincipal: false,
      activa: true,
      colorPrimario: '#457B9D',
    },
  });

  // 4. Override de config en Norte (premio distinto)
  await prisma.configuracionSucursal.create({
    data: {
      sucursalId: sucursalNorte.id,
      premioTexto: 'Medialuna gratis',
      sellosParaPremio: 8,
    },
  });

  // 5. Crear dueño
  const dueno = await prisma.empleado.create({
    data: {
      negocioId: negocio.id,
      sucursalId: sucursalCentro.id,
      nombre: 'Carlos Dueño',
      rol: RolEmpleado.DUENO,
      email: 'carlos@barlaesquina.com',
      passwordHash: await hashPassword('dueno123456'),
      twoFactorEnabled: false,
      emailVerificado: true,
      accesoMultiSucursal: true,
      activo: true,
    },
  });

  // 6. Crear empleados
  const encargado = await prisma.empleado.create({
    data: {
      negocioId: negocio.id,
      sucursalId: sucursalCentro.id,
      nombre: 'María Encargada',
      rol: RolEmpleado.ENCARGADO,
      pinHash: await hashPin('1111'),
      telefono: '+5491111111111',
      accesoMultiSucursal: true,
      activo: true,
    },
  });

  const cajero = await prisma.empleado.create({
    data: {
      negocioId: negocio.id,
      sucursalId: sucursalCentro.id,
      nombre: 'Juan Cajero',
      rol: RolEmpleado.CAJERO,
      pinHash: await hashPin('2222'),
      telefono: '+5491122222222',
      accesoMultiSucursal: false,
      activo: true,
    },
  });

  const mesero = await prisma.empleado.create({
    data: {
      negocioId: negocio.id,
      sucursalId: sucursalNorte.id,
      nombre: 'Pedro Mesero',
      rol: RolEmpleado.MESERO,
      pinHash: await hashPin('3333'),
      telefono: '+5491133333333',
      accesoMultiSucursal: false,
      activo: true,
    },
  });

  console.log(`✅ Negocio creado: ${negocio.nombre} (${slug})`);
  console.log(`   Sucursales: Centro (principal), Norte`);
  console.log(`   Empleados: 4 (1 dueño, 1 encargado, 1 cajero, 1 mesero)`);
  console.log(`   PINs: María=1111, Juan=2222, Pedro=3333`);
  console.log(`   Dueño: carlos@barlaesquina.com / dueno123456`);

  return { negocio, sucursalCentro, sucursalNorte, dueno, encargado, cajero, mesero };
}

// ============================================================================
// SEED DE CARTA
// ============================================================================

async function seedCarta(negocioId: string, sucursalNorteId: string) {
  console.log('🌱 Seeding Carta...');

  const items = [
    // Entradas
    { categoria: 'Entradas', nombre: 'Empanadas (3u)', descripcion: 'Carne, pollo o jamón y queso', precio: 2500, etiquetas: [], orden: 1 },
    { categoria: 'Entradas', nombre: 'Provoleta', descripcion: 'Con orégano y aceite de oliva', precio: 3200, etiquetas: ['vegetariano'], orden: 2 },
    { categoria: 'Entradas', nombre: 'Papas fritas', descripcion: 'Porción grande con cheddar', precio: 2800, etiquetas: ['vegetariano'], orden: 3 },

    // Principales
    { categoria: 'Principales', nombre: 'Milanesa napolitana', descripcion: 'Con papas fritas', precio: 6800, etiquetas: [], orden: 1 },
    { categoria: 'Principales', nombre: 'Bife de chorizo', descripcion: '300g con guarnición', precio: 9500, etiquetas: ['sin-tacc'], orden: 2 },
    { categoria: 'Principales', nombre: 'Hamburguesa clásica', descripcion: 'Con papas y cheddar', precio: 5500, etiquetas: [], orden: 3 },
    { categoria: 'Principales', nombre: 'Pizza muzzarella', descripcion: 'Para 2 personas', precio: 7200, etiquetas: ['vegetariano'], orden: 4 },
    { categoria: 'Principales', nombre: 'Ensalada César', descripcion: 'Con pollo grillado', precio: 4800, etiquetas: ['sin-tacc'], orden: 5 },

    // Bebidas
    { categoria: 'Bebidas', nombre: 'Coca-Cola 500ml', descripcion: 'Línea Coca-Cola', precio: 1500, etiquetas: [], orden: 1 },
    { categoria: 'Bebidas', nombre: 'Cerveza artesanal', descripcion: 'IPA, Golden o Negra', precio: 2200, etiquetas: [], orden: 2 },
    { categoria: 'Bebidas', nombre: 'Agua mineral 500ml', descripcion: 'Con o sin gas', precio: 900, etiquetas: [], orden: 3 },
    { categoria: 'Bebidas', nombre: 'Café expreso', descripcion: 'Solo o cortado', precio: 800, etiquetas: [], orden: 4 },

    // Postres
    { categoria: 'Postres', nombre: 'Flan casero', descripcion: 'Con dulce de leche', precio: 2000, etiquetas: ['vegetariano'], orden: 1 },
    { categoria: 'Postres', nombre: 'Helado (2 bochas)', descripcion: 'Sabores del día', precio: 1800, etiquetas: ['vegetariano'], orden: 2 },
  ];

  const itemsCreados: any[] = [];

  for (const item of items) {
    const creado = await prisma.itemCarta.create({
      data: {
        negocioId,
        categoria: item.categoria,
        nombre: item.nombre,
        descripcion: item.descripcion,
        precio: item.precio,
        etiquetas: item.etiquetas,
        disponible: true,
        orden: item.orden,
      },
    });
    itemsCreados.push(creado);
  }

  // Override de precio en Norte (la pizza cuesta más caro en Norte)
  const pizza = itemsCreados.find((i) => i.nombre === 'Pizza muzzarella');
  if (pizza) {
    await prisma.itemCartaSucursal.create({
      data: {
        itemCartaId: pizza.id,
        sucursalId: sucursalNorteId,
        precio: 7800,
      },
    });
  }

  console.log(`✅ ${itemsCreados.length} items de carta creados`);
  return itemsCreados;
}

// ============================================================================
// SEED DE MODIFICADORES
// ============================================================================

async function seedModificadores(negocioId: string, itemsCreados: any[]) {
  console.log('🌱 Seeding Modificadores...');

  // Grupo 1: Sabor de gaseosa (obligatorio, única selección)
  const grupoGaseosa = await prisma.grupoModificador.create({
    data: {
      negocioId,
      nombre: 'Sabor de gaseosa',
      descripcion: 'Elegí el sabor',
      tipo: TipoModificador.UNICA_SELECCION,
      obligatorio: true,
      minSelecciones: 1,
      maxSelecciones: 1,
      orden: 1,
      opciones: {
        create: [
          { nombre: 'Original', precioExtra: 0, orden: 1 },
          { nombre: 'Zero', precioExtra: 200, orden: 2 },
          { nombre: 'Light', precioExtra: 200, orden: 3 },
        ],
      },
    },
  });

  // Grupo 2: Punto de cocción (opcional, única selección)
  const grupoPunto = await prisma.grupoModificador.create({
    data: {
      negocioId,
      nombre: 'Punto de cocción',
      tipo: TipoModificador.UNICA_SELECCION,
      obligatorio: false,
      minSelecciones: 0,
      maxSelecciones: 1,
      orden: 2,
      opciones: {
        create: [
          { nombre: 'Jugoso', precioExtra: 0, orden: 1 },
          { nombre: 'A punto', precioExtra: 0, orden: 2 },
          { nombre: 'Cocido', precioExtra: 0, orden: 3 },
        ],
      },
    },
  });

  // Grupo 3: Aderezos (opcional, múltiple)
  const grupoAderezos = await prisma.grupoModificador.create({
    data: {
      negocioId,
      nombre: 'Aderezos',
      tipo: TipoModificador.MULTIPLE_SELECCION,
      obligatorio: false,
      minSelecciones: 0,
      maxSelecciones: 4,
      orden: 3,
      opciones: {
        create: [
          { nombre: 'Mayonesa', precioExtra: 0, orden: 1 },
          { nombre: 'Ketchup', precioExtra: 0, orden: 2 },
          { nombre: 'Mostaza', precioExtra: 0, orden: 3 },
          { nombre: 'BBQ', precioExtra: 300, orden: 4 },
        ],
      },
    },
  });

  // Asignar gaseosa a los items de bebidas
  const bebidas = itemsCreados.filter((i) => i.categoria === 'Bebidas' && i.nombre.includes('Coca'));
  for (const b of bebidas) {
    await prisma.itemCarta.update({
      where: { id: b.id },
      data: { gruposModificadores: { connect: { id: grupoGaseosa.id } } },
    });
  }

  // Asignar punto de cocción a las carnes
  const carnes = itemsCreados.filter((i) => i.nombre.includes('Bife') || i.nombre.includes('Milanesa'));
  for (const c of carnes) {
    await prisma.itemCarta.update({
      where: { id: c.id },
      data: { gruposModificadores: { connect: { id: grupoPunto.id } } },
    });
  }

  // Asignar aderezos a las hamburguesas
  const hamburguesas = itemsCreados.filter((i) => i.nombre.includes('Hamburguesa'));
  for (const h of hamburguesas) {
    await prisma.itemCarta.update({
      where: { id: h.id },
      data: { gruposModificadores: { connect: { id: grupoAderezos.id } } },
    });
  }

  console.log(`✅ 3 grupos de modificadores creados`);
}

// ============================================================================
// SEED DE REGLAS DE UPSELL
// ============================================================================

async function seedUpsell(negocioId: string, itemsCreados: any[]) {
  console.log('🌱 Seeding Reglas de Upsell...');

  const hamburguesa = itemsCreados.find((i) => i.nombre.includes('Hamburguesa'));
  const pizza = itemsCreados.find((i) => i.nombre.includes('Pizza'));
  const cafe = itemsCreados.find((i) => i.nombre.includes('Café'));
  const papas = itemsCreados.find((i) => i.nombre.includes('Papas'));
  const coca = itemsCreados.find((i) => i.nombre.includes('Coca'));
  const flan = itemsCreados.find((i) => i.nombre.includes('Flan'));

  if (hamburguesa && papas) {
    await prisma.reglaUpsell.create({
      data: {
        negocioId,
        nombre: 'Hamburguesa + Papas',
        activa: true,
        prioridad: 10,
        mensaje: '¿Te gustaría agregar papas fritas?',
        itemOrigenId: hamburguesa.id,
        itemDestinoId: papas.id,
        soloUnaVez: true,
      },
    });
  }

  if (pizza && coca) {
    await prisma.reglaUpsell.create({
      data: {
        negocioId,
        nombre: 'Pizza + Gaseosa',
        activa: true,
        prioridad: 8,
        mensaje: '¿Sumás una Coca-Cola?',
        itemOrigenId: pizza.id,
        itemDestinoId: coca.id,
        soloUnaVez: true,
      },
    });
  }

  if (cafe && flan) {
    await prisma.reglaUpsell.create({
      data: {
        negocioId,
        nombre: 'Café + Postre',
        activa: true,
        prioridad: 5,
        mensaje: '¿Te gustaría un flan casero con el café?',
        itemOrigenId: cafe.id,
        itemDestinoId: flan.id,
        soloUnaVez: true,
      },
    });
  }

  console.log(`✅ 3 reglas de upsell creadas`);
}

// ============================================================================
// SEED DE CLIENTES
// ============================================================================

async function seedClientes(negocioId: string, sucursalCentroId: string, sucursalNorteId: string) {
  console.log('🌱 Seeding Clientes...');

  const nombres = [
    'Ana García', 'Luis Pérez', 'María López', 'Carlos Ruiz', 'Laura Fernández',
    'Diego Torres', 'Sofía Ramírez', 'Martín Silva', 'Camila Díaz', 'Jorge Romero',
    'Valentina Cruz', 'Federico Herrera', 'Julieta Vega', 'Nicolás Castro', 'Florencia Ríos',
    'Andrés Molina', 'Lucía Ortiz', 'Matías Suárez', 'Carolina Medina', 'Pablo Guzmán',
  ];

  const etiquetas = ['NUEVO', 'REGULAR', 'VIP', 'INACTIVO'] as const;

  for (let i = 0; i < nombres.length; i++) {
    const nombre = nombres[i];
    const telefono = randomPhone();
    const diasDesdeUltimaVisita = randomInt(0, 60);
    const etiqueta = diasDesdeUltimaVisita > 45 ? 'INACTIVO' : randomItem([...etiquetas]);
    const sellosActuales = randomInt(0, 10);

    const cliente = await prisma.cliente.create({
      data: {
        negocioId,
        nombre,
        telefono,
        aceptaNotificaciones: Math.random() > 0.3,
        tienePwaInstalada: Math.random() > 0.5,
        sellosActuales,
        totalVisitas: randomInt(1, 30),
        premiosCanjeados: randomInt(0, 3),
        etiqueta,
        ultimaVisita: daysAgo(diasDesdeUltimaVisita),
        creadoEn: daysAgo(randomInt(30, 365)),
      },
    });

    // Crear tarjeta en la sucursal principal
    await prisma.tarjetaClienteSucursal.create({
      data: {
        clienteId: cliente.id,
        sucursalId: sucursalCentroId,
        sellosActuales,
        totalVisitas: cliente.totalVisitas,
        ultimaVisita: cliente.ultimaVisita,
      },
    });

    // Algunos clientes también tienen tarjeta en Norte
    if (Math.random() > 0.6) {
      await prisma.tarjetaClienteSucursal.create({
        data: {
          clienteId: cliente.id,
          sucursalId: sucursalNorteId,
          sellosActuales: randomInt(0, 8),
          totalVisitas: randomInt(1, 10),
          ultimaVisita: daysAgo(randomInt(0, 45)),
        },
      });
    }
  }

  console.log(`✅ ${nombres.length} clientes creados con tarjetas por sucursal`);
}

// ============================================================================
// SEED DE USO MENSUAL
// ============================================================================

async function seedUsoMensual(negocioId: string, sucursalCentroId: string) {
  console.log('🌱 Seeding UsoMensual...');

  const periodo = new Date().toISOString().slice(0, 7); // "2025-01"

  const conteos = {
    CLIENTES: await prisma.cliente.count({ where: { negocioId } }),
    EMPLEADOS: await prisma.empleado.count({ where: { negocioId, activo: true } }),
    SUCURSALES: await prisma.sucursal.count({ where: { negocioId, activa: true } }),
    ITEMS_CARTA: await prisma.itemCarta.count({ where: { negocioId } }),
    PEDIDOS_MES: await prisma.pedido.count({ where: { negocioId } }),
    CAMPANAS_PUSH_MES: await prisma.campanaMarketing.count({ where: { negocioId, canal: 'PUSH' } }),
  };

  const limitesBase: Record<string, number> = {
    CLIENTES: 5000,
    EMPLEADOS: 20,
    SUCURSALES: 999999,
    ITEMS_CARTA: 999999,
    PEDIDOS_MES: 999999,
    CAMPANAS_PUSH_MES: 999999,
  };

  for (const [recurso, cantidad] of Object.entries(conteos)) {
    const limiteBase = limitesBase[recurso];
    // BUGFIX: el unique compuesto (negocioId, sucursalId, recurso, periodo) incluye
    // sucursalId nullable; Prisma no acepta `null` en el `where` de un unique compuesto.
    // Para el agregado a nivel negocio (sucursalId = null) usamos findFirst + update/create.
    const existente = await prisma.usoMensual.findFirst({
      where: { negocioId, sucursalId: null, recurso: recurso as any, periodo },
    });
    if (existente) {
      await prisma.usoMensual.update({
        where: { id: existente.id },
        data: { cantidad, limiteBase },
      });
    } else {
      await prisma.usoMensual.create({
        data: {
          negocioId,
          sucursalId: null,
          recurso: recurso as any,
          periodo,
          cantidad,
          limiteBase,
          limiteGracia: limiteBase + 50,
          estado: 'NORMAL',
        },
      });
    }
  }

  console.log(`✅ UsoMensual del período ${periodo} creado`);
}

// ============================================================================
// SEED DE TURNOS
// ============================================================================

async function seedTurnos(
  negocioId: string,
  sucursalCentroId: string,
  sucursalNorteId: string,
  empleados: { encargado: any; cajero: any; mesero: any },
) {
  console.log('🌱 Seeding Turnos...');

  const hoy = new Date();
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  lunes.setHours(0, 0, 0, 0);

  const turnosData: any[] = [];

  for (let i = 0; i < 7; i++) {
    const fecha = new Date(lunes);
    fecha.setDate(lunes.getDate() + i);

    // Encargado en Centro (lunes a viernes)
    if (i < 5) {
      turnosData.push({
        negocioId,
        sucursalId: sucursalCentroId,
        empleadoId: empleados.encargado.id,
        fecha,
        horaInicio: '09:00',
        horaFin: '17:00',
        tipoTurno: 'ENCARGADO',
      });
    }

    // Cajero en Centro (miércoles a domingo)
    if (i >= 2) {
      turnosData.push({
        negocioId,
        sucursalId: sucursalCentroId,
        empleadoId: empleados.cajero.id,
        fecha,
        horaInicio: '17:00',
        horaFin: '23:00',
        tipoTurno: 'CAJERO',
      });
    }

    // Mesero en Norte (todos los días)
    turnosData.push({
      negocioId,
      sucursalId: sucursalNorteId,
      empleadoId: empleados.mesero.id,
      fecha,
      horaInicio: '18:00',
      horaFin: '00:00',
      tipoTurno: 'MESERO',
    });
  }

  for (const t of turnosData) {
    try {
      await prisma.turno.create({ data: t });
    } catch (e) {
      // Ignorar duplicados
    }
  }

  // Crear encargado del día para hoy
  const hoyFecha = new Date();
  hoyFecha.setHours(0, 0, 0, 0);

  await prisma.encargadoDia.upsert({
    where: {
      negocioId_sucursalId_fecha: {
        negocioId,
        sucursalId: sucursalCentroId,
        fecha: hoyFecha,
      },
    },
    update: {},
    create: {
      negocioId,
      sucursalId: sucursalCentroId,
      empleadoId: empleados.encargado.id,
      fecha: hoyFecha,
    },
  });

  console.log(`✅ ${turnosData.length} turnos creados + encargado del día`);
}

// ============================================================================
// SEED DE VISITAS HISTÓRICAS
// ============================================================================

async function seedVisitas(
  negocioId: string,
  sucursalCentroId: string,
  empleadoId: string,
) {
  console.log('🌱 Seeding Visitas históricas...');

  const clientes = await prisma.cliente.findMany({
    where: { negocioId },
    take: 10,
  });

  let total = 0;

  for (const cliente of clientes) {
    const numVisitas = randomInt(1, 8);
    for (let i = 0; i < numVisitas; i++) {
      const diasAtras = randomInt(1, 60);
      await prisma.visita.create({
        data: {
          negocioId,
          sucursalId: sucursalCentroId,
          clienteId: cliente.id,
          empleadoId,
          tipo: 'VISITA',
          sellosOtorgados: 1,
          metodo: 'QR_ESTATICO',
          origen: randomItem(['mesa-1', 'mesa-3', 'barra']),
          aprobadoEn: daysAgo(diasAtras),
        },
      });
      total++;
    }
  }

  console.log(`✅ ${total} visitas históricas creadas`);
}

// ============================================================================
// SEED DE PEDIDOS HISTÓRICOS
// ============================================================================

async function seedPedidos(
  negocioId: string,
  sucursalCentroId: string,
  itemsCreados: any[],
) {
  console.log('🌱 Seeding Pedidos históricos...');

  const estados = ['ENTREGADO', 'ENTREGADO', 'ENTREGADO', 'CANCELADO', 'PENDIENTE'] as const;
  const tipos = [TipoPedido.MESA, TipoPedido.TAKEAWAY, TipoPedido.DELIVERY] as const;
  const modosPago = [ModoPago.EFECTIVO, ModoPago.TRANSFERENCIA, ModoPago.MERCADO_PAGO] as const;

  let total = 0;

  for (let i = 0; i < 25; i++) {
    const tipo = randomItem([...tipos]);
    const estado = randomItem([...estados]);
    const itemsPedido = [];
    let subtotal = 0;

    const numItems = randomInt(1, 4);
    for (let j = 0; j < numItems; j++) {
      const item = randomItem(itemsCreados);
      const cantidad = randomInt(1, 3);
      const precio = Number(item.precio);
      const itemSubtotal = precio * cantidad;
      subtotal += itemSubtotal;

      itemsPedido.push({
        itemId: item.id,
        nombre: item.nombre,
        precioBase: precio,
        precioFinal: precio,
        cantidad,
        modificadores: [],
        subtotal: itemSubtotal,
      });
    }

    const costoEnvio = tipo === TipoPedido.DELIVERY ? 500 : 0;
    const totalPedido = subtotal + costoEnvio;

    await prisma.pedido.create({
      data: {
        negocioId,
        sucursalId: sucursalCentroId,
        nombreCliente: `Cliente Test ${i + 1}`,
        telefono: randomPhone(),
        direccion: tipo === TipoPedido.DELIVERY ? 'Av. Test 123' : null,
        tipo,
        modoPago: randomItem([...modosPago]),
        items: itemsPedido,
        subtotal,
        costoEnvio: costoEnvio || null,
        total: totalPedido,
        estado,
        numeroAtendiente: '+5491199998888',
        creadoEn: daysAgo(randomInt(1, 30)),
        confirmadoEn: estado !== 'PENDIENTE' ? daysAgo(randomInt(0, 29)) : null,
        entregadoEn: estado === 'ENTREGADO' ? daysAgo(randomInt(0, 29)) : null,
      },
    });
    total++;
  }

  console.log(`✅ ${total} pedidos históricos creados`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('🚀 Iniciando seed...\n');

  // 1. PlanFeatures (idempotente)
  await seedPlanFeatures();

  // 2. SuperAdmin (idempotente)
  await seedSuperAdmin();

  // 3. Negocio completo (idempotente)
  const datos = await seedNegocioCompleto();

  if (datos) {
    // 4. Carta
    const itemsCreados = await seedCarta(datos.negocio.id, datos.sucursalNorte.id);

    // 5. Modificadores
    await seedModificadores(datos.negocio.id, itemsCreados);

    // 6. Upsell
    await seedUpsell(datos.negocio.id, itemsCreados);

    // 7. Clientes
    await seedClientes(datos.negocio.id, datos.sucursalCentro.id, datos.sucursalNorte.id);

    // 8. Uso mensual
    await seedUsoMensual(datos.negocio.id, datos.sucursalCentro.id);

    // 9. Turnos
    await seedTurnos(
      datos.negocio.id,
      datos.sucursalCentro.id,
      datos.sucursalNorte.id,
      { encargado: datos.encargado, cajero: datos.cajero, mesero: datos.mesero },
    );

    // 10. Visitas
    await seedVisitas(datos.negocio.id, datos.sucursalCentro.id, datos.encargado.id);

    // 11. Pedidos
    await seedPedidos(datos.negocio.id, datos.sucursalCentro.id, itemsCreados);
  }

  console.log('\n✨ Seed completado exitosamente\n');

  console.log('📋 Datos de acceso:');
  console.log('   Super-admin: admin@fideliza.app / admin123456 (2FA en consola)');
  console.log('   Dueño:       carlos@barlaesquina.com / dueno123456');
  console.log('   Encargado:   PIN 1111');
  console.log('   Cajero:      PIN 2222');
  console.log('   Mesero:      PIN 3333');
  console.log('');
  console.log('🏢 Negocio: Bar La Esquina (bar-la-esquina)');
  console.log('   Sucursales: Centro (principal), Norte');
  console.log('   Menú activo: Sí');
  console.log('   Plan: PRO');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
