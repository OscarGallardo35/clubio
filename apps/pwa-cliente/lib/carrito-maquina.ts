/**
 * Maquina de estados PURA del carrito (QR #1: menu + carrito + checkout).
 *
 * Sin React, sin fetch, sin zustand: entra (estado, evento), sale estado. Asi el
 * flujo completo se testea en node (`scripts/check-carrito.mts`) sin montar nada,
 * igual que `visita-maquina.ts`.
 *
 * OJO con una cosa que NO hace esta maquina: el total es SOLO para mostrar. El
 * backend recalcula los precios desde la DB e IGNORA el `precio` que le mandemos
 * (`CrearPedidoDto` lo acepta pero no lo usa, para que nadie manipule el carrito).
 * Si el numero que ve el cliente y el que cobra el backend difieren, manda el
 * backend.
 */

// ---------------------------------------------------------------------------
// Tipos de entrada (lo que viene de la carta y de los modificadores)
// ---------------------------------------------------------------------------

/** Los enums son los del backend; aca van como uniones para no depender de @prisma/client. */
export type TipoPedido = 'MESA' | 'TAKEAWAY' | 'DELIVERY'
export type ModoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'TARJETA'

/** Opcion de un grupo de modificadores (`GET /modificadores/items/:itemId/grupos`). */
export interface OpcionModificador {
  id: string
  nombre: string
  precioExtra: number
  disponible: boolean
}

/** Grupo de modificadores, ya con sus opciones resueltas. */
export interface GrupoModificador {
  id: string
  nombre: string
  tipo: 'UNICA_SELECCION' | 'MULTIPLE_SELECCION'
  obligatorio: boolean
  minSelecciones: number
  maxSelecciones: number
  opciones: OpcionModificador[]
}

/** Lo minimo de un item de la carta que el carrito necesita. */
export interface ItemCarta {
  id: string
  nombre: string
  precio: number
  disponible: boolean
  imagenUrl?: string | undefined
  /** Grupos que aplican a este item (vacio = se agrega directo, sin modal). */
  grupos: GrupoValidable[]
}

// ---------------------------------------------------------------------------
// Tipos de estado
// ---------------------------------------------------------------------------

export interface ModificadorElegido {
  grupoId: string
  grupoNombre: string
  /** Las opciones elegidas, con su precio ya congelado al momento de agregar. */
  opciones: { id: string; nombre: string; precioExtra: number }[]
}

export interface ItemCarrito {
  /** Clave local: mismo item + mismos modificadores + mismas notas = misma linea. */
  clave: string
  itemId: string
  nombre: string
  /** Precio unitario de la carta (el que devuelve /carta para la sucursal activa). */
  precioBase: number
  imagenUrl?: string | undefined
  cantidad: number
  notas: string
  modificadores: ModificadorElegido[]
}

export type FaseCarrito = 'vacio' | 'conItems' | 'checkout' | 'enviando' | 'enviado'

export interface DatosCliente {
  nombre: string
  telefono: string
  direccion?: string | undefined
  mesa?: string | undefined
}

export interface SugerenciaUpsell {
  reglaId: string
  mensaje: string
  motivo: string
  itemId?: string | undefined
  itemNombre?: string | undefined
  precio?: number | undefined
}

export interface ErrorCarrito {
  /** 'RATE_LIMIT' | 'VALIDACION' | 'SUCURSAL_CERRADA' | 'RED' | 'DESCONOCIDO' | 'CARTA_VENCIDA' | 'PEDIDO_ACTIVO' */
  codigo: string
  /** Copy para el usuario (sin jerga tecnica). */
  mensaje: string
  /**
   * Solo con `PEDIDO_ACTIVO` (409 por "un pedido activo por cliente"): el pedido que ya esta en
   * curso, para ofrecer "ver mi pedido" / "cancelarlo" en vez de un reintento que va a chocar.
   *
   * `linkVigente` es el dato que decide si "ver mi pedido" tiene sentido: el link dura 4 h, y con
   * el link vencido el seguimiento devuelve 410. Lo manda el backend y predice EXACTAMENTE lo que
   * haria el GET publico (usa el mismo `linkVencido`).
   */
  pedidoActivo?: { pedidoId: string; linkToken: string; linkVigente: boolean } | undefined
}

