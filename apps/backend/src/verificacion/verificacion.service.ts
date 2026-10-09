import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SucursalResolverService } from '../sucursales/sucursal-resolver.service';

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
        sellosActuales: true,
        negocioId: true,
        negocio: {
          select: {
            nombre: true,
            slug: true,
            logoUrl: true,
            colorPrimario: true,
            colorSecundario: true,
            theme: true,
            modoClientes: true,
          },
        },
      },
    });
    if (!cliente) throw new NotFoundException('Token de verificacion invalido');

    const cfg = await this.prisma.configuracionClub.findUnique({
      where: { negocioId: cliente.negocioId },
      select: { sellosParaPremio: true, premioTexto: true },
    });

    // Sellos EFECTIVOS con la MISMA regla que GET /visitas/mi-tarjeta:
    // GLOBAL usa el contador del cliente; POR_SUCURSAL, la tarjeta de la sucursal.
    let sellos = cliente.sellosActuales;
    if (cliente.negocio.modoClientes === 'POR_SUCURSAL') {
      const sucursal = await this.resolver.resolverSucursal(cliente.negocioId, {
        clienteId: cliente.id,
      });
      const tarjeta = await this.prisma.tarjetaClienteSucursal.findUnique({
        where: {
          clienteId_sucursalId: {
            clienteId: cliente.id,
            sucursalId: sucursal.id as string,
          },
        },
        select: { sellosActuales: true },
      });
      sellos = tarjeta?.sellosActuales ?? 0;
    }

    const sellosParaPremio = cfg?.sellosParaPremio ?? 10;
    const premioTexto = cfg?.premioTexto ?? '';

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
        actuales: sellos,
        meta: sellosParaPremio,
        premioDesbloqueado: sellos >= sellosParaPremio,
      },
      premioTexto,
      verificadoEn: new Date().toISOString(),
    };
  }
}

/** Primer nombre: corta en el primer espacio. Un solo nombre se devuelve entero. */
function primerNombre(nombre: string): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}
