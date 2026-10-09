import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

/** Tipos de subida soportados hoy. Cada uno define su subcarpeta dentro del negocio. */
export const TIPOS_MEDIA = ['carta'] as const;
export type TipoMedia = (typeof TIPOS_MEDIA)[number];

/**
 * Transformacion que se firma junto a la subida: 800x800 sin agrandar (`c_limit` respeta el
 * tamaño original si es menor), calidad y formato automaticos. Es una DERIVADA de entrega, no
 * un recorte duro: el original subido queda intacto.
 */
export const TRANSFORMACION_FIRMA = 'c_limit,w_800,h_800,q_auto,f_auto';

/** Lo que devuelve `POST /media/firmar-subida`. Todo publico salvo nada: NO incluye el api_secret. */
export interface FirmaSubida {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  transformation: string;
}

interface ConfigCloudinary {
  cloudName: string | undefined;
  apiKey: string | undefined;
  apiSecret: string | undefined;
}

/**
 * Firma de subidas DIRECTAS a Cloudinary.
 *
 * El binario va del NAVEGADOR a Cloudinary; el backend solo firma y nunca ve el archivo. Por eso
 * este servicio no tiene un metodo "subir": recibe un `negocioId` (que SIEMPRE viene del token) y
 * devuelve los parametros que el formulario del admin necesita para mandar el multipart.
 *
 * El `api_secret` se usa para calcular el HMAC-SHA1 y no sale de este archivo jamas: ni en la
 * respuesta, ni en un log.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  /**
   * Config del entorno, leida en cada request (unos pocos gets triviales).
   *
   * DOS formas, en este orden:
   *   1. Las 3 explicitas: `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`.
   *   2. El `CLOUDINARY_URL` (`cloudinary://<api_key>:<api_secret>@<cloud_name>`), que es como lo
   *      carga el host hoy. Se PARSEA a mano en vez de delegar en `cloudinary.config()` porque la
   *      firma necesita `api_key` y `cloud_name` EXPLICITOS para devolverlos al frontend; con el
   *      parser cada valor se verifica por separado y el codigo sigue andando igual cuando el
   *      usuario agregue las 3 vars explicitas (que es el plan, para debugging).
   */
  private config(): ConfigCloudinary {
    const explicitos: ConfigCloudinary = {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
      apiKey: process.env.CLOUDINARY_API_KEY?.trim(),
      apiSecret: process.env.CLOUDINARY_API_SECRET?.trim(),
    };
    if (explicitos.cloudName && explicitos.apiKey && explicitos.apiSecret) return explicitos;

    const parseado = this.parsearUrl(process.env.CLOUDINARY_URL);
    return {
      cloudName: explicitos.cloudName || parseado?.cloudName,
      apiKey: explicitos.apiKey || parseado?.apiKey,
      apiSecret: explicitos.apiSecret || parseado?.apiSecret,
    };
  }

  /**
   * `cloudinary://<api_key>:<api_secret>@<cloud_name>`.
   *
   * Se separa por el ULTIMO `@` (el cloud name no lleva `@`) y por el PRIMER `:` (el api_key no
   * lleva `:`). Cada valor se percent-decodea si se puede; si el `%` es literal se deja igual.
   */
  private parsearUrl(url: string | undefined): ConfigCloudinary | null {
    const limpia = (url ?? '').trim();
    if (!/^cloudinary:\/\//i.test(limpia)) return null;
    const sinEsquema = limpia.replace(/^cloudinary:\/\//i, '');
    const at = sinEsquema.lastIndexOf('@');
    if (at < 0) return null;
    const credenciales = sinEsquema.slice(0, at);
    const cloudName = sinEsquema.slice(at + 1);
    const sep = credenciales.indexOf(':');
    if (sep < 0) return null;
    const apiKey = credenciales.slice(0, sep);
    const apiSecret = credenciales.slice(sep + 1);
    if (!apiKey || !apiSecret || !cloudName) return null;
    const decodificar = (v: string) => {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    };
    return {
      cloudName: decodificar(cloudName),
      apiKey: decodificar(apiKey),
      apiSecret: decodificar(apiSecret),
    };
  }

  /** true si de alguna de las dos formas se resolvieron las 3 piezas. */
  estaConfigurado(): boolean {
    const { cloudName, apiKey, apiSecret } = this.config();
    return Boolean(cloudName && apiKey && apiSecret);
  }

  firmarSubida(negocioId: string, tipo: TipoMedia = 'carta'): FirmaSubida {
    const { cloudName, apiKey, apiSecret } = this.config();
    if (!cloudName || !apiKey || !apiSecret) {
      // Falla RUIDOSA y explicita: sin credenciales no se firma nada (mejor un 503 claro que una
      // firma con un secreto vacio que Cloudinary rechazaria con un error opaco).
      throw new ServiceUnavailableException(
        'La subida de imagenes no esta configurada: falta CLOUDINARY_URL o el trio CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET.',
      );
    }
    if (!TIPOS_MEDIA.includes(tipo)) {
      throw new BadRequestException(`Tipo de subida no soportado: ${tipo}`);
    }

    // Segundos, no milisegundos: Cloudinary espera el timestamp asi y lo usa como parte firmada.
    const timestamp = Math.floor(Date.now() / 1000);
    // La carpeta SIEMPRE cuelga del negocio del TOKEN. Aceptar un negocioId del body permitiria a un
    // dueno escribir (via su firma) en el espacio de otro tenant.
    const folder = `clubio/${negocioId}/${tipo}`;
    const transformation = TRANSFORMACION_FIRMA;

    // Se firma EXACTAMENTE lo que el formulario manda ademas del file: asi Cloudinary puede
    // recalcular el HMAC. El api_secret entra aca y no sale.
    const signature = cloudinary.utils.api_sign_request(
      { folder, timestamp, transformation },
      apiSecret,
    );

    this.logger.log(`Firma de subida emitida: negocio=${negocioId} tipo=${tipo} folder=${folder}`);
    return { timestamp, signature, apiKey, cloudName, folder, transformation };
  }
}
