'use client'

import * as React from 'react'
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  GoogleReviews,
  Input,
  Label,
  Progress,
  Separator,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TarjetaSellos,
  type EstadoTarjeta,
  type TamanoTarjeta,
} from '@repo/ui'

const COLOR_PRIMARIO = '#d93d2d'
const COLOR_SECUNDARIO = '#f67d70'
const ESTADOS: EstadoTarjeta[] = ['vacia', 'progreso', 'casi', 'completa', 'canjeada']
const TAMANOS: TamanoTarjeta[] = ['full', 'medium', 'small', 'micro']

const actualesDe = (e: EstadoTarjeta, meta = 10) =>
  e === 'vacia' ? 0 : e === 'casi' ? meta - 1 : e === 'completa' || e === 'canjeada' ? meta : 3

/** Fondo con el degradado de la marca: sin esto el glassmorphism se ve plano. */
function PanelMarca({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-3xl p-5 ${className ?? ''}`}
      style={{
        background: `linear-gradient(135deg, ${COLOR_PRIMARIO}, ${COLOR_SECUNDARIO})`,
        ['--color-primary' as string]: COLOR_PRIMARIO,
        ['--color-secondary' as string]: COLOR_SECUNDARIO,
      }}
    >
      {children}
    </div>
  )
}

function Seccion({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">
        {n}. {titulo}
      </h2>
      {children}
    </section>
  )
}

const RESENAS = [
  {
    autorNombre: 'Lucia Gomez',
    estrellas: 5,
    texto: 'Excelente atencion y la milanesa espectacular. Volvemos seguro.',
    fechaResena: new Date('2026-09-14'),
    autorFotoUrl: 'https://lh3.googleusercontent.com/a/placeholder.jpg',
  },
  { autorNombre: 'Martin Perez', estrellas: 4, texto: 'Muy rico todo, el servicio rapido.', fechaResena: new Date('2026-09-02') },
  { autorNombre: 'Sofia Diaz', estrellas: 5, texto: 'El mejor bar del barrio, siempre impecable.', fechaResena: new Date('2026-08-21') },
  { autorNombre: 'Jorge Ruiz', estrellas: 3, texto: 'Normal, no me quejo.', fechaResena: new Date('2026-08-10') },
  ...Array.from({ length: 6 }, (_, i) => ({
    autorNombre: `Cliente ${i + 5}`,
    estrellas: 5,
    texto: 'Muy buena experiencia, lo recomiendo. '.repeat(6).trim(),
    fechaResena: new Date(`2026-0${(i % 8) + 1}-05`),
  })),
]

export function DevUi() {
  const [reducido, setReducido] = React.useState(false)
  const [hoja, setHoja] = React.useState<null | 'auto' | 'media' | 'completa'>(null)
  const [actuales, setActuales] = React.useState(3)
  const [estado, setEstado] = React.useState<EstadoTarjeta | undefined>('progreso')
  const [verMas, setVerMas] = React.useState(false)

  return (
    <main className="mx-auto max-w-4xl space-y-12 p-4 pb-24">
      <header className="space-y-3 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">@repo/ui — banco de pruebas</h1>
          <Badge variant="secondary">commit {process.env.NEXT_PUBLIC_COMMIT ?? 'dev'}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Solo desarrollo: en produccion esta ruta devuelve 404.</p>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={reducido}
            onChange={(e) => setReducido(e.target.checked)}
            className="size-5"
          />
          <span className="text-sm font-medium">reducedMotion (accesibilidad)</span>
        </label>
      </header>

      <Seccion n={1} titulo="TarjetaSellos — 5 estados x 4 tamanos">
        {TAMANOS.map((tam) => (
          <div key={tam} className="space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">tamaño: {tam}</p>
            <PanelMarca>
              <div className="flex items-start gap-5 overflow-x-auto pb-2">
                {ESTADOS.map((e) => (
                  <div key={e} className="shrink-0 space-y-1">
                    <p className="text-xs font-medium text-white/80">{e}</p>
                    <TarjetaSellos
                      nombreCliente="Lucia"
                      nombreNegocio="Bar La Esquina"
                      tipo="VISITAS"
                      actuales={actualesDe(e)}
                      meta={10}
                      premioTexto="Cafe gratis"
                      colorPrimario={COLOR_PRIMARIO}
                      colorSecundario={COLOR_SECUNDARIO}
                      tamaño={tam}
                      estado={e}
                      mostrarUltimaVisita={tam === 'full'}
                      ultimaVisita={new Date(Date.now() - 3 * 3600 * 1000)}
                      reducedMotion={reducido}
                    />
                  </div>
                ))}
              </div>
            </PanelMarca>
          </div>
        ))}
      </Seccion>

      <Seccion n={2} titulo="BottomSheet">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setHoja('auto')}>Abrir auto</Button>
          <Button variant="secondary" onClick={() => setHoja('media')}>
            Abrir media (50vh)
          </Button>
          <Button variant="outline" onClick={() => setHoja('completa')}>
            Abrir completa (90vh)
          </Button>
        </div>
        <BottomSheet
          abierto={hoja !== null}
          onCerrar={() => setHoja(null)}
          titulo={`Hoja ${hoja ?? ''}`}
          altura={hoja ?? 'auto'}
          reducedMotion={reducido}
        >
          <div className="space-y-3 pb-4">
            <p className="text-sm">
              Arrastra el handle hacia abajo, toca afuera o presiona Escape para cerrar.
            </p>
            <Button size="sm" onClick={() => setVerMas((v) => !v)}>
              {verMas ? 'Ver menos contenido' : 'Ver mas contenido'}
            </Button>
            {(verMas ? Array.from({ length: 24 }) : Array.from({ length: 3 })).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 text-sm">
                  Fila {i + 1} — contenido scrolleable para probar overscroll y el drag desde el contenido.
                </CardContent>
              </Card>
            ))}
          </div>
        </BottomSheet>
      </Seccion>

      <Seccion n={3} titulo="GoogleReviews">
        <div className="grid gap-4 md:grid-cols-2">
          <GoogleReviews placeId="ChIJdemo" negocioNombre="Bar La Esquina" resenas={[]} reducedMotion={reducido} />
          <GoogleReviews
            placeId="ChIJdemo"
            negocioNombre="Bar La Esquina"
            resenas={RESENAS.slice(0, 3)}
            reducedMotion={reducido}
          />
          <GoogleReviews placeId="ChIJdemo" negocioNombre="Bar La Esquina" resenas={RESENAS} reducedMotion={reducido} />
          <div className="space-y-4">
            <GoogleReviews placeId="ChIJdemo" negocioNombre="Bar La Esquina" cargando />
            <GoogleReviews
              placeId="ChIJdemo"
              negocioNombre="Bar La Esquina"
              error="No pudimos conectar con Google"
              onReintentar={() => undefined}
            />
            <p className="text-sm text-muted-foreground">
              Sin placeId el componente no renderiza nada (autoproteccion):
            </p>
            <GoogleReviews placeId={null} negocioNombre="Bar La Esquina" />
          </div>
        </div>
      </Seccion>

      <Seccion n={4} titulo="Basicos">
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map((v) => (
              <Button key={v} variant={v}>
                {v}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['default', 'lg', 'sm', 'icon', 'icon-sm'] as const).map((s) => (
              <Button key={s} size={s}>
                {s === 'icon' || s === 'icon-sm' ? '+' : s}
              </Button>
            ))}
            <Button disabled>deshabilitado</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['default', 'secondary', 'destructive', 'outline', 'vegano', 'sin-tacc', 'picante', 'nuevo'] as const).map(
              (v) => (
                <Badge key={v} variant={v}>
                  {v}
                </Badge>
              ),
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="tel">WhatsApp (56px, text-base: sin zoom en iOS)</Label>
            <Input id="tel" placeholder="+54 9 11 1234-5678" inputMode="numeric" autoComplete="tel" />
          </div>
          <div className="space-y-2">
            {[0, 33, 66, 100].map((v) => (
              <Progress key={v} value={v} />
            ))}
          </div>
          <Tabs defaultValue="entradas">
            <TabsList>
              <TabsTrigger value="entradas">Entradas</TabsTrigger>
              <TabsTrigger value="principales">Principales</TabsTrigger>
              <TabsTrigger value="postres">Postres</TabsTrigger>
              <TabsTrigger value="bebidas">Bebidas</TabsTrigger>
              <TabsTrigger value="sin-tacc">Sin TACC</TabsTrigger>
            </TabsList>
            <TabsContent value="entradas">
              <Card>
                <CardHeader>
                  <CardTitle>Empanadas de carne</CardTitle>
                  <CardDescription>Tres unidades, masa casera</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-lg font-semibold">$ 4.500</p>
                  <div className="flex gap-2">
                    <Badge variant="picante">picante</Badge>
                    <Badge variant="nuevo">nuevo</Badge>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            {['principales', 'postres', 'bebidas', 'sin-tacc'].map((v) => (
              <TabsContent key={v} value={v}>
                <p className="text-sm">Contenido de {v}</p>
              </TabsContent>
            ))}
          </Tabs>
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">Fin de los basicos</p>
        </div>
      </Seccion>

      <Seccion n={5} titulo="Simuladores de animacion">
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setEstado(undefined)
                setActuales((n) => Math.min(n + 1, 10))
              }}
            >
              Simular sello nuevo
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEstado(undefined)
                setActuales(10)
              }}
            >
              Simular completar tarjeta
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEstado('canjeada')
                setActuales(10)
              }}
            >
              Simular canje
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEstado('progreso')
                setActuales(3)
              }}
            >
              Reset
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            actuales: {actuales} · estado: {estado ?? '(derivado)'} · reducedMotion: {String(reducido)}
          </p>
          <PanelMarca>
            <TarjetaSellos
              nombreCliente="Lucia"
              nombreNegocio="Bar La Esquina"
              tipo="VISITAS"
              actuales={actuales}
              meta={10}
              premioTexto="Cafe gratis"
              colorPrimario={COLOR_PRIMARIO}
              colorSecundario={COLOR_SECUNDARIO}
              tamaño="full"
              estado={estado}
              mostrarUltimaVisita
              ultimaVisita={new Date(Date.now() - 3 * 3600 * 1000)}
              reducedMotion={reducido}
            />
          </PanelMarca>
        </div>
      </Seccion>
    </main>
  )
}