export interface EstadoCarrito {
  negocioSlug: string
  sucursalId: string | null
  sucursalSlug: string | null
  items: ItemCarrito[]
  fase: FaseCarrito
  tipo: TipoPedido | null
  modoPago: ModoPago | null
  cliente: DatosCliente
  /** Mientras el upsell esta en vuelo, para no mostrar el carrusel vacio. */
  upsellCargando: boolean
  upsell: SugerenciaUpsell | null
  error: ErrorCarrito | null
  /** Respuesta de POST /pedidos (el linkToken es con el que se sigue el pedido). */
  pedido: PedidoEnCurso | null
  /** Aviso no bloqueante (ej: se reinicio el carrito al cambiar de sucursal). */
  aviso: string | null
  /** Notas generales del pedido (una sola, no por item). Persiste. */
  notasPedido?: string | undefined
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export type EventoCarrito =
  | { tipo: 'AGREGAR_ITEM'; item: ItemCarta; cantidad: number; modificadores: ModificadorElegido[]; notas: string }
  | { tipo: 'QUITAR_ITEM'; clave: string }
  | { tipo: 'CAMBIAR_CANTIDAD'; clave: string; cantidad: number }
  | { tipo: 'CAMBIAR_NOTAS'; clave: string; notas: string }
  | { tipo: 'LIMPIAR' }
  | { tipo: 'CAMBIAR_SUCURSAL'; sucursalId: string; sucursalSlug: string }
  | { tipo: 'RECONCILIAR'; carta: ItemCarta[] }
  | { tipo: 'ABRIR_CHECKOUT' }
  | { tipo: 'CERRAR_CHECKOUT' }
  // OJO: el payload NO puede llamarse `tipo` como el discriminante: `evento.tipo`
  // pasaria a valer 'DELIVERY' y el switch cae al default (bug real, lo cazo el check).
  | { tipo: 'SET_TIPO'; nuevoTipo: TipoPedido }
  | { tipo: 'SET_MODO_PAGO'; modoPago: ModoPago }
  | { tipo: 'SET_CLIENTE'; campo: keyof DatosCliente; valor: string }
  | { tipo: 'UPSELL_PEDIR' }
  | { tipo: 'UPSELL_OK'; sugerencia: SugerenciaUpsell | null }
  | { tipo: 'UPSELL_ERROR' }
  | { tipo: 'ENVIAR' }
  | { tipo: 'PEDIDO_OK'; linkToken: string; numero?: number; urlCorta?: string; mensajeWhatsApp?: string }
  | { tipo: 'PEDIDO_ERROR'; status: number; mensaje: string; data?: unknown }
  | { tipo: 'REINTENTAR' }
  | { tipo: 'DESCARTAR_AVISO' }
  // Olvida el pedido guardado. Se dispara cuando el seguimiento recibe 404: ese linkToken ya no
  // existe, asi que el banner "Ver estado de tu pedido" no puede seguir apuntando ahi.
  | { tipo: 'OLVIDAR_PEDIDO' }
  /**
   * Prellena los datos del cliente desde su sesion (GET /auth/cliente/me). El eje es que NUNCA pisa
   * lo que el usuario ya escribio: solo llena campos vacios, y esa guarda vive en el reducer para que
   * valga en cualquier camino que prellene (no queda en manos de quien despacha).
   */
  | { tipo: 'PRELLENAR_CLIENTE'; datos: { nombre?: string | undefined; telefono?: string | undefined } }
  | { tipo: 'SET_NOTAS_PEDIDO'; notas: string }

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

/** Redondeo a 2 decimales evitando el ruido de punto flotante (0.1+0.2). */
function plata(n: number): number {
  return Math.round(n * 100) / 100
}

/** Precio unitario: base + la suma de los extras elegidos. */
export function precioUnitario(item: ItemCarrito): number {
  const extras = item.modificadores.reduce(
    (acc, m) => acc + m.opciones.reduce((a, o) => a + o.precioExtra, 0),
    0,
  )
  return plata(item.precioBase + extras)
}

/** Subtotal de una linea. */
export function subtotalItem(item: ItemCarrito): number {
  return plata(precioUnitario(item) * item.cantidad)
}

/** Total del carrito (SOLO para mostrar: el backend recalcula - ver el comentario de arriba). */
export function totalCarrito(estado: EstadoCarrito): number {
  return plata(estado.items.reduce((acc, i) => acc + subtotalItem(i), 0))
}

export function cantidadTotal(estado: EstadoCarrito): number {
  return estado.items.reduce((acc, i) => acc + i.cantidad, 0)
}

/**
 * Clave local de una linea: el mismo item con los mismos modificadores y las mismas
 * notas se suma en cantidad en vez de duplicar la fila.
 */
export function claveDeLinea(itemId: string, modificadores: ModificadorElegido[], notas: string): string {
  const firma = modificadores
    .map((m) => `${m.grupoId}:${[...m.opciones.map((o) => o.id)].sort().join('+')}`)
    .sort()
    .join('|')
  return `${itemId}#${firma}#${notas.trim()}`
}

/** Los grupos obligatorios tienen que estar completos y respetar min/max. */
/**
 * Lo minimo que necesita el validador. Los min/max van opcionales a proposito: el carrito los
 * tiene requeridos, pero el grupo que viene de la API los declara opcionales. Sin este tipo
 * comun, el modal (que valida el grupo publico) no podia reusar la validacion del carrito.
 */
export type GrupoValidable = {
  id: string
  nombre: string
  tipo: 'UNICA_SELECCION' | 'MULTIPLE_SELECCION'
  obligatorio: boolean
  minSelecciones?: number | undefined
  maxSelecciones?: number | undefined
}

export function validarModificadores(grupos: GrupoValidable[], elegidos: ModificadorElegido[]): string[] {
  const errores: string[] = []
  for (const g of grupos) {
    const elegido = elegidos.find((e) => e.grupoId === g.id)
    const cuantas = elegido?.opciones.length ?? 0
    const min = g.minSelecciones ?? (g.obligatorio ? 1 : 0)
    const max = g.maxSelecciones ?? Infinity
    if (g.obligatorio && cuantas < Math.max(1, min)) {
      errores.push(`Elegi ${g.nombre}`)
      continue
    }
    if (cuantas > 0 && cuantas < min) errores.push(`En ${g.nombre} elegi al menos ${min}`)
    if (cuantas > max) errores.push(`En ${g.nombre} podes elegir hasta ${max}`)
  }
  return errores
}

/** Chequeos del checkout antes de habilitar el envio. */
/**
 * Telefono en formato E.164, que es el unico que acepta el backend. Se valida ANTES de mandar el
 * pedido: el backend contesta 400 y el pedido nunca sale, asi que es mejor decirlo en el campo.
 * E.164: "+" seguido de 10 a 15 digitos (sin espacios, sin guiones, sin 0 ni 00 adelante).
 */
/** Telefono en formato E.164 (el unico que acepta el backend) */
export function validarTelefonoE164(tel: string): boolean {
  const t = (tel ?? '').trim()
  if (!t.startsWith('+')) return false
  const digitos = t.slice(1)
  if (digitos.length < 10 || digitos.length > 15) return false
  return /^[0-9]+$/.test(digitos)
}

export function validarCheckout(estado: EstadoCarrito): Partial<Record<keyof DatosCliente | 'tipo' | 'modoPago' | 'items', string>> {
  const fallas: Partial<Record<keyof DatosCliente | 'tipo' | 'modoPago' | 'items', string>> = {}
  if (estado.items.length === 0) fallas.items = 'El carrito esta vacio'
  if (!estado.tipo) fallas.tipo = 'Elegi si es para la mesa, para llevar o delivery'
  if (!estado.modoPago) fallas.modoPago = 'Elegi como vas a pagar'
  if (estado.cliente.nombre.trim().length < 2) fallas.nombre = 'Poné tu nombre'
  // El backend solo acepta E.164 y responde 400 si no: se valida aca para no mandar el pedido al
  // pedo y poder decirselo en el campo (el mensaje sale del mismo lugar que el del backend).
  if (!validarTelefonoE164(estado.cliente.telefono)) {
    fallas.telefono = 'Incluí el código de país. Ej: +5491112345678'
  }
  if (estado.tipo === 'DELIVERY' && (estado.cliente.direccion ?? '').trim().length < 5) {
    fallas.direccion = 'Necesitamos la direccion para el delivery'
  }
  if (estado.tipo === 'MESA' && (estado.cliente.mesa ?? '').trim().length === 0) {
    fallas.mesa = 'Decime el numero de mesa'
  }
  return fallas
}

/** Traduce un error del backend (o de red) a algo que el cliente pueda leer. */
export function clasificarError(status: number, mensajeBackend: string, data?: unknown): ErrorCarrito {
  if (status === 409) {
    // Ya hay un pedido activo de este cliente (o de este telefono). No es un error del
    // formulario: es un ESTADO, asi que ademas del copy se le pasa el link del pedido en curso
    // para que pueda mirarlo o cancelarlo. El backend lo manda en el payload del 409.
    const d = (data ?? {}) as { pedidoId?: unknown; linkToken?: unknown; linkVigente?: unknown }
    const pedidoActivo =
      typeof d.pedidoId === 'string' && typeof d.linkToken === 'string'
        ? {
            pedidoId: d.pedidoId,
            linkToken: d.linkToken,
            // Conservador: solo se da por muerto si el backend lo dice EXPLICITAMENTE. Si el
            // campo no viniera (frontend nuevo contra backend viejo), se sigue ofreciendo el CTA.
            linkVigente: d.linkVigente !== false,
          }
        : undefined
    // Con el link vencido el seguimiento devuelve 410, asi que ofrecer "ver mi pedido" seria
    // mandar al usuario a una pantalla de error. El copy cambia para decir la unica salida real.
    const linkMuerto = pedidoActivo !== undefined && !pedidoActivo.linkVigente
    return {
      codigo: 'PEDIDO_ACTIVO',
      mensaje: linkMuerto
        ? 'El link del pedido activo ya venció. Cancelalo para hacer uno nuevo.'
        : (mensajeBackend || 'Ya tenés un pedido activo. Cancelalo o esperá a que termine.'),
      ...(pedidoActivo ? { pedidoActivo } : {}),
    }
  }
  if (status === 429) {
    return {
      codigo: 'RATE_LIMIT',
      mensaje: 'Recibimos muchos pedidos seguidos desde esta conexion. Esperá unos minutos y volvé a intentar.',
    }
  }
  if (status === 400 || status === 422) {
    return { codigo: 'VALIDACION', mensaje: mensajeBackend || 'Revisá los datos del pedido' }
  }
  if (status === 410) {
    // La carta cambio entre que se armo el carrito y el checkout: los precios o los items ya no
    // valen, asi que no sirve reintentar igual. Se recarga para traer la version nueva.
    return { codigo: 'CARTA_VENCIDA', mensaje: 'La carta cambió, recargá la página para ver la nueva versión.' }
  }
  if (status === 403) {
    return { codigo: 'SUCURSAL_CERRADA', mensaje: mensajeBackend || 'La sucursal no está tomando pedidos ahora' }
  }
  if (status === 0 || status >= 500) {
    return { codigo: 'RED', mensaje: 'No pudimos enviar el pedido. Revisá tu conexion y probá otra vez.' }
  }
  return { codigo: 'DESCONOCIDO', mensaje: mensajeBackend || 'No pudimos enviar el pedido' }
}

export function estadoInicial(negocioSlug: string, sucursalId: string | null, sucursalSlug: string | null): EstadoCarrito {
  return {
    negocioSlug,
    sucursalId,
    sucursalSlug,
    items: [],
    fase: 'vacio',
    tipo: null,
    modoPago: null,
    cliente: { nombre: '', telefono: '' },
    upsellCargando: false,
    upsell: null,
    error: null,
    pedido: null,
    aviso: null,
    notasPedido: '',
  }
}

// ---------------------------------------------------------------------------
// El reducer
// ---------------------------------------------------------------------------

/** Recalcula la fase a partir del contenido (la fase nunca "miente" sobre el carrito). */
function faseSegunItems(estado: EstadoCarrito): FaseCarrito {
  if (estado.items.length === 0) return 'vacio'
  if (estado.fase === 'checkout') return 'checkout'
  return 'conItems'
}

export function reducerCarrito(estado: EstadoCarrito, evento: EventoCarrito): EstadoCarrito {
  switch (evento.tipo) {
    case 'AGREGAR_ITEM': {
      const cantidad = Math.max(1, Math.min(99, Math.trunc(evento.cantidad)))
      const notas = evento.notas.slice(0, 200)
      const clave = claveDeLinea(evento.item.id, evento.modificadores, notas)
      const existente = estado.items.find((i) => i.clave === clave)
      const items = existente
        ? estado.items.map((i) =>
            i.clave === clave ? { ...i, cantidad: Math.min(99, i.cantidad + cantidad) } : i,
          )
        : [
            ...estado.items,
            {
              clave,
              itemId: evento.item.id,
              nombre: evento.item.nombre,
              precioBase: evento.item.precio,
              imagenUrl: evento.item.imagenUrl,
              cantidad,
              notas,
              modificadores: evento.modificadores,
            },
          ]
      const nuevo = { ...estado, items, error: null, aviso: null }
      return { ...nuevo, fase: faseSegunItems(nuevo) }
    }

    case 'QUITAR_ITEM': {
      const nuevo = { ...estado, items: estado.items.filter((i) => i.clave !== evento.clave) }
      return { ...nuevo, fase: faseSegunItems(nuevo) }
    }

    case 'CAMBIAR_CANTIDAD': {
      const cantidad = Math.trunc(evento.cantidad)
      // Cantidad 0 (o menos) saca la linea: es lo que espera el que toca "-".
      const items =
        cantidad <= 0
          ? estado.items.filter((i) => i.clave !== evento.clave)
          : estado.items.map((i) => (i.clave === evento.clave ? { ...i, cantidad: Math.min(99, cantidad) } : i))
      const nuevo = { ...estado, items }
      return { ...nuevo, fase: faseSegunItems(nuevo) }
    }

    case 'CAMBIAR_NOTAS':
      return {
        ...estado,
        items: estado.items.map((i) =>
          i.clave === evento.clave ? { ...i, notas: evento.notas.slice(0, 200) } : i,
        ),
      }

    case 'LIMPIAR':
      return {
        ...estadoInicial(estado.negocioSlug, estado.sucursalId, estado.sucursalSlug),
        cliente: estado.cliente,
      }

    case 'CAMBIAR_SUCURSAL': {
      if (evento.sucursalId === estado.sucursalId) return estado
      // Los precios pueden tener override por sucursal: el carrito viejo quedaria con
      // precios de otra sucursal, asi que se vacia (y se avisa).
      return {
        ...estadoInicial(estado.negocioSlug, evento.sucursalId, evento.sucursalSlug),
        cliente: estado.cliente,
        aviso: estado.items.length > 0 ? 'Cambiaste de sucursal: vaciamos el carrito porque los precios pueden cambiar.' : null,
      }
    }

    case 'RECONCILIAR': {
      // Al montar: la carta pudo cambiar (precio con override, item dado de baja).
      const porId = new Map(evento.carta.map((c) => [c.id, c]))
      const bajas: string[] = []
      const items = estado.items.flatMap((i) => {
        const enCarta = porId.get(i.itemId)
        if (!enCarta || !enCarta.disponible) {
          bajas.push(i.nombre)
          return []
        }
        return [{ ...i, precioBase: enCarta.precio, nombre: enCarta.nombre }]
      })
      const nuevo = { ...estado, items }
      const aviso =
        bajas.length > 0 ? `Ya no esta disponible: ${bajas.join(', ')}.` : estado.aviso
      return { ...nuevo, fase: faseSegunItems(nuevo), aviso }
    }

    case 'ABRIR_CHECKOUT':
      if (estado.items.length === 0) return estado
      return { ...estado, fase: 'checkout', error: null }

    case 'CERRAR_CHECKOUT': {
      if (estado.fase !== 'checkout') return estado
      const nuevo = { ...estado, fase: 'conItems' as FaseCarrito }
      return { ...nuevo, fase: faseSegunItems(nuevo) }
    }

    case 'SET_TIPO': {
      // Al cambiar de tipo se limpia lo que ya no aplica (direccion de un TAKEAWAY, etc).
      const cliente = { ...estado.cliente }
      if (evento.nuevoTipo !== 'DELIVERY') delete cliente.direccion
      if (evento.nuevoTipo !== 'MESA') delete cliente.mesa
      return { ...estado, tipo: evento.nuevoTipo, cliente, error: null }
    }

    case 'SET_MODO_PAGO':
      return { ...estado, modoPago: evento.modoPago, error: null }

    case 'SET_CLIENTE':
      return { ...estado, cliente: { ...estado.cliente, [evento.campo]: evento.valor }, error: null }

    case 'UPSELL_PEDIR':
      return { ...estado, upsellCargando: true }

    case 'UPSELL_OK':
      return { ...estado, upsellCargando: false, upsell: evento.sugerencia }

    case 'UPSELL_ERROR':
      // El upsell es un extra: si falla, el carrito sigue funcionando igual.
      return { ...estado, upsellCargando: false, upsell: null }

    case 'ENVIAR': {
      // Guarda dura: no se envia dos veces ni con datos incompletos.
      if (estado.fase === 'enviando' || estado.fase === 'enviado') return estado
      if (Object.keys(validarCheckout(estado)).length > 0) return estado
      return { ...estado, fase: 'enviando', error: null }
    }

    case 'PEDIDO_OK':
      return {
        ...estadoInicial(estado.negocioSlug, estado.sucursalId, estado.sucursalSlug),
        fase: 'enviado',
        cliente: estado.cliente,
        tipo: estado.tipo,
        modoPago: estado.modoPago,
        pedido: {
          linkToken: evento.linkToken,
          ...(evento.numero !== undefined ? { numero: evento.numero } : {}),
          ...(evento.urlCorta ? { urlCorta: evento.urlCorta } : {}),
          ...(evento.mensajeWhatsApp ? { mensajeWhatsApp: evento.mensajeWhatsApp } : {}),
        },
      }

    case 'PEDIDO_ERROR':
      // El reducer clasifica el error (429, 400, 5xx, red) para que el copy viva en un
      // solo lugar y la UI no tenga que traducir codigos HTTP.
      return { ...estado, fase: 'checkout', error: clasificarError(evento.status, evento.mensaje, evento.data) }

    case 'REINTENTAR':
      if (estado.fase !== 'checkout') return estado
      return { ...estado, error: null }

    case 'PRELLENAR_CLIENTE': {
      const nombre = evento.datos.nombre?.trim()
      const telefono = evento.datos.telefono?.trim()
      const cliente = { ...estado.cliente }
      if (cliente.nombre.trim() === '' && nombre) cliente.nombre = nombre
      if (cliente.telefono.trim() === '' && telefono) cliente.telefono = telefono
      // Sin cambios: se devuelve el MISMO objeto para no re-renderizar al pedo.
      if (cliente.nombre === estado.cliente.nombre && cliente.telefono === estado.cliente.telefono) {
        return estado
      }
      return { ...estado, cliente }
    }

    case 'OLVIDAR_PEDIDO':
      // Solo suelta el pedido: items, fase y datos del cliente quedan intactos (el carrito no tiene
      // nada que ver con que el link del pedido viejo ya no exista).
      if (!estado.pedido) return estado
      return { ...estado, pedido: null }

    case 'SET_NOTAS_PEDIDO':
      // Maximo del backend para las notas del pedido (el de por item es 200).
      return { ...estado, notasPedido: evento.notas.slice(0, 500) }

    case 'DESCARTAR_AVISO':
      return { ...estado, aviso: null }

    default:
      return estado
  }
}


// ---------------------------------------------------------------------------
// Persistencia (lo que sobrevive a cerrar el navegador)
// ---------------------------------------------------------------------------

/**
 * Lo que se guarda en localStorage. Deliberadamente NO entra todo el estado:
 * `error`, `upsell` y `upsellCargando` son de la sesion, no del carrito.
 */
/**
 * Lo que se conserva del ultimo pedido. `urlCorta` y `mensajeWhatsApp` vienen de la RESPUESTA del
 * POST (no del GET publico, que no los tiene), asi que si no se guardan aca el boton de WhatsApp
 * desaparece al recargar. Son opcionales: un pedido viejo guardado antes de esto no los tiene.
 */
export interface PedidoEnCurso {
  linkToken: string
  numero?: number | undefined
  urlCorta?: string | undefined
  mensajeWhatsApp?: string | undefined
}

export interface CarritoPersistido {
  negocioSlug: string
  sucursalId: string | null
  sucursalSlug: string | null
  items: ItemCarrito[]
  /** `enviando` NO se persiste: al reabrir no sabemos si el pedido entro. */
  fase: Exclude<FaseCarrito, 'enviando'>
  tipo: TipoPedido | null
  modoPago: ModoPago | null
  cliente: DatosCliente
  /** Con el linkToken se puede seguir el pedido despues de reabrir. */
  pedido: PedidoEnCurso | null
  /** Notas generales del pedido (se persisten con el resto del formulario). */
  notasPedido?: string | undefined
}

export function recortarParaPersistir(estado: EstadoCarrito): CarritoPersistido {
  return {
    negocioSlug: estado.negocioSlug,
    sucursalId: estado.sucursalId,
    sucursalSlug: estado.sucursalSlug,
    items: estado.items,
    fase: estado.fase === 'enviando' ? 'checkout' : estado.fase,
    tipo: estado.tipo,
    modoPago: estado.modoPago,
    cliente: estado.cliente,
    pedido: estado.pedido,
    notasPedido: estado.notasPedido,
  }
}

/** Deserializa sin confiar en el contenido: localStorage lo puede tocar cualquiera. */
export function deserializarCarrito(crudo: unknown, negocioSlug: string): CarritoPersistido | null {
  let dato: unknown = crudo
  if (typeof crudo === 'string') {
    try { dato = JSON.parse(crudo) } catch { return null }
  }
  if (!dato || typeof dato !== 'object') return null
  const d = dato as Partial<CarritoPersistido>
  if (!Array.isArray(d.items)) return null
  const items = d.items.filter(
    (i): i is ItemCarrito =>
      !!i && typeof i === 'object' && typeof i.itemId === 'string' && typeof i.precioBase === 'number' &&
      typeof i.cantidad === 'number' && Array.isArray(i.modificadores),
  )
  if (items.length === 0) return null
  return {
    negocioSlug: typeof d.negocioSlug === 'string' ? d.negocioSlug : negocioSlug,
    sucursalId: d.sucursalId ?? null,
    sucursalSlug: d.sucursalSlug ?? null,
    items,
    fase: d.fase === 'enviado' || d.fase === 'checkout' ? d.fase : 'conItems',
    tipo: d.tipo ?? null,
    modoPago: d.modoPago ?? null,
    cliente: {
      nombre: typeof d.cliente?.nombre === 'string' ? d.cliente.nombre : '',
      telefono: typeof d.cliente?.telefono === 'string' ? d.cliente.telefono : '',
      ...(d.cliente?.direccion ? { direccion: d.cliente.direccion } : {}),
      ...(d.cliente?.mesa ? { mesa: d.cliente.mesa } : {}),
    },
    pedido:
      d.pedido && typeof d.pedido.linkToken === 'string'
        ? {
            linkToken: d.pedido.linkToken,
            ...(d.pedido.numero ? { numero: d.pedido.numero } : {}),
            ...(typeof d.pedido.urlCorta === 'string' ? { urlCorta: d.pedido.urlCorta } : {}),
            ...(typeof d.pedido.mensajeWhatsApp === 'string' ? { mensajeWhatsApp: d.pedido.mensajeWhatsApp } : {}),
          }
        : null,
    notasPedido: typeof d.notasPedido === 'string' ? d.notasPedido.slice(0, 500) : '',
  }
}

export interface ContextoRehidratacion {
  /** La sucursal activa AHORA (la resuelve el layout, no el localStorage). */
  sucursalId: string | null
  sucursalSlug: string | null
  /** Si viene la carta, se reconcilian precios y se dan de baja los items que ya no estan. */
  carta?: ItemCarta[]
}

/**
 * Rehidratacion: cruza lo guardado con la realidad de la sucursal activa.
 *
 * Regla (refinamiento 2): si el carrito guardado es de OTRA sucursal, se vacia con aviso,
 * porque los precios pueden tener override por sucursal. La sucursal viva SIEMPRE manda
 * sobre la guardada.
 */
export function rehidratar(persistido: CarritoPersistido, contexto: ContextoRehidratacion): EstadoCarrito {
  // Arranca con la sucursal GUARDADA (no la viva): recien despues se la cruza, porque
  // CAMBIAR_SUCURSAL compara contra la sucursal del estado y si ya le hubieramos puesto la
  // nueva, su guarda de idempotencia lo tomaria como "misma sucursal" y no vaciaria nada.
  let estado: EstadoCarrito = {
    ...estadoInicial(persistido.negocioSlug, persistido.sucursalId, persistido.sucursalSlug),
    ...persistido,
    error: null,
    upsell: null,
    upsellCargando: false,
    aviso: null,
  }
  if (contexto.sucursalId && persistido.sucursalId !== contexto.sucursalId) {
    // CAMBIAR_SUCURSAL ya sabe vaciar y avisar: se reusa esa regla en vez de repetirla.
    estado = reducerCarrito(estado, {
      tipo: 'CAMBIAR_SUCURSAL',
      sucursalId: contexto.sucursalId,
      sucursalSlug: contexto.sucursalSlug ?? '',
    })
  } else {
    estado = {
      ...estado,
      sucursalId: contexto.sucursalId ?? estado.sucursalId,
      sucursalSlug: contexto.sucursalSlug ?? estado.sucursalSlug,
    }
  }
  if (contexto.carta) estado = reducerCarrito(estado, { tipo: 'RECONCILIAR', carta: contexto.carta })
  return { ...estado, fase: estado.items.length === 0 ? 'vacio' : estado.fase }
}
