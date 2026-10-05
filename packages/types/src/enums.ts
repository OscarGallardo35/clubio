// ============================================================================
// ENUMS — identicos al schema.prisma consolidado (38 modelos / 18 enums)
// NO importar @prisma/client: el frontend no debe depender del ORM.
// Los valores string coinciden con los de la BD/API.
// ============================================================================

export enum Plan {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PRO = 'PRO',
}

export enum RolEmpleado {
  DUENO = 'DUENO',
  ENCARGADO = 'ENCARGADO',
  CAJERO = 'CAJERO',
  MESERO = 'MESERO',
  DELIVERY = 'DELIVERY',
  EMPLEADO = 'EMPLEADO',
}

export enum ModoFidelizacion {
  SOLO_VISITAS = 'SOLO_VISITAS',
  SOLO_PUNTOS = 'SOLO_PUNTOS',
  HIBRIDO = 'HIBRIDO',
}

export enum EtiquetaCliente {
  NUEVO = 'NUEVO',
  REGULAR = 'REGULAR',
  VIP = 'VIP',
  INACTIVO = 'INACTIVO',
}

export enum TipoVisita {
  VISITA = 'VISITA',
  PUNTOS = 'PUNTOS',
  REGALO_MANUAL = 'REGALO_MANUAL',
}

export enum MetodoVisita {
  QR_ESTATICO = 'QR_ESTATICO',
  QR_DINAMICO = 'QR_DINAMICO',
  MANUAL = 'MANUAL',
}

export enum CanalCampana {
  PUSH = 'PUSH',
  WHATSAPP = 'WHATSAPP',
  AMBOS = 'AMBOS',
}

export enum EstadoPedido {
  PENDIENTE = 'PENDIENTE',
  CONFIRMADO = 'CONFIRMADO',
  EN_PREPARACION = 'EN_PREPARACION',
  LISTO = 'LISTO',
  ENVIADO = 'ENVIADO',
  ENTREGADO = 'ENTREGADO',
  CANCELADO = 'CANCELADO',
  RECHAZADO = 'RECHAZADO',
}

export enum TipoPedido {
  MESA = 'MESA',
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
}

export enum ModoPago {
  EFECTIVO = 'EFECTIVO',
  TRANSFERENCIA = 'TRANSFERENCIA',
  MERCADO_PAGO = 'MERCADO_PAGO',
  TARJETA = 'TARJETA',
}

export enum TipoModificador {
  UNICA_SELECCION = 'UNICA_SELECCION',
  MULTIPLE_SELECCION = 'MULTIPLE_SELECCION',
}

export enum ModoAsignacionPedidos {
  BROADCAST = 'BROADCAST',
  POR_ROL = 'POR_ROL',
  SOLO_ENCARGADO = 'SOLO_ENCARGADO',
}

export enum TipoTurno {
  ENCARGADO = 'ENCARGADO',
  CAJERO = 'CAJERO',
  MESERO = 'MESERO',
  DELIVERY = 'DELIVERY',
  EMPLEADO = 'EMPLEADO',
}

export enum ModoClientes {
  GLOBAL = 'GLOBAL',
  POR_SUCURSAL = 'POR_SUCURSAL',
}

export enum RecursoLimitado {
  CLIENTES = 'CLIENTES',
  EMPLEADOS = 'EMPLEADOS',
  SUCURSALES = 'SUCURSALES',
  ITEMS_CARTA = 'ITEMS_CARTA',
  PEDIDOS_MES = 'PEDIDOS_MES',
  CAMPANAS_PUSH_MES = 'CAMPANAS_PUSH_MES',
}

export enum EstadoUso {
  NORMAL = 'NORMAL',
  ADVERTENCIA = 'ADVERTENCIA',
  EXCEDIDO = 'EXCEDIDO',
}

export enum EstadoSuscripcion {
  ACTIVA = 'ACTIVA',
  PAUSADA = 'PAUSADA',
  CANCELADA = 'CANCELADA',
  VENCIDA = 'VENCIDA',
  TRIAL = 'TRIAL',
}

export enum EstadoLead {
  NUEVO = 'NUEVO',
  CONTACTADO = 'CONTACTADO',
  DEMO_AGENDADA = 'DEMO_AGENDADA',
  NEGOCIACION = 'NEGOCIACION',
  CONVERTIDO = 'CONVERTIDO',
  PERDIDO = 'PERDIDO',
  ARCHIVADO = 'ARCHIVADO',
}
