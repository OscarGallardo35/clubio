'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@repo/ui';
import { configuracionApi } from '@/lib/api';
import { normalizarError } from '@/lib/errores';
import type {
  ConfiguracionAdmin,
  ModoAsignacionPedidos,
  ModoFidelizacion,
  ModoPago,
  TipoPedido,
} from '@/types/api';

/**
 * Configuracion del club.
 *
 * Un solo endpoint (`GET`/`PATCH /configuracion`: la fila de `ConfiguracionClub`) pero tres
 * secciones con sentidos distintos, y cada una guarda SOLO sus campos: un guardado no pisa lo que
 * cambio otra pestana.
 *
 * Lo que NO esta en el formulario, y por que:
 * - `mensajeBienvenida` existe en el modelo pero **no** en `ActualizarConfiguracionDto`: el
 *   `ValidationPipe` con `whitelist` lo descartaria en silencio y el dueno creeria que guardo.
 * - `transferenciaNotas` esta en el mismo caso.
 * - `puntosPorPeso` / `premioPorPuntos` son del programa de puntos, que es otro flujo.
 */
export default function ConfiguracionPage() {
  const [cfg, setCfg] = React.useState<ConfiguracionAdmin | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState('programa');
  const [version, setVersion] = React.useState(0);

  const refetch = React.useCallback(async () => {
    try {
      const r = await configuracionApi.obtener();
      setCfg(r);
      setError(null);
    } catch (e) {
      const { status, mensaje } = normalizarError(e);
      if (status !== 401) setError(mensaje);
    }
  }, []);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (error) toast.error('No pudimos traer la configuracion', { description: error });
  }, [error]);

  // `version` remonta el formulario con los valores frescos del backend (misma idea que el `key`
  // de los dialogos de Carta/Personal): el estado del form no se sincroniza a mano.
  const onGuardado = React.useCallback(async () => {
    await refetch();
    setVersion((v) => v + 1);
  }, [refetch]);

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Configuracion</h1>
        <p className="text-sm text-muted-foreground">
          Como funciona el club, que ve el cliente y como cobra el local.
        </p>
      </header>

      {cfg === null && !error ? <Skeleton className="h-96 w-full" /> : null}

      {cfg ? (
        <>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex w-max gap-1">
              <TabsTrigger value="programa">Programa</TabsTrigger>
              <TabsTrigger value="local">Local</TabsTrigger>
              <TabsTrigger value="pagos">Pagos</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'programa' ? (
            <FormPrograma key={`programa-${version}`} cfg={cfg} onGuardado={onGuardado} />
          ) : null}
          {tab === 'local' ? <FormLocal key={`local-${version}`} cfg={cfg} onGuardado={onGuardado} /> : null}
          {tab === 'pagos' ? <FormPagos key={`pagos-${version}`} cfg={cfg} onGuardado={onGuardado} /> : null}
        </>
      ) : null}

      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Google Business</h2>
            <p className="text-sm text-muted-foreground">
              Conectar la ficha del local para mostrar y responder resenas.
            </p>
          </div>
          {/* Ruta propia y no un tab: el callback de Google redirige a /configuracion/google. */}
          <Link
            href="/configuracion/google"
            className="rounded-xl border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Abrir Google
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Estado de un campo numerico con la misma validacion en las tres secciones. */
function useNumero(inicial: number) {
  const [valor, setValor] = React.useState(String(inicial));
  const numero = Number(valor.replace(',', '.'));
  const valido = valor.trim() !== '' && Number.isFinite(numero);
  return { valor, setValor, numero, valido };
}

function CampoNumero({
  id,
  etiqueta,
  valor,
  onChange,
  ayuda,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  ayuda?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ''))}
        inputMode="decimal"
      />
      {ayuda ? <p className="text-xs text-muted-foreground">{ayuda}</p> : null}
    </div>
  );
}

function Guardar({ guardando, valido, etiqueta }: { guardando: boolean; valido: boolean; etiqueta: string }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" disabled={guardando || !valido}>
        {guardando ? 'Guardando...' : etiqueta}
      </Button>
    </div>
  );
}

function ErrorForm({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error}
    </p>
  );
}

