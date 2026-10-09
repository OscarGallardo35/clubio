'use client'

import * as React from 'react'

/**
 * Deteccion de plataforma + estado de instalacion de la PWA.
 *
 * El hook es el mismo para las tres PWAs (Cliente, Staff, Admin) y vive en @repo/ui para que no
 * haya tres copias que se desincronicen: cada app solo monta <BannerInstalacion />, que lo usa.
 *
 * Reglas del navegador que condicionan el diseno:
 *  - Android/Chrome: dispara `beforeinstallprompt`. Se hace `preventDefault()` para que NO muestre
 *    su mini-infobar propio y se guarda el evento; el prompt se dispara desde el boton del banner.
 *    OJO: Chrome solo dispara ese evento si la app es instalable (HTTPS + manifest valido + service
 *    worker con handler de `fetch`). Sin SW registrado el boton cae a las instrucciones manuales.
 *  - iOS/Safari: NO existe `beforeinstallprompt`. La unica via es el menu Compartir -> "Agregar a
 *    pantalla de inicio", asi que el banner muestra instrucciones.
 *  - iPad moderno: se presenta con UA de escritorio ("Macintosh") pero tiene touch; se detecta por
 *    `/Macintosh/` + `'ontouchend' in document`.
 *  - "Ya instalada": `display-mode: standalone` o `navigator.standalone` (Safari en iOS). Se
 *    CONFIRMA ademas con `navigator.getInstalledRelatedApps()` cuando el navegador lo expone: si
 *    responde con al menos una app relacionada, la PWA esta instalada aunque sea en una pestaña.
 *    La confirmacion solo AGREGA ocultamiento: sin soporte, con error o con lista vacia se mantiene
 *    lo anterior, para no ocultar nunca por un falso positivo (preferimos mostrar de mas).
 */

/** Navegadores in-app que envuelven la PWA y NO permiten instalarla. */
export type NavegadorInApp = 'Instagram' | 'Facebook' | 'TikTok' | 'LinkedIn' | null

/** Nombre de navegador al que hay que abrir el link para poder instalar. */
export type NavegadorExterno = 'Safari' | 'Chrome'

/**
 * Version minima del evento `beforeinstallprompt` de Chromium. No esta en la lib DOM, asi que se
 * declara con lo unico que se usa.
 */
export interface EventoAntesDeInstalar extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface DeteccionDispositivo {
  /** iOS (iPhone/iPad/iPod), incluido el iPad que se hace pasar por Mac. */
  esIOS: boolean
  /** iPad unicamente (por UA o por iPad con UA de escritorio). */
  esIPad: boolean
  esAndroid: boolean
  /** Ni iOS ni Android: se ofrece el QR para pasar al celular. */
  esEscritorio: boolean
  /** Instagram/Facebook/TikTok/LinkedIn, o `null` en un navegador normal. */
  navegadorInApp: NavegadorInApp
  /** Navegador al que hay que abrir el link: Safari en iOS, Chrome en el resto. */
  abrirEn: NavegadorExterno
}

/** 30 dias de cool-off tras descartar el banner. */
export const DIAS_COOL_OFF = 30
/** Clave de localStorage del descarte (una sola para todo el origen). */
export const CLAVE_DESCARTE_PWA = 'clubio:pwa-instalacion-descartada-hasta'

const RE_IPHONE_IPAD_IPOD = /iphone|ipad|ipod/i
const RE_IPAD = /ipad/i
const RE_ANDROID = /android/i
const RE_MACINTOSH = /Macintosh/

/**
 * Orden de prioridad: Instagram -> Facebook -> TikTok -> LinkedIn. Un UA de webview de Meta
 * ("FBAN"/"FBAV") no contiene "Instagram", pero el de Instagram puede traer "FBAN" en algunos
 * builds, por eso Instagram va primero.
 */
const RE_INAPP: ReadonlyArray<{ nombre: Exclude<NavegadorInApp, null>; re: RegExp }> = [
  { nombre: 'Instagram', re: /Instagram/i },
  { nombre: 'Facebook', re: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i },
  { nombre: 'TikTok', re: /BytedanceWebview|musical_ly|TikTok|Bytedance/i },
  { nombre: 'LinkedIn', re: /LinkedInApp/i },
]

/** Pura: navegador in-app detectado en el UA, o `null`. */
export function detectarNavegadorInApp(ua: string): NavegadorInApp {
  for (const { nombre, re } of RE_INAPP) {
    if (re.test(ua)) return nombre
  }
  return null
}

/** iPad que se presenta como Mac (UA de escritorio) pero tiene touch. */
export function esIPadConUaDeEscritorio(ua: string, tieneTouch: boolean): boolean {
  return RE_MACINTOSH.test(ua) && tieneTouch
}

/**
 * Pura: clasifica el dispositivo a partir del UA (y del flag de iPad-con-UA-de-escritorio).
 * Se separa del hook para poder testear cada rama sin un dispositivo real.
 */
export function detectarDispositivo(ua: string, ipadConUaDeEscritorio = false): DeteccionDispositivo {
  const esIOS = RE_IPHONE_IPAD_IPOD.test(ua) || ipadConUaDeEscritorio
  const esAndroid = RE_ANDROID.test(ua)
  return {
    esIOS,
    esIPad: RE_IPAD.test(ua) || ipadConUaDeEscritorio,
    esAndroid,
    esEscritorio: !esIOS && !esAndroid,
    navegadorInApp: detectarNavegadorInApp(ua),
    abrirEn: esIOS ? 'Safari' : 'Chrome',
  }
}

