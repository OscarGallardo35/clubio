import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';
import { VisitasService } from '../visitas/visitas.service';

/**
 * Datos de la pagina PUBLICA de verificacion (solo lectura, sin login).
 *
 * Privacidad: el token es la UNICA llave. La respuesta NO incluye telefono, email,
 * id, ni apellido completo si no hace falta: solo el nombre de pila. No hay forma de
 * enumerar clientes: sin el token correcto no se devuelve nada.
 */
export interface VerificacionRespuesta {
  /** Nombre de PILA (primer token de `Cliente.nombre`). Nunca el apellido completo. */
  nombre: string;
  negocio: {
    nombre: string;
    slug: string;
    logoUrl: string | null;
    colorPrimario: string;
    colorSecundario: string;
    theme: unknown;
  };
  sellos: {
    actuales: number;
    meta: number;
    premioDesbloqueado: boolean;
  };
  premioTexto: string;
  /**
   * Premio por PUNTOS. `null` cuando el club NO usa puntos (`SOLO_VISITAS`); con `HIBRIDO`
   * o `SOLO_PUNTOS` lleva el progreso real del cliente. Mismas reglas de privacidad que
   * `sellos`: solo el saldo, nunca telefono/email/id.
   */
  puntos: { actuales: number; meta: number; premioDesbloqueado: boolean } | null;
  /** Texto del premio por puntos. `null` cuando el club no usa puntos. */
  premioTextoPuntos: string | null;
  /**
   * Modo de fidelizacion del club, para que la pagina sepa dibujar una barra
   * (`SOLO_VISITAS`/`SOLO_PUNTOS`) o las dos (`HIBRIDO`).
   */
  modoFidelizacion: 'SOLO_VISITAS' | 'SOLO_PUNTOS' | 'HIBRIDO';
  /** ISO de cuando se hizo ESTA verificacion (la pagina lo muestra). */
  verificadoEn: string;
}

/**
 * Verificacion publica de la tarjeta de un cliente por token.
 *
 * El link se arma en la PWA ("Mi tarjeta") cuando el premio esta desbloqueado y viaja
 * dentro del mensaje de WhatsApp al local. El local abre la URL y confirma que los
 * sellos y el premio son reales, sin login y sin exponer datos personales.
 */
@Injectable()
export class VerificacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: SucursalResolverService,
    private readonly visitas: VisitasService,
  ) {}

  async verificar(token: string): Promise<VerificacionRespuesta> {
    // Token vacio/ausente: mismo 404 que un token inventado (nunca una lista).
    if (!token || typeof token !== 'string') {
      throw new NotFoundException('Token de verificacion invalido');
    }

    const cliente = await this.prisma.cliente.findFirst({
      where: { tokenVerificacion: token, eliminadoEn: null },
      select: {
        id: true,
        nombre: true,
        negocioId: true,
        negocio: {
          select: {
            nombre: true,
            slug: true,
            logoUrl: true,
            colorPrimario: true,
            colorSecundario: true,
            theme: true,
          },
        },
      },
    });
    if (!cliente) throw new NotFoundException('Token de verificacion invalido');

    // Saldos EFECTIVOS (sellos Y puntos) con la MISMA regla que GET /visitas/mi-tarjeta.
    // Se usa el helper COMPARTIDO `saldosEfectivos` en vez de reimplementar aca la
    // resolucion GLOBAL vs POR_SUCURSAL (una copia local se desincronizo y dejo esta
    // pagina mostrando solo sellos cuando el club ya era HIBRIDO).
    const sucursal = await this.resolver.resolverSucursal(cliente.negocioId, {
      clienteId: cliente.id,
    });
    const base = await this.visitas.saldosEfectivos(
      cliente.negocioId,
      cliente.id,
      sucursal.id as string,
    );

    // El club "usa puntos" con SOLO_PUNTOS o HIBRIDO. En SOLO_VISITAS los campos de puntos
    // van en null/ausentes de forma coherente (la pagina no muestra nada de puntos).
    const usaPuntos =
      base.modoFidelizacion === 'SOLO_PUNTOS' || base.modoFidelizacion === 'HIBRIDO';

    return {
      // "Cliente Demo" -> "Cliente"; "Laura Fernandez" -> "Laura".
      nombre: primerNombre(cliente.nombre),
      negocio: {
        nombre: cliente.negocio.nombre,
        slug: cliente.negocio.slug,
        logoUrl: cliente.negocio.logoUrl,
        colorPrimario: cliente.negocio.colorPrimario,
        colorSecundario: cliente.negocio.colorSecundario,
        theme: cliente.negocio.theme,
      },
      sellos: {
        actuales: base.sellosActuales,
        meta: base.sellosParaPremio,
        premioDesbloqueado: base.premioDesbloqueado,
      },
      premioTexto: base.premioTexto,
      puntos: usaPuntos
        ? {
            actuales: base.puntosActuales,
            meta: base.premioPorPuntos,
            premioDesbloqueado: base.puntosActuales >= base.premioPorPuntos,
          }
        : null,
      premioTextoPuntos: usaPuntos ? base.premioTextoPuntos : null,
      modoFidelizacion: base.modoFidelizacion,
      verificadoEn: new Date().toISOString(),
    };
  }
}

/** Primer nombre: corta en el primer espacio. Un solo nombre se devuelve entero. */
function primerNombre(nombre: string): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}
