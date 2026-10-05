-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'BASIC', 'PRO');

-- CreateEnum
CREATE TYPE "RolEmpleado" AS ENUM ('DUENO', 'ENCARGADO', 'CAJERO', 'MESERO', 'DELIVERY', 'EMPLEADO');

-- CreateEnum
CREATE TYPE "ModoFidelizacion" AS ENUM ('SOLO_VISITAS', 'SOLO_PUNTOS', 'HIBRIDO');

-- CreateEnum
CREATE TYPE "EtiquetaCliente" AS ENUM ('NUEVO', 'REGULAR', 'VIP', 'INACTIVO');

-- CreateEnum
CREATE TYPE "TipoVisita" AS ENUM ('VISITA', 'PUNTOS', 'REGALO_MANUAL');

-- CreateEnum
CREATE TYPE "MetodoVisita" AS ENUM ('QR_ESTATICO', 'QR_DINAMICO', 'MANUAL');

-- CreateEnum
CREATE TYPE "CanalCampana" AS ENUM ('PUSH', 'WHATSAPP', 'AMBOS');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENVIADO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "TipoPedido" AS ENUM ('MESA', 'TAKEAWAY', 'DELIVERY');

-- CreateEnum
CREATE TYPE "ModoPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'TARJETA');

-- CreateEnum
CREATE TYPE "TipoModificador" AS ENUM ('UNICA_SELECCION', 'MULTIPLE_SELECCION');

-- CreateEnum
CREATE TYPE "ModoAsignacionPedidos" AS ENUM ('BROADCAST', 'POR_ROL', 'SOLO_ENCARGADO');

-- CreateEnum
CREATE TYPE "TipoTurno" AS ENUM ('ENCARGADO', 'CAJERO', 'MESERO', 'DELIVERY', 'EMPLEADO');

-- CreateEnum
CREATE TYPE "ModoClientes" AS ENUM ('GLOBAL', 'POR_SUCURSAL');

-- CreateEnum
CREATE TYPE "RecursoLimitado" AS ENUM ('CLIENTES', 'EMPLEADOS', 'SUCURSALES', 'ITEMS_CARTA', 'PEDIDOS_MES', 'CAMPANAS_PUSH_MES');

-- CreateEnum
CREATE TYPE "EstadoUso" AS ENUM ('NORMAL', 'ADVERTENCIA', 'EXCEDIDO');

-- CreateEnum
CREATE TYPE "EstadoSuscripcion" AS ENUM ('ACTIVA', 'PAUSADA', 'CANCELADA', 'VENCIDA', 'TRIAL');

-- CreateEnum
CREATE TYPE "EstadoLead" AS ENUM ('NUEVO', 'CONTACTADO', 'DEMO_AGENDADA', 'NEGOCIACION', 'CONVERTIDO', 'PERDIDO', 'ARCHIVADO');

