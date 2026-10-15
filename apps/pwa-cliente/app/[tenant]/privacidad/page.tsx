import Link from 'next/link'
import type { Metadata } from 'next'
import { getNegocio } from '@/lib/api-servidor'
import { RUTAS } from '@/lib/constants'

/**
 * POLITICA DE PRIVACIDAD del club (Argentina, Ley 25.326 de Proteccion de Datos Personales).
 *
 * Es un Server Component: resuelve el local con `getNegocio` (ya cacheado 30s por el layout) para
 * poder nombrar al RESPONSABLE del tratamiento, que es el local y no la plataforma. No usa
 * `useBranding` porque no es un componente de cliente.
 *
 * El texto es en castellano rioplatense y sin jerga legal a proposito: tiene que entenderlo el
 * cliente que escaneo un QR en la mesa, no un abogado. Cubre lo que la ley exige informar
 * (finalidad, base legal, conservacion, derechos ARCO y contacto) mas los dos puntos que este
 * producto agrega: las notificaciones push y que la base esta alojada en Sao Paulo (Brasil).
 */

export async function generateMetadata({
  params,
}: {
  params: { tenant: string }
}): Promise<Metadata> {
  const negocio = await getNegocio(params.tenant)
  return {
    title: negocio ? `Privacidad — ${negocio.nombre}` : 'Privacidad',
  }
}