function FilaSwitch({
  id,
  etiqueta,
  checked,
  onChange,
  ayuda,
}: {
  id: string;
  etiqueta: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  ayuda?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{etiqueta}</Label>
        {ayuda ? <p className="text-xs text-muted-foreground">{ayuda}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

const MODOS_FIDELIZACION: ModoFidelizacion[] = ['SOLO_VISITAS', 'SOLO_PUNTOS', 'HIBRIDO'];
const TIPOS_PEDIDO: TipoPedido[] = ['MESA', 'TAKEAWAY', 'DELIVERY'];
const MODOS_PAGO: ModoPago[] = ['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'TARJETA'];
const MODOS_ASIGNACION: ModoAsignacionPedidos[] = ['BROADCAST', 'POR_ROL', 'SOLO_ENCARGADO'];

const ETIQUETA_FIDELIZACION: Record<ModoFidelizacion, string> = {
  SOLO_VISITAS: 'Solo visitas (sellos)',
  SOLO_PUNTOS: 'Solo puntos',
  HIBRIDO: 'Hibrido (visitas + puntos)',
};
const ETIQUETA_PEDIDO: Record<TipoPedido, string> = {
  MESA: 'En el local (mesa)',
  TAKEAWAY: 'Para llevar',
  DELIVERY: 'Delivery',
};
const ETIQUETA_PAGO: Record<ModoPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
  TARJETA: 'Tarjeta',
};
const ETIQUETA_ASIGNACION: Record<ModoAsignacionPedidos, string> = {
  BROADCAST: 'Los ve todo el local',
  POR_ROL: 'Por rol',
  SOLO_ENCARGADO: 'Solo el encargado',
};

/** Programa: como se gana el premio y cada cuanto puede volver el cliente. */
function FormPrograma({ cfg, onGuardado }: { cfg: ConfiguracionAdmin; onGuardado: () => Promise<void> }) {
  const [modo, setModo] = React.useState<ModoFidelizacion>(cfg.modoFidelizacion);
  const sellos = useNumero(cfg.sellosParaPremio);
  const bienvenida = useNumero(cfg.sellosBienvenida);
  const limiteDia = useNumero(cfg.limiteVisitasPorDia);
  const horas = useNumero(cfg.horasMinimasEntreVisitas);
  const [valida, setValida] = React.useState(cfg.requiereValidacionEmpleado);
  const [regalo, setRegalo] = React.useState(cfg.permiteRegaloManual);
  const [resena, setResena] = React.useState(cfg.mostrarResenaPostVisita);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const valido = sellos.valido && bienvenida.valido && limiteDia.valido && horas.valido;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await configuracionApi.actualizar({
        modoFidelizacion: modo,
        sellosParaPremio: sellos.numero,
        sellosBienvenida: bienvenida.numero,
        limiteVisitasPorDia: limiteDia.numero,
        horasMinimasEntreVisitas: horas.numero,
        requiereValidacionEmpleado: valida,
        permiteRegaloManual: regalo,
        mostrarResenaPostVisita: resena,
      });
      toast.success('Programa guardado');
      await onGuardado();
    } catch (err) {
      setError(normalizarError(err).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-5 rounded-2xl border bg-card p-5">
      <div className="space-y-2">
        <Label htmlFor="modo">Como se gana el premio</Label>
        <Select value={modo} onValueChange={(v) => setModo(v as ModoFidelizacion)}>
          <SelectTrigger id="modo" className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODOS_FIDELIZACION.map((m) => (
              <SelectItem key={m} value={m}>
                {ETIQUETA_FIDELIZACION[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {modo !== 'SOLO_VISITAS' ? (
          <p className="text-xs text-muted-foreground">
            Aca se configura el programa de visitas. Los puntos se ajustan por otro lado.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoNumero
          id="sellos"
          etiqueta="Sellos para el premio"
          valor={sellos.valor}
          onChange={sellos.setValor}
          ayuda="Cuantas visitas necesita para el premio."
        />
        <CampoNumero
          id="bienvenida"
          etiqueta="Sellos de bienvenida"
          valor={bienvenida.valor}
          onChange={bienvenida.setValor}
        />
        <CampoNumero
          id="limiteDia"
          etiqueta="Visitas validas por dia"
          valor={limiteDia.valor}
          onChange={limiteDia.setValor}
          ayuda="Tope de visitas que suman el mismo dia."
        />
        <CampoNumero
          id="horas"
          etiqueta="Horas minimas entre visitas"
          valor={horas.valor}
          onChange={horas.setValor}
        />
      </div>

      <div className="space-y-3">
        <FilaSwitch id="valida" etiqueta="El personal valida cada visita" checked={valida} onChange={setValida} />
        <FilaSwitch id="regalo" etiqueta="Permitir regalo manual desde el panel" checked={regalo} onChange={setRegalo} />
        <FilaSwitch id="resena" etiqueta="Pedir resena despues de la visita" checked={resena} onChange={setResena} />
      </div>

      <ErrorForm error={error} />
      <Guardar guardando={guardando} valido={valido} etiqueta="Guardar programa" />
    </form>
  );
}

/** Local: que promete el club al cliente y como entran los pedidos. */
function FormLocal({ cfg, onGuardado }: { cfg: ConfiguracionAdmin; onGuardado: () => Promise<void> }) {
  const [premio, setPremio] = React.useState(cfg.premioTexto);
  const [mensaje, setMensaje] = React.useState(cfg.mensajeBienvenida ?? '');
  const [atendiente, setAtendiente] = React.useState(cfg.numeroAtendiente ?? '');
  const [menuActivo, setMenuActivo] = React.useState(cfg.menuActivo);
  const [tipos, setTipos] = React.useState<TipoPedido[]>(cfg.tiposPedidoHabilitados);
  const [asignacion, setAsignacion] = React.useState<ModoAsignacionPedidos>(cfg.modoAsignacionPedidos);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const valido = premio.trim().length > 0 && tipos.length > 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await configuracionApi.actualizar({
        premioTexto: premio.trim(),
        mensajeBienvenida: mensaje.trim() === '' ? undefined : mensaje.trim(),
        numeroAtendiente: atendiente.trim() === '' ? undefined : atendiente.trim(),
        menuActivo,
        tiposPedidoHabilitados: tipos,
        modoAsignacionPedidos: asignacion,
      });
      toast.success('Local guardado');
      await onGuardado();
    } catch (err) {
      setError(normalizarError(err).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-5 rounded-2xl border bg-card p-5">
      <div className="space-y-2">
        <Label htmlFor="premio">Que gana el cliente</Label>
        <Input
          id="premio"
          value={premio}
          onChange={(e) => setPremio(e.target.value.slice(0, 160))}
          placeholder="Una pizza gratis"
        />
        <p className="text-xs text-muted-foreground">
          Es lo que ve en su tarjeta. Maximo 160 caracteres.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="atendiente">WhatsApp que atiende (opcional)</Label>
        <Input
          id="atendiente"
          value={atendiente}
          onChange={(e) => setAtendiente(e.target.value.slice(0, 40))}
          inputMode="tel"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mensaje">Mensaje de bienvenida (opcional)</Label>
        <Textarea
          id="mensaje"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value.slice(0, 500))}
          placeholder="Bienvenido al club de Bar La Esquina"
        />
        <p className="text-xs text-muted-foreground">Se lo mostramos al cliente en su tarjeta.</p>
      </div>

      <FilaSwitch
        id="menu"
        etiqueta="Menu activo para los clientes"
        checked={menuActivo}
        onChange={setMenuActivo}
        ayuda="Si lo apagas, el cliente sigue usando su tarjeta pero no ve la carta."
      />

      <div className="space-y-3">
        <Label>Formas de pedido habilitadas</Label>
        <p className="text-xs text-muted-foreground">
          Una sucursal puede ajustar esto despues (Config de la sucursal).
        </p>
        {TIPOS_PEDIDO.map((t) => (
          <FilaSwitch
            key={t}
            id={`tipo-${t}`}
            etiqueta={ETIQUETA_PEDIDO[t]}
            checked={tipos.includes(t)}
            onChange={(v) => setTipos((prev) => (v ? [...prev, t] : prev.filter((x) => x !== t)))}
          />
        ))}
        {tipos.length === 0 ? (
          <p role="alert" className="text-xs text-destructive">
            Tiene que quedar al menos una forma de pedido.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="asignacion">Como se reparten los pedidos</Label>
        <Select value={asignacion} onValueChange={(v) => setAsignacion(v as ModoAsignacionPedidos)}>
          <SelectTrigger id="asignacion" className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODOS_ASIGNACION.map((m) => (
              <SelectItem key={m} value={m}>
                {ETIQUETA_ASIGNACION[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ErrorForm error={error} />
      <Guardar guardando={guardando} valido={valido} etiqueta="Guardar local" />
    </form>
  );
}

/** Pagos: con que puede pagar el cliente y a donde transferir. */
function FormPagos({ cfg, onGuardado }: { cfg: ConfiguracionAdmin; onGuardado: () => Promise<void> }) {
  const [modos, setModos] = React.useState<ModoPago[]>(cfg.modosPagoHabilitados);
  const [porDefecto, setPorDefecto] = React.useState<ModoPago>(cfg.modoPagoPorDefecto);
  const [alias, setAlias] = React.useState(cfg.transferenciaAlias ?? '');
  const [cbu, setCbu] = React.useState(cfg.transferenciaCbu ?? '');
  const [titular, setTitular] = React.useState(cfg.transferenciaTitular ?? '');
  const [banco, setBanco] = React.useState(cfg.transferenciaBanco ?? '');
  const [mp, setMp] = React.useState(cfg.linkMercadoPago ?? '');
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const valido = modos.length > 0 && modos.includes(porDefecto);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await configuracionApi.actualizar({
        modosPagoHabilitados: modos,
        modoPagoPorDefecto: porDefecto,
        transferenciaAlias: alias.trim() === '' ? undefined : alias.trim(),
        transferenciaCbu: cbu.trim() === '' ? undefined : cbu.trim(),
        transferenciaTitular: titular.trim() === '' ? undefined : titular.trim(),
        transferenciaBanco: banco.trim() === '' ? undefined : banco.trim(),
        linkMercadoPago: mp.trim() === '' ? undefined : mp.trim(),
      });
      toast.success('Pagos guardado');
      await onGuardado();
    } catch (err) {
      setError(normalizarError(err).mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-5 rounded-2xl border bg-card p-5">
      <div className="space-y-3">
        <Label>Con que puede pagar el cliente</Label>
        {MODOS_PAGO.map((m) => (
          <FilaSwitch
            key={m}
            id={`pago-${m}`}
            etiqueta={ETIQUETA_PAGO[m]}
            checked={modos.includes(m)}
            onChange={(v) => setModos((prev) => (v ? [...prev, m] : prev.filter((x) => x !== m)))}
          />
        ))}
        {modos.length === 0 ? (
          <p role="alert" className="text-xs text-destructive">
            Tiene que quedar al menos una forma de pago.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="porDefecto">Forma de pago por defecto</Label>
        <Select value={porDefecto} onValueChange={(v) => setPorDefecto(v as ModoPago)}>
          <SelectTrigger id="porDefecto" className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modos.map((m) => (
              <SelectItem key={m} value={m}>
                {ETIQUETA_PAGO[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!modos.includes(porDefecto) ? (
          <p role="alert" className="text-xs text-destructive">
            La forma por defecto tiene que estar habilitada arriba.
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <Label>Datos para transferencias</Label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="alias">Alias</Label>
            <Input id="alias" value={alias} onChange={(e) => setAlias(e.target.value.slice(0, 120))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cbu">CBU / CVU</Label>
            <Input id="cbu" value={cbu} onChange={(e) => setCbu(e.target.value.slice(0, 40))} inputMode="numeric" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="titular">Titular</Label>
            <Input id="titular" value={titular} onChange={(e) => setTitular(e.target.value.slice(0, 120))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="banco">Banco</Label>
            <Input id="banco" value={banco} onChange={(e) => setBanco(e.target.value.slice(0, 120))} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mp">Link de Mercado Pago (opcional)</Label>
        <Input
          id="mp"
          value={mp}
          onChange={(e) => setMp(e.target.value)}
          placeholder="https://mpago.la/..."
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <ErrorForm error={error} />
      <Guardar guardando={guardando} valido={valido} etiqueta="Guardar pagos" />
    </form>
  );
}
