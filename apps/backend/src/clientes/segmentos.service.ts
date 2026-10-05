import { Injectable } from '@nestjs/common';
import { EtiquetaCliente } from '@prisma/client';

/**
 * Segmentacion automatica de clientes por actividad.
 * Regla: INACTIVO (>90 dias sin visita) > VIP (>=10 visitas) > RECURRENTE (>=3) > NUEVO.
 */
@Injectable()
export class SegmentosService {
  calcularEtiqueta(totalVisitas: number, ultimaVisita?: Date | null): EtiquetaCliente {
    if (ultimaVisita) {
      const dias = Math.floor((Date.now() - ultimaVisita.getTime()) / 86_400_000);
      if (dias > 90) return EtiquetaCliente.INACTIVO;
    }
    if (totalVisitas >= 10) return EtiquetaCliente.VIP;
    if (totalVisitas >= 3) return EtiquetaCliente.REGULAR;
    return EtiquetaCliente.NUEVO;
  }

  /** Progreso de sellos para la tarjeta del club. */
  progreso(sellosActuales: number, sellosParaPremio: number) {
    const faltantes = Math.max(0, sellosParaPremio - sellosActuales);
    return {
      porcentaje: sellosParaPremio > 0 ? Math.min(100, Math.round((sellosActuales / sellosParaPremio) * 100)) : 0,
      faltantes,
      completado: sellosActuales >= sellosParaPremio,
    };
  }
}