export default async function PrivacidadPage({ params }: { params: { tenant: string } }) {
  const negocio = await getNegocio(params.tenant)
  const nombreLocal = negocio?.nombre ?? 'el local'
  const email = negocio?.email ?? null
  const telefono = negocio?.telefono ?? null

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 text-foreground">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Cómo cuidamos tus datos</h1>
        <p className="text-sm text-muted-foreground">
          Última actualización: octubre de 2026. Esto explica, sin vueltas, qué datos tuyos guarda{' '}
          {nombreLocal}, para qué los usa y cómo podés borrarlos.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Quién es el responsable</h2>
        <p className="text-sm leading-relaxed">
          El responsable de tus datos es <strong>{nombreLocal}</strong>, el local donde te sumaste al
          club.
          {negocio?.direccion ? ` Está en ${negocio.direccion}.` : ''} La aplicación que usás es la
          herramienta que el local usa para manejar el club; los datos son del local, no nuestros.
        </p>
        <p className="text-sm leading-relaxed">
          Para cualquier cosa sobre tus datos escribinos{' '}
          {email ? (
            <>
              a <a className="underline underline-offset-4" href={`mailto:${email}`}>{email}</a>
            </>
          ) : (
            'por WhatsApp al local'
          )}
          {telefono ? (
            <>
              {' '}o al teléfono {' '}
              <a className="underline underline-offset-4" href={`tel:${telefono.replace(/\s/g, '')}`}>
                {telefono}
              </a>
            </>
          ) : null}
          . También podés hablar con el personal en el mostrador.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Qué datos guardamos y para qué</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            <strong>Tu nombre y tu WhatsApp.</strong> Para identificarte en el club, sumar tus
            visitas y avisarte cuando tenés un premio. Sin esto no hay tarjeta: son parte del
            servicio que pediste.
          </li>
          <li>
            <strong>Tu fecha de nacimiento (opcional).</strong> Solo para saludarte el día de tu
            cumpleaños. No la usamos para nada más y podés dejarla vacía: el club funciona igual.
          </li>
          <li>
            <strong>Cómo te identificás (opcional).</strong> Para mandarte solo las promos que te
            interesan. No lo compartimos con nadie y podés borrarlo cuando quieras.
          </li>
          <li>
            <strong>Tus visitas, sellos y premios.</strong> Es el funcionamiento de la tarjeta: sin
            ese registro no se puede saber cuántos sellos tenés.
          </li>
          <li>
            <strong>Las notificaciones del celular (solo si las activás).</strong> Guardamos la
            suscripción técnica del navegador para poder avisarte de un premio. Se apaga cuando
            quieras desde los ajustes del navegador o del teléfono.
          </li>
        </ul>
        <p className="text-sm leading-relaxed">
          <strong>No te pedimos datos sensibles.</strong> La fecha de nacimiento y cómo te
          identificás son opcionales: si preferís no decirlos, no perdés ningún beneficio, ni
          sellos, ni premios, ni promociones.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Con qué base legal</h2>
        <p className="text-sm leading-relaxed">
          Tratamos tus datos según la <strong>Ley 25.326 de Protección de los Datos Personales</strong>{' '}
          de Argentina.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            <strong>Tu consentimiento</strong> para la fecha de nacimiento y cómo te identificás: te
            lo pedimos en el cartel, con un tilde explícito, y podés retirarlo cuando quieras
            borrando el dato.
          </li>
          <li>
            <strong>La ejecución del servicio</strong> para tu nombre, tu WhatsApp y el registro de
            visitas y premios: son lo que hace que la tarjeta del club funcione.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Cuánto tiempo los guardamos</h2>
        <p className="text-sm leading-relaxed">
          Mientras seas parte del club del local. Si borrás un dato, se borra de verdad y no lo
          volvemos a usar. Si pedís que te borren todo el perfil, se eliminan la fecha de nacimiento
          y cómo te identificás. Tu tarjeta (visitas, sellos y premios) sigue existiendo mientras
          sigas siendo cliente del club; si querés darte de baja por completo, escribinos y el local
          elimina tu cuenta.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Tus derechos</h2>
        <p className="text-sm leading-relaxed">
          La ley te da derecho a <strong>acceder</strong> a tus datos, <strong>rectificarlos</strong>{' '}
          si están mal, <strong>actualizarlos</strong> y <strong>suprimirlos</strong> (los llamados
          derechos ARCO). También podés pedir que no usemos tus datos para mandarte promociones.
        </p>
        <p className="text-sm leading-relaxed">
          Lo más rápido es hacerlo vos mismo desde{' '}
          <Link className="underline underline-offset-4" href={RUTAS.perfil(params.tenant)}>
            Mis datos
          </Link>
          : ahí ves todo lo que declaraste, lo cambiás o lo borrás con un toque. Si preferís
          pedírnoslo, escribinos {email ? <>a <strong>{email}</strong></> : 'al WhatsApp del local'} y
          te contestamos dentro de los 10 días corridos que fija la ley.
        </p>
        <p className="text-sm leading-relaxed">
          Si creés que no te respondimos bien, podés reclamar ante la{' '}
          <strong>Agencia de Acceso a la Información Pública</strong>, que es la autoridad de control
          en Argentina.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Dónde están guardados</h2>
        <p className="text-sm leading-relaxed">
          La base de datos está alojada en servidores que se encuentran en <strong>São Paulo,
          Brasil</strong>. Es una transferencia internacional de datos: el local y la plataforma
          toman los recaudos para que se traten con el mismo cuidado que exige la Ley 25.326, y solo
          los usa para lo que dice esta página. No vendemos ni cedemos tus datos a terceros para
          publicidad.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Notificaciones</h2>
        <p className="text-sm leading-relaxed">
          Las notificaciones son opcionales y las activás vos. Sirven para avisarte que sumaste
          sellos o que tenés un premio para canjear. Si ya no las querés, se desactivan desde los
          ajustes del navegador o del teléfono: dejamos de mandarte mensajes al instante y borramos
          la suscripción cuando el navegador nos avisa.
        </p>
      </section>

      <footer className="flex flex-col gap-3 border-t border-border pt-5">
        <p className="text-xs text-muted-foreground">
          ¿Querés ver, cambiar o borrar tus datos ahora?
        </p>
        <Link
          href={RUTAS.perfil(params.tenant)}
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-primary-foreground"
        >
          Ir a Mis datos
        </Link>
      </footer>
    </main>
  )
}