-- CreateTable
CREATE TABLE "Negocio" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cuit" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "colorPrimario" TEXT NOT NULL DEFAULT '#000000',
    "colorSecundario" TEXT NOT NULL DEFAULT '#FFFFFF',
    "placeId" TEXT,
    "urlMenu" TEXT,
    "urlClub" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "modoClientes" "ModoClientes" NOT NULL DEFAULT 'GLOBAL',
    "payPerUseActivo" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "Negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sucursal" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "direccion" TEXT,
    "telefono" TEXT,
    "numeroAtendiente" TEXT,
    "colorPrimario" TEXT,
    "colorSecundario" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracionClub" (
    "beneficioCumpleanosActivo" BOOLEAN NOT NULL DEFAULT true,
    "descripcionBeneficioCumpleanos" TEXT DEFAULT 'Premio especial en tu cumpleaños',
    "diasValidezCumpleanos" INTEGER NOT NULL DEFAULT 7,
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "modoFidelizacion" "ModoFidelizacion" NOT NULL DEFAULT 'SOLO_VISITAS',
    "sellosParaPremio" INTEGER NOT NULL DEFAULT 10,
    "premioTexto" TEXT NOT NULL,
    "sellosBienvenida" INTEGER NOT NULL DEFAULT 1,
    "limiteVisitasPorDia" INTEGER NOT NULL DEFAULT 1,
    "horasMinimasEntreVisitas" INTEGER NOT NULL DEFAULT 4,
    "puntosPorPeso" DECIMAL(10,2),
    "premioPorPuntos" INTEGER,
    "requiereValidacionEmpleado" BOOLEAN NOT NULL DEFAULT true,
    "permiteRegaloManual" BOOLEAN NOT NULL DEFAULT true,
    "mensajeBienvenida" TEXT,
    "mostrarResenaPostVisita" BOOLEAN NOT NULL DEFAULT true,
    "permitirOverrideSucursal" BOOLEAN NOT NULL DEFAULT true,
    "colchonGraciaDefault" INTEGER NOT NULL DEFAULT 50,
    "menuActivo" BOOLEAN NOT NULL DEFAULT false,
    "tiposPedidoHabilitados" "TipoPedido"[] DEFAULT ARRAY['MESA']::"TipoPedido"[],
    "modosPagoHabilitados" "ModoPago"[] DEFAULT ARRAY['EFECTIVO']::"ModoPago"[],
    "costoEnvio" DECIMAL(10,2),
    "pedidoMinimoDelivery" DECIMAL(10,2),
    "zonaEntrega" TEXT,
    "modoPagoPorDefecto" "ModoPago" NOT NULL DEFAULT 'EFECTIVO',
    "tipoPedidoPorDefecto" "TipoPedido" NOT NULL DEFAULT 'MESA',
    "forzarTakeawaySiNoHayMesas" BOOLEAN NOT NULL DEFAULT true,
    "numeroAtendiente" TEXT,
    "usarNumeroAtendienteDistinto" BOOLEAN NOT NULL DEFAULT false,
    "modoAsignacionPedidos" "ModoAsignacionPedidos" NOT NULL DEFAULT 'BROADCAST',
    "transferenciaAlias" TEXT,
    "transferenciaCbu" TEXT,
    "transferenciaTitular" TEXT,
    "transferenciaBanco" TEXT,
    "transferenciaNotas" TEXT,
    "linkMercadoPago" TEXT,
    "upsellActivo" BOOLEAN NOT NULL DEFAULT true,
    "upsellMaxSugerencias" INTEGER NOT NULL DEFAULT 3,
    "turnosActivos" BOOLEAN NOT NULL DEFAULT false,
    "checkinObligatorio" BOOLEAN NOT NULL DEFAULT false,
    "duplicarSemanaAuto" BOOLEAN NOT NULL DEFAULT false,
    "pushInactividad3Dias" BOOLEAN NOT NULL DEFAULT true,
    "pushCumpleanos" BOOLEAN NOT NULL DEFAULT false,
    "pushPremioPorVencer" BOOLEAN NOT NULL DEFAULT true,
    "pushAUnoDelPremio" BOOLEAN NOT NULL DEFAULT true,
    "pushInactivos30Dias" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionClub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracionSucursal" (
    "id" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "premioTexto" TEXT,
    "sellosParaPremio" INTEGER,
    "sellosBienvenida" INTEGER,
    "limiteVisitasPorDia" INTEGER,
    "horasMinimasEntreVisitas" INTEGER,
    "tiposPedidoHabilitados" "TipoPedido"[],
    "modosPagoHabilitados" "ModoPago"[],
    "costoEnvio" DECIMAL(10,2),
    "pedidoMinimoDelivery" DECIMAL(10,2),
    "zonaEntrega" TEXT,
    "transferenciaAlias" TEXT,
    "transferenciaCbu" TEXT,
    "transferenciaTitular" TEXT,
    "transferenciaBanco" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracionSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empleado" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "RolEmpleado" NOT NULL DEFAULT 'EMPLEADO',
    "pinHash" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificado" BOOLEAN NOT NULL DEFAULT false,
    "telefono" TEXT,
    "avatarUrl" TEXT,
    "accesoMultiSucursal" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoAcceso" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "Empleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesionEmpleado" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SesionEmpleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesionDueno" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SesionDueno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroAcceso" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "exitoso" BOOLEAN NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistroAcceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "email" TEXT,
    "fechaNacimiento" TIMESTAMP(3),
    "aceptaNotificaciones" BOOLEAN NOT NULL DEFAULT false,
    "tienePwaInstalada" BOOLEAN NOT NULL DEFAULT false,
    "sellosActuales" INTEGER NOT NULL DEFAULT 0,
    "puntosActuales" INTEGER NOT NULL DEFAULT 0,
    "totalVisitas" INTEGER NOT NULL DEFAULT 0,
    "premiosCanjeados" INTEGER NOT NULL DEFAULT 0,
    "etiqueta" "EtiquetaCliente" NOT NULL DEFAULT 'NUEVO',
    "notasInternas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaVisita" TIMESTAMP(3),

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispositivoCliente" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "fingerprint" TEXT,
    "cookieToken" TEXT,
    "userAgent" TEXT NOT NULL,
    "ipRegistro" TEXT,
    "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispositivoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TarjetaClienteSucursal" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "sellosActuales" INTEGER NOT NULL DEFAULT 0,
    "puntosActuales" INTEGER NOT NULL DEFAULT 0,
    "totalVisitas" INTEGER NOT NULL DEFAULT 0,
    "premiosCanjeados" INTEGER NOT NULL DEFAULT 0,
    "ultimaVisita" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TarjetaClienteSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visita" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "tipo" "TipoVisita" NOT NULL,
    "sellosOtorgados" INTEGER NOT NULL DEFAULT 1,
    "puntosOtorgados" INTEGER NOT NULL DEFAULT 0,
    "montoConsumido" DECIMAL(10,2),
    "aprobadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodo" "MetodoVisita" NOT NULL,
    "origen" TEXT,
    "notas" TEXT,

    CONSTRAINT "Visita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenValidacion" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenValidacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCarta" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precio" DECIMAL(10,2) NOT NULL,
    "fotoUrl" TEXT,
    "etiquetas" TEXT[],
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCarta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCartaSucursal" (
    "id" TEXT NOT NULL,
    "itemCartaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "precio" DECIMAL(10,2),
    "disponible" BOOLEAN,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCartaSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrupoModificador" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" "TipoModificador" NOT NULL DEFAULT 'UNICA_SELECCION',
    "obligatorio" BOOLEAN NOT NULL DEFAULT false,
    "minSelecciones" INTEGER NOT NULL DEFAULT 0,
    "maxSelecciones" INTEGER,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrupoModificador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpcionModificador" (
    "id" TEXT NOT NULL,
    "grupoModificadorId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precioExtra" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpcionModificador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReglaUpsell" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "prioridad" INTEGER NOT NULL DEFAULT 0,
    "mensaje" TEXT NOT NULL,
    "itemOrigenId" TEXT,
    "categoriaOrigen" TEXT,
    "itemDestinoId" TEXT NOT NULL,
    "maxVeces" INTEGER,
    "soloUnaVez" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReglaUpsell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "clienteId" TEXT,
    "nombreCliente" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "direccion" TEXT,
    "origen" TEXT,
    "mesa" TEXT,
    "tipo" "TipoPedido" NOT NULL,
    "modoPago" "ModoPago" NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "costoEnvio" DECIMAL(10,2),
    "total" DECIMAL(10,2) NOT NULL,
    "notas" TEXT,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'PENDIENTE',
    "motivoRechazo" TEXT,
    "empleadoAsignadoId" TEXT,
    "encargadoId" TEXT,
    "numeroAtendiente" TEXT,
    "linkToken" TEXT,
    "linkExpiraEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "confirmadoEn" TIMESTAMP(3),
    "enviadoEn" TIMESTAMP(3),
    "entregadoEn" TIMESTAMP(3),

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turno" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "tipoTurno" "TipoTurno" NOT NULL,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncargadoDia" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncargadoDia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinTurno" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "turnoId" TEXT,
    "checkinEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkoutEn" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "notas" TEXT,

    CONSTRAINT "CheckinTurno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResenaGoogle" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "autorNombre" TEXT NOT NULL,
    "autorFotoUrl" TEXT,
    "estrellas" INTEGER NOT NULL,
    "texto" TEXT,
    "fechaResena" TIMESTAMP(3) NOT NULL,
    "respondida" BOOLEAN NOT NULL DEFAULT false,
    "respuestaTexto" TEXT,
    "respuestaEmpleadoId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResenaGoogle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegracionGoogle" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "googleAccountId" TEXT,
    "googleLocationId" TEXT,
    "googleAccountName" TEXT,
    "googleLocationName" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'CONECTADO',
    "conectadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegracionGoogle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificacionPush" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificacionPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificacionPushEmpleado" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificacionPushEmpleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampanaMarketing" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "url" TEXT,
    "icono" TEXT,
    "segmento" TEXT NOT NULL,
    "canal" "CanalCampana" NOT NULL DEFAULT 'PUSH',
    "esAutomatizacion" BOOLEAN NOT NULL DEFAULT false,
    "enviadaEn" TIMESTAMP(3),
    "totalEnviados" INTEGER NOT NULL DEFAULT 0,
    "totalFallidos" INTEGER NOT NULL DEFAULT 0,
    "totalAbiertos" INTEGER NOT NULL DEFAULT 0,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampanaMarketing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "feature" TEXT NOT NULL,
    "habilitada" BOOLEAN NOT NULL DEFAULT false,
    "limite" INTEGER,
    "metadata" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsoMensual" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "sucursalId" TEXT,
    "recurso" "RecursoLimitado" NOT NULL,
    "periodo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "limiteBase" INTEGER NOT NULL,
    "limiteGracia" INTEGER NOT NULL,
    "estado" "EstadoUso" NOT NULL DEFAULT 'NORMAL',
    "payPerUse" BOOLEAN NOT NULL DEFAULT false,
    "excedente" INTEGER NOT NULL DEFAULT 0,
    "notificado100" BOOLEAN NOT NULL DEFAULT false,
    "notificado150" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsoMensual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "nombreNegocio" TEXT NOT NULL,
    "nombreContacto" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "tipoNegocio" TEXT NOT NULL,
    "ciudad" TEXT,
    "cantidadSucursales" INTEGER NOT NULL DEFAULT 1,
    "planInteresado" "Plan" NOT NULL DEFAULT 'FREE',
    "mensaje" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'landing',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "estado" "EstadoLead" NOT NULL DEFAULT 'NUEVO',
    "asignadoA" TEXT,
    "notasInternas" TEXT,
    "negocioId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "contactadoEn" TIMESTAMP(3),
    "convertidoEn" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoAcceso" TIMESTAMP(3),

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesionSuperAdmin" (
    "id" TEXT NOT NULL,
    "superAdminId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SesionSuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suscripcion" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "estado" "EstadoSuscripcion" NOT NULL DEFAULT 'ACTIVA',
    "precioMensual" DECIMAL(10,2),
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "fechaInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaProximoPago" TIMESTAMP(3),
    "fechaCancelacion" TIMESTAMP(3),
    "metodoPago" TEXT,
    "externalId" TEXT,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suscripcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Impersonacion" (
    "id" TEXT NOT NULL,
    "superAdminId" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "ip" TEXT,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Impersonacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComunicacionMasiva" (
    "id" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "destinatarios" JSONB NOT NULL,
    "totalEnviados" INTEGER NOT NULL DEFAULT 0,
    "totalFallidos" INTEGER NOT NULL DEFAULT 0,
    "enviadaEn" TIMESTAMP(3),
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComunicacionMasiva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoAuditoria" (
    "id" TEXT NOT NULL,
    "negocioId" TEXT NOT NULL,
    "empleadoId" TEXT,
    "clienteId" TEXT,
    "accion" TEXT NOT NULL,
    "detalle" JSONB,
    "ip" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoAuditoriaSuperAdmin" (
    "id" TEXT NOT NULL,
    "superAdminId" TEXT NOT NULL,
    "negocioId" TEXT,
    "accion" TEXT NOT NULL,
    "detalle" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoAuditoriaSuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "procesadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ItemCartaGrupoModificador" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Negocio_slug_key" ON "Negocio"("slug");