function leerDescartada(clave: string): boolean {
  try {
    const crudo = window.localStorage.getItem(clave)
    if (!crudo) return false
    const hasta = Number(crudo)
    return Number.isFinite(hasta) && hasta > Date.now()
  } catch {
    // localStorage bloqueado (modo privado / cookies off): se trata como "no descartada".
    return false
  }
}

function escribirDescarte(clave: string): void {
  try {
    const hasta = Date.now() + DIAS_COOL_OFF * 24 * 60 * 60 * 1000
    window.localStorage.setItem(clave, String(hasta))
  } catch {
    /* idem: si no se puede persistir, el banner se oculta solo en esta sesion. */
  }
}

export interface EstadoPWAInstall extends DeteccionDispositivo {
  /** Ya corrio la deteccion en el cliente. Antes de eso, todo es conservador (no visible). */
  listo: boolean
  /** La app ya corre instalada (standalone). */
  instalada: boolean
  /** El usuario descarto el banner y sigue dentro de los 30 dias de cool-off. */
  descartada: boolean
  /** Android: el `beforeinstallprompt` ya quedo capturado y se puede disparar. */
  tienePromptNativo: boolean
  /** El banner debe mostrarse: listo + no instalada + no descartada. */
  visible: boolean
  /** Dispara el prompt nativo de Android. No-op si no hay `deferredPrompt`. */
  instalar: () => Promise<void>
  /** Descarta el banner por 30 dias. */
  descartar: () => void
}

const DETECCION_INICIAL: DeteccionDispositivo = {
  esIOS: false,
  esIPad: false,
  esAndroid: false,
  esEscritorio: true,
  navegadorInApp: null,
  abrirEn: 'Chrome',
}

/**
 * Confirma con `navigator.getInstalledRelatedApps()` (Chrome/Android) que la PWA ya esta instalada.
 *
 * Devuelve `true` SOLO cuando el navegador expone la API y responde con al menos una app relacionada
 * (p.ej. el cliente la instalo y ahora navega en una pestaña, donde `display-mode` no lo delata). Si
 * no existe la API, si tira o si la lista viene vacia, devuelve `false`: nunca se oculta por un falso
 * positivo. Es `async` porque la API es asincronica; el hook la consulta despues de la deteccion sync.
 */
export async function confirmarInstaladaConRelatedApps(): Promise<boolean> {
  const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown> }
  if (typeof nav.getInstalledRelatedApps !== 'function') return false
  try {
    const apps = await nav.getInstalledRelatedApps()
    return Array.isArray(apps) && apps.length > 0
  } catch {
    return false
  }
}

export function usePWAInstall(claveDescarte: string = CLAVE_DESCARTE_PWA): EstadoPWAInstall {
  const promptRef = React.useRef<EventoAntesDeInstalar | null>(null)
  const [listo, setListo] = React.useState(false)
  const [deteccion, setDeteccion] = React.useState<DeteccionDispositivo>(DETECCION_INICIAL)
  const [instalada, setInstalada] = React.useState(false)
  const [descartada, setDescartada] = React.useState(false)
  const [tienePromptNativo, setTienePromptNativo] = React.useState(false)

  React.useEffect(() => {
    const ua = navigator.userAgent
    const conTouch = 'ontouchend' in document
    const det = detectarDispositivo(ua, esIPadConUaDeEscritorio(ua, conTouch))
    const yaInstalada =
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true

    setDeteccion(det)
    setInstalada(yaInstalada)
    setDescartada(leerDescartada(claveDescarte))
    setListo(true)

    // Confirmacion ADICIONAL (async): `getInstalledRelatedApps()` no vuelve la app "oculta por
    // defecto", solo AGREGA ocultamiento cuando el navegador confirma una app relacionada. Si la
    // API no existe, tira o devuelve vacio, `confirmarInstaladaConRelatedApps()` da `false` y no
    // pasa nada: nunca se oculta por un falso positivo.
    let cancelado = false
    if (!yaInstalada) {
      void confirmarInstaladaConRelatedApps().then((confirmada) => {
        if (!cancelado && confirmada) setInstalada(true)
      })
    }

    const alPrompt = (e: Event) => {
      // preventDefault: sin esto Chrome muestra su propio mini-infobar y no deja reusar el evento.
      e.preventDefault()
      promptRef.current = e as EventoAntesDeInstalar
      setTienePromptNativo(true)
    }
    const alInstalar = () => {
      promptRef.current = null
      setTienePromptNativo(false)
      setInstalada(true)
    }

    window.addEventListener('beforeinstallprompt', alPrompt)
    window.addEventListener('appinstalled', alInstalar)
    return () => {
      cancelado = true
      window.removeEventListener('beforeinstallprompt', alPrompt)
      window.removeEventListener('appinstalled', alInstalar)
    }
  }, [claveDescarte])

  const instalar = React.useCallback(async () => {
    const evento = promptRef.current
    if (!evento) return
    await evento.prompt()
    try {
      // userChoice resuelve con 'accepted' | 'dismissed'; si el usuario cancela no se hace nada
      // (el `appinstalled` se encarga de ocultar el banner cuando realmente se instala).
      await evento.userChoice
    } catch {
      /* el prompt puede rechazar si ya no esta disponible: se ignora. */
    }
    promptRef.current = null
    setTienePromptNativo(false)
  }, [])

  const descartar = React.useCallback(() => {
    escribirDescarte(claveDescarte)
    setDescartada(true)
  }, [claveDescarte])

  const visible = listo && !instalada && !descartada

  return { ...deteccion, listo, instalada, descartada, tienePromptNativo, visible, instalar, descartar }
}
