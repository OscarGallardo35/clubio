import { notFound } from 'next/navigation'
import { DevFlujo } from '@/components/dev-flujo'

export const metadata = { title: 'dev · flujo del club' }

/** Solo en desarrollo: en produccion la ruta no existe. */
export default function DevFlujoPage() {
  if (process.env.NODE_ENV !== 'development') return notFound()
  return <DevFlujo />
}