-- CreateIndex
CREATE INDEX "Negocio_slug_activo_idx" ON "Negocio"("slug", "activo");

-- CreateIndex
CREATE INDEX "Negocio_plan_idx" ON "Negocio"("plan");

-- CreateIndex
CREATE INDEX "Sucursal_negocioId_activa_idx" ON "Sucursal"("negocioId", "activa");

-- CreateIndex
CREATE INDEX "Sucursal_negocioId_esPrincipal_idx" ON "Sucursal"("negocioId", "esPrincipal");

-- CreateIndex
CREATE UNIQUE INDEX "Sucursal_negocioId_slug_key" ON "Sucursal"("negocioId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionClub_negocioId_key" ON "ConfiguracionClub"("negocioId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionSucursal_sucursalId_key" ON "ConfiguracionSucursal"("sucursalId");

-- CreateIndex
CREATE INDEX "Empleado_negocioId_rol_activo_idx" ON "Empleado"("negocioId", "rol", "activo");

-- CreateIndex
CREATE INDEX "Empleado_negocioId_sucursalId_activo_idx" ON "Empleado"("negocioId", "sucursalId", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "Empleado_negocioId_email_key" ON "Empleado"("negocioId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Empleado_negocioId_pinHash_key" ON "Empleado"("negocioId", "pinHash");

-- CreateIndex
CREATE UNIQUE INDEX "SesionEmpleado_token_key" ON "SesionEmpleado"("token");

-- CreateIndex
CREATE INDEX "SesionEmpleado_token_idx" ON "SesionEmpleado"("token");

-- CreateIndex
CREATE INDEX "SesionEmpleado_expiraEn_idx" ON "SesionEmpleado"("expiraEn");

-- CreateIndex
CREATE INDEX "SesionEmpleado_empleadoId_idx" ON "SesionEmpleado"("empleadoId");

-- CreateIndex
CREATE UNIQUE INDEX "SesionDueno_token_key" ON "SesionDueno"("token");

-- CreateIndex
CREATE UNIQUE INDEX "SesionDueno_refreshToken_key" ON "SesionDueno"("refreshToken");

-- CreateIndex
CREATE INDEX "SesionDueno_empleadoId_expiraEn_idx" ON "SesionDueno"("empleadoId", "expiraEn");

-- CreateIndex
CREATE INDEX "SesionDueno_refreshToken_idx" ON "SesionDueno"("refreshToken");

-- CreateIndex
CREATE INDEX "RegistroAcceso_empleadoId_creadoEn_idx" ON "RegistroAcceso"("empleadoId", "creadoEn");

-- CreateIndex
CREATE INDEX "Cliente_negocioId_ultimaVisita_idx" ON "Cliente"("negocioId", "ultimaVisita");

-- CreateIndex
CREATE INDEX "Cliente_negocioId_etiqueta_idx" ON "Cliente"("negocioId", "etiqueta");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_negocioId_telefono_key" ON "Cliente"("negocioId", "telefono");

-- CreateIndex
CREATE INDEX "DispositivoCliente_deviceId_idx" ON "DispositivoCliente"("deviceId");

-- CreateIndex
CREATE INDEX "DispositivoCliente_fingerprint_idx" ON "DispositivoCliente"("fingerprint");

-- CreateIndex
CREATE INDEX "DispositivoCliente_cookieToken_idx" ON "DispositivoCliente"("cookieToken");

-- CreateIndex
CREATE INDEX "DispositivoCliente_clienteId_idx" ON "DispositivoCliente"("clienteId");

-- CreateIndex
CREATE INDEX "TarjetaClienteSucursal_sucursalId_ultimaVisita_idx" ON "TarjetaClienteSucursal"("sucursalId", "ultimaVisita");

-- CreateIndex
CREATE UNIQUE INDEX "TarjetaClienteSucursal_clienteId_sucursalId_key" ON "TarjetaClienteSucursal"("clienteId", "sucursalId");

-- CreateIndex
CREATE INDEX "Visita_negocioId_sucursalId_aprobadoEn_idx" ON "Visita"("negocioId", "sucursalId", "aprobadoEn");

-- CreateIndex
CREATE INDEX "Visita_negocioId_clienteId_aprobadoEn_idx" ON "Visita"("negocioId", "clienteId", "aprobadoEn");

-- CreateIndex
CREATE INDEX "Visita_clienteId_aprobadoEn_idx" ON "Visita"("clienteId", "aprobadoEn");

-- CreateIndex
CREATE INDEX "Visita_empleadoId_aprobadoEn_idx" ON "Visita"("empleadoId", "aprobadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "TokenValidacion_token_key" ON "TokenValidacion"("token");

-- CreateIndex
CREATE INDEX "TokenValidacion_token_idx" ON "TokenValidacion"("token");

-- CreateIndex
CREATE INDEX "TokenValidacion_expiraEn_idx" ON "TokenValidacion"("expiraEn");

-- CreateIndex
CREATE INDEX "TokenValidacion_usado_idx" ON "TokenValidacion"("usado");

-- CreateIndex
CREATE INDEX "ItemCarta_negocioId_categoria_orden_idx" ON "ItemCarta"("negocioId", "categoria", "orden");

-- CreateIndex
CREATE INDEX "ItemCarta_negocioId_disponible_idx" ON "ItemCarta"("negocioId", "disponible");

-- CreateIndex
CREATE UNIQUE INDEX "ItemCartaSucursal_itemCartaId_sucursalId_key" ON "ItemCartaSucursal"("itemCartaId", "sucursalId");

-- CreateIndex
CREATE INDEX "GrupoModificador_negocioId_orden_idx" ON "GrupoModificador"("negocioId", "orden");

-- CreateIndex
CREATE INDEX "OpcionModificador_grupoModificadorId_orden_idx" ON "OpcionModificador"("grupoModificadorId", "orden");

-- CreateIndex
CREATE INDEX "ReglaUpsell_negocioId_activa_prioridad_idx" ON "ReglaUpsell"("negocioId", "activa", "prioridad");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_linkToken_key" ON "Pedido"("linkToken");

-- CreateIndex
CREATE INDEX "Pedido_negocioId_sucursalId_estado_creadoEn_idx" ON "Pedido"("negocioId", "sucursalId", "estado", "creadoEn");

-- CreateIndex
CREATE INDEX "Pedido_negocioId_telefono_idx" ON "Pedido"("negocioId", "telefono");

-- CreateIndex
CREATE INDEX "Pedido_negocioId_tipo_creadoEn_idx" ON "Pedido"("negocioId", "tipo", "creadoEn");

-- CreateIndex
CREATE INDEX "Pedido_linkToken_linkExpiraEn_idx" ON "Pedido"("linkToken", "linkExpiraEn");

-- CreateIndex
CREATE INDEX "Pedido_empleadoAsignadoId_creadoEn_idx" ON "Pedido"("empleadoAsignadoId", "creadoEn");

-- CreateIndex
CREATE INDEX "Turno_negocioId_sucursalId_fecha_idx" ON "Turno"("negocioId", "sucursalId", "fecha");

-- CreateIndex
CREATE INDEX "Turno_empleadoId_fecha_idx" ON "Turno"("empleadoId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Turno_negocioId_empleadoId_fecha_horaInicio_key" ON "Turno"("negocioId", "empleadoId", "fecha", "horaInicio");

-- CreateIndex
CREATE INDEX "EncargadoDia_negocioId_sucursalId_fecha_idx" ON "EncargadoDia"("negocioId", "sucursalId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "EncargadoDia_negocioId_sucursalId_fecha_key" ON "EncargadoDia"("negocioId", "sucursalId", "fecha");

-- CreateIndex
CREATE INDEX "CheckinTurno_negocioId_sucursalId_empleadoId_checkinEn_idx" ON "CheckinTurno"("negocioId", "sucursalId", "empleadoId", "checkinEn");

-- CreateIndex
CREATE INDEX "CheckinTurno_negocioId_checkoutEn_idx" ON "CheckinTurno"("negocioId", "checkoutEn");

-- CreateIndex
CREATE INDEX "ResenaGoogle_negocioId_fechaResena_idx" ON "ResenaGoogle"("negocioId", "fechaResena");

-- CreateIndex
CREATE INDEX "ResenaGoogle_negocioId_estrellas_idx" ON "ResenaGoogle"("negocioId", "estrellas");

-- CreateIndex
CREATE UNIQUE INDEX "ResenaGoogle_negocioId_reviewId_key" ON "ResenaGoogle"("negocioId", "reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegracionGoogle_negocioId_key" ON "IntegracionGoogle"("negocioId");

-- CreateIndex
CREATE INDEX "IntegracionGoogle_negocioId_idx" ON "IntegracionGoogle"("negocioId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificacionPush_endpoint_key" ON "NotificacionPush"("endpoint");

-- CreateIndex
CREATE INDEX "NotificacionPush_negocioId_clienteId_idx" ON "NotificacionPush"("negocioId", "clienteId");

-- CreateIndex
CREATE INDEX "NotificacionPush_activa_ultimoUso_idx" ON "NotificacionPush"("activa", "ultimoUso");

-- CreateIndex
CREATE UNIQUE INDEX "NotificacionPushEmpleado_endpoint_key" ON "NotificacionPushEmpleado"("endpoint");

-- CreateIndex
CREATE INDEX "NotificacionPushEmpleado_negocioId_empleadoId_idx" ON "NotificacionPushEmpleado"("negocioId", "empleadoId");

-- CreateIndex
CREATE INDEX "NotificacionPushEmpleado_activa_ultimoUso_idx" ON "NotificacionPushEmpleado"("activa", "ultimoUso");

-- CreateIndex
CREATE INDEX "CampanaMarketing_negocioId_enviadaEn_idx" ON "CampanaMarketing"("negocioId", "enviadaEn");

-- CreateIndex
CREATE INDEX "CampanaMarketing_negocioId_esAutomatizacion_idx" ON "CampanaMarketing"("negocioId", "esAutomatizacion");

-- CreateIndex
CREATE INDEX "PlanFeature_plan_habilitada_idx" ON "PlanFeature"("plan", "habilitada");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_plan_feature_key" ON "PlanFeature"("plan", "feature");

-- CreateIndex
CREATE INDEX "UsoMensual_negocioId_periodo_idx" ON "UsoMensual"("negocioId", "periodo");

-- CreateIndex
CREATE INDEX "UsoMensual_recurso_periodo_estado_idx" ON "UsoMensual"("recurso", "periodo", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "UsoMensual_negocioId_sucursalId_recurso_periodo_key" ON "UsoMensual"("negocioId", "sucursalId", "recurso", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_negocioId_key" ON "Lead"("negocioId");

-- CreateIndex
CREATE INDEX "Lead_estado_creadoEn_idx" ON "Lead"("estado", "creadoEn");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_planInteresado_idx" ON "Lead"("planInteresado");

-- CreateIndex
CREATE INDEX "Lead_origen_creadoEn_idx" ON "Lead"("origen", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- CreateIndex
CREATE INDEX "SuperAdmin_email_idx" ON "SuperAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SesionSuperAdmin_token_key" ON "SesionSuperAdmin"("token");

-- CreateIndex
CREATE UNIQUE INDEX "SesionSuperAdmin_refreshToken_key" ON "SesionSuperAdmin"("refreshToken");

-- CreateIndex
CREATE INDEX "SesionSuperAdmin_superAdminId_expiraEn_idx" ON "SesionSuperAdmin"("superAdminId", "expiraEn");

-- CreateIndex
CREATE INDEX "SesionSuperAdmin_refreshToken_idx" ON "SesionSuperAdmin"("refreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "Suscripcion_negocioId_key" ON "Suscripcion"("negocioId");

-- CreateIndex
CREATE INDEX "Suscripcion_estado_fechaProximoPago_idx" ON "Suscripcion"("estado", "fechaProximoPago");

-- CreateIndex
CREATE INDEX "Suscripcion_plan_idx" ON "Suscripcion"("plan");

-- CreateIndex
CREATE UNIQUE INDEX "Impersonacion_token_key" ON "Impersonacion"("token");

-- CreateIndex
CREATE INDEX "Impersonacion_superAdminId_creadoEn_idx" ON "Impersonacion"("superAdminId", "creadoEn");

-- CreateIndex
CREATE INDEX "Impersonacion_negocioId_creadoEn_idx" ON "Impersonacion"("negocioId", "creadoEn");

-- CreateIndex
CREATE INDEX "Impersonacion_token_idx" ON "Impersonacion"("token");

-- CreateIndex
CREATE INDEX "ComunicacionMasiva_enviadaEn_idx" ON "ComunicacionMasiva"("enviadaEn");

-- CreateIndex
CREATE INDEX "EventoAuditoria_negocioId_creadoEn_idx" ON "EventoAuditoria"("negocioId", "creadoEn");

-- CreateIndex
CREATE INDEX "EventoAuditoria_accion_creadoEn_idx" ON "EventoAuditoria"("accion", "creadoEn");

-- CreateIndex
CREATE INDEX "EventoAuditoriaSuperAdmin_superAdminId_creadoEn_idx" ON "EventoAuditoriaSuperAdmin"("superAdminId", "creadoEn");

-- CreateIndex
CREATE INDEX "EventoAuditoriaSuperAdmin_accion_creadoEn_idx" ON "EventoAuditoriaSuperAdmin"("accion", "creadoEn");

-- CreateIndex
CREATE INDEX "EventoAuditoriaSuperAdmin_negocioId_creadoEn_idx" ON "EventoAuditoriaSuperAdmin"("negocioId", "creadoEn");

-- CreateIndex
CREATE INDEX "WebhookLog_procesadoEn_idx" ON "WebhookLog"("procesadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookLog_origen_externalId_key" ON "WebhookLog"("origen", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "_ItemCartaGrupoModificador_AB_unique" ON "_ItemCartaGrupoModificador"("A", "B");

-- CreateIndex
CREATE INDEX "_ItemCartaGrupoModificador_B_index" ON "_ItemCartaGrupoModificador"("B");

-- AddForeignKey
ALTER TABLE "Sucursal" ADD CONSTRAINT "Sucursal_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionClub" ADD CONSTRAINT "ConfiguracionClub_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionSucursal" ADD CONSTRAINT "ConfiguracionSucursal_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionEmpleado" ADD CONSTRAINT "SesionEmpleado_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionDueno" ADD CONSTRAINT "SesionDueno_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroAcceso" ADD CONSTRAINT "RegistroAcceso_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispositivoCliente" ADD CONSTRAINT "DispositivoCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarjetaClienteSucursal" ADD CONSTRAINT "TarjetaClienteSucursal_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarjetaClienteSucursal" ADD CONSTRAINT "TarjetaClienteSucursal_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visita" ADD CONSTRAINT "Visita_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visita" ADD CONSTRAINT "Visita_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visita" ADD CONSTRAINT "Visita_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visita" ADD CONSTRAINT "Visita_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenValidacion" ADD CONSTRAINT "TokenValidacion_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenValidacion" ADD CONSTRAINT "TokenValidacion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCarta" ADD CONSTRAINT "ItemCarta_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCartaSucursal" ADD CONSTRAINT "ItemCartaSucursal_itemCartaId_fkey" FOREIGN KEY ("itemCartaId") REFERENCES "ItemCarta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCartaSucursal" ADD CONSTRAINT "ItemCartaSucursal_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrupoModificador" ADD CONSTRAINT "GrupoModificador_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcionModificador" ADD CONSTRAINT "OpcionModificador_grupoModificadorId_fkey" FOREIGN KEY ("grupoModificadorId") REFERENCES "GrupoModificador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaUpsell" ADD CONSTRAINT "ReglaUpsell_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaUpsell" ADD CONSTRAINT "ReglaUpsell_itemOrigenId_fkey" FOREIGN KEY ("itemOrigenId") REFERENCES "ItemCarta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglaUpsell" ADD CONSTRAINT "ReglaUpsell_itemDestinoId_fkey" FOREIGN KEY ("itemDestinoId") REFERENCES "ItemCarta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_empleadoAsignadoId_fkey" FOREIGN KEY ("empleadoAsignadoId") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncargadoDia" ADD CONSTRAINT "EncargadoDia_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncargadoDia" ADD CONSTRAINT "EncargadoDia_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncargadoDia" ADD CONSTRAINT "EncargadoDia_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinTurno" ADD CONSTRAINT "CheckinTurno_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinTurno" ADD CONSTRAINT "CheckinTurno_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinTurno" ADD CONSTRAINT "CheckinTurno_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResenaGoogle" ADD CONSTRAINT "ResenaGoogle_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResenaGoogle" ADD CONSTRAINT "ResenaGoogle_respuestaEmpleadoId_fkey" FOREIGN KEY ("respuestaEmpleadoId") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegracionGoogle" ADD CONSTRAINT "IntegracionGoogle_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacionPush" ADD CONSTRAINT "NotificacionPush_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacionPush" ADD CONSTRAINT "NotificacionPush_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacionPushEmpleado" ADD CONSTRAINT "NotificacionPushEmpleado_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificacionPushEmpleado" ADD CONSTRAINT "NotificacionPushEmpleado_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampanaMarketing" ADD CONSTRAINT "CampanaMarketing_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsoMensual" ADD CONSTRAINT "UsoMensual_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsoMensual" ADD CONSTRAINT "UsoMensual_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionSuperAdmin" ADD CONSTRAINT "SesionSuperAdmin_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suscripcion" ADD CONSTRAINT "Suscripcion_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Impersonacion" ADD CONSTRAINT "Impersonacion_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Impersonacion" ADD CONSTRAINT "Impersonacion_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAuditoria" ADD CONSTRAINT "EventoAuditoria_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "Negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAuditoriaSuperAdmin" ADD CONSTRAINT "EventoAuditoriaSuperAdmin_superAdminId_fkey" FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemCartaGrupoModificador" ADD CONSTRAINT "_ItemCartaGrupoModificador_A_fkey" FOREIGN KEY ("A") REFERENCES "GrupoModificador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ItemCartaGrupoModificador" ADD CONSTRAINT "_ItemCartaGrupoModificador_B_fkey" FOREIGN KEY ("B") REFERENCES "ItemCarta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
