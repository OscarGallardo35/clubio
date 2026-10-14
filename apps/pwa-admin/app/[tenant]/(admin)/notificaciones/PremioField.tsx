'use client'

/**
 * Campo compartido para configurar el PREMIO que el cliente ACEPTA desde la notificacion.
 *
 * Lo usan el tab Disparos y el tab Campañas. El descriptor viaja como
 * `{ tipo, cantidad?, texto?, expiraDias? }` (mismo shape que valida el backend).
 *
 * Diferencia con el REGALO: el regalo acredita saldo AL DISPARAR; el premio queda
 * PENDIENTE y el cliente lo acepta desde `/<slug>/premio/<token>`. Por eso un disparo no
 * deberia llevar los dos a la vez (la UI lo avisa).
 */
import * as React from 'react'
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@repo/ui'
import type { PremioDescriptor, TipoPremio } from '@/types/api'

export interface PremioFormValor {
  activo: boolean
  tipo: TipoPremio
  cantidad: string
  texto: string
  expiraDias: string
}

export const PREMIO_FORM_VACIO: PremioFormValor = {
  activo: false,
  tipo: 'SELLOS',
  cantidad: '1',
  texto: '',
  expiraDias: '',
}

/** Descriptor del backend -> estado del formulario. */
export function premioAForm(p: PremioDescriptor | null | undefined): PremioFormValor {
  if (!p || !p.tipo) return { ...PREMIO_FORM_VACIO }
  return {
    activo: true,
    tipo: p.tipo,
    cantidad: p.tipo === 'LIBRE' ? '' : p.cantidad != null ? String(p.cantidad) : '1',
    texto: p.texto ?? '',
    expiraDias: p.expiraDias != null ? String(p.expiraDias) : '',
  }
}

/** Estado del formulario -> descriptor del backend. `undefined` = sin premio. */
export function formAPremio(f: PremioFormValor): PremioDescriptor | undefined {
  if (!f.activo) return undefined
  const cantidad =
    f.tipo === 'LIBRE' ? undefined : Math.max(1, Math.floor(Number(f.cantidad) || 1))
  const expiraDias =
    f.expiraDias.trim() !== '' ? Math.max(1, Math.floor(Number(f.expiraDias) || 1)) : undefined
  const texto = f.texto.trim()
  return {
    tipo: f.tipo,
    ...(cantidad !== undefined ? { cantidad } : {}),
    ...(texto ? { texto } : {}),
    ...(expiraDias !== undefined ? { expiraDias } : {}),
  }
}

/** Etiqueta corta para los listados. `null` si no hay premio. */
export function etiquetaPremio(p: PremioDescriptor | null | undefined): string | null {
  if (!p || !p.tipo) return null
  const base =
    p.tipo === 'SELLOS'
      ? `Premio: ${p.cantidad ?? 1} ${(p.cantidad ?? 1) === 1 ? 'sello' : 'sellos'}`
      : p.tipo === 'PUNTOS'
        ? `Premio: ${p.cantidad ?? 1} ${(p.cantidad ?? 1) === 1 ? 'punto' : 'puntos'}`
        : 'Premio libre'
  return p.texto ? `${base} (${p.texto})` : base
}

export function CamposPremio({
  valor,
  onCambio,
  nota,
}: {
  valor: PremioFormValor
  onCambio: (v: PremioFormValor) => void
  nota?: string | undefined
}) {
  const set = (patch: Partial<PremioFormValor>) => onCambio({ ...valor, ...patch })

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="p-premio-activo">Premio que el cliente acepta</Label>
          <p className="text-xs text-muted-foreground">
            {nota ??
              'El push deja el premio PENDIENTE y el cliente lo acepta desde la notificacion. No se acredita solo.'}
          </p>
        </div>
        <Switch
          id="p-premio-activo"
          checked={valor.activo}
          onCheckedChange={(v) => set({ activo: v })}
        />
      </div>

      {valor.activo ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-premio-tipo">Tipo</Label>
              <Select value={valor.tipo} onValueChange={(v) => set({ tipo: v as TipoPremio })}>
                <SelectTrigger id="p-premio-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SELLOS">Sellos (mueve saldo)</SelectItem>
                  <SelectItem value="PUNTOS">Puntos (mueve saldo)</SelectItem>
                  <SelectItem value="LIBRE">Libre (no mueve saldo)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {valor.tipo !== 'LIBRE' ? (
              <div className="space-y-2">
                <Label htmlFor="p-premio-cantidad">Cantidad</Label>
                <Input
                  id="p-premio-cantidad"
                  value={valor.cantidad}
                  onChange={(e) => set({ cantidad: e.target.value.replace(/[^0-9]/g, '') })}
                  inputMode="numeric"
                  placeholder="1"
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-premio-texto">Texto del premio</Label>
            <Input
              id="p-premio-texto"
              value={valor.texto}
              onChange={(e) => set({ texto: e.target.value.slice(0, 140) })}
              placeholder={valor.tipo === 'LIBRE' ? 'un postre gratis' : 'un premio de regalo'}
            />
            <p className="text-xs text-muted-foreground">Lo ve el cliente y el staff.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-premio-expira">Vence en (dias)</Label>
            <Input
              id="p-premio-expira"
              value={valor.expiraDias}
              onChange={(e) => set({ expiraDias: e.target.value.replace(/[^0-9]/g, '') })}
              inputMode="numeric"
              placeholder="Sin vencimiento"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
