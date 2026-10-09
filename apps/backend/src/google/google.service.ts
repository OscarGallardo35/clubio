import {
  BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AuditoriaService } from '../common/auditoria/auditoria.service';
import { encrypt, decrypt } from '../common/utils/crypto.util';

// Los endpoints de Google se pueden sobrescribir por env para poder probar
// el flujo completo (callback, refresh) contra un mock sin credenciales reales.
// En produccion se dejan los valores por defecto.
const OAUTH_AUTH = process.env.GOOGLE_OAUTH_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = process.env.GOOGLE_OAUTH_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';

/**
 * Business Profile APIs, las tres modernas. Antes esto apuntaba a
 * `mybusiness.googleapis.com/v4` (la API legacy, RETIRADA): devuelve un 404 HTML,
 * no un error JSON, asi que el AxiosError terminaba en un 500 pelado.
 *
 * `GOOGLE_GBP_API_URL` apunta las TRES al mismo root y es lo que usan los tests
 * contra un mock (`/v1/accounts`, `/v1/accounts/{id}/locations`,
 * `/v1/accounts/{id}/locations/{id}/reviews`). Sin esa var, cada una va a su host real.
 */
const GBP_MOCK = (process.env.GOOGLE_GBP_API_URL ?? '').trim().replace(/\/+$/, '');
const GBP_ACCOUNTS = GBP_MOCK || 'https://mybusinessaccountmanagement.googleapis.com/v1';
const GBP_INFO = GBP_MOCK || 'https://mybusinessbusinessinformation.googleapis.com/v1';
const GBP_REVIEWS = GBP_MOCK || 'https://mybusinessreviews.googleapis.com/v1';

const PLACES_DETAILS =
  process.env.GOOGLE_PLACES_URL ?? 'https://maps.googleapis.com/maps/api/place/details/json';

const STATE_PREFIX = 'google:oauth:state:';
const STATE_TTL = 300; // 5 min

const SCOPE = 'https://www.googleapis.com/auth/business.manage';

interface TokensGoogle {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

@Injectable()
export class GoogleService {
  private readonly logger = new Logger('Google');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private get clientId() { return (process.env.GOOGLE_CLIENT_ID ?? '').trim(); }
  private get clientSecret() { return (process.env.GOOGLE_CLIENT_SECRET ?? '').trim(); }
  private get redirectUri() {
    return (process.env.GOOGLE_OAUTH_REDIRECT_URI ?? '').trim() ||
      'http://localhost:3000/api/google/callback';
  }

  private get configurado() { return !!this.clientId && !!this.clientSecret; }

  /** Estado publico de la integracion (sin exponer tokens). */
  async estado(negocioId: string) {
    const integracion = await this.prisma.integracionGoogle.findUnique({
      where: { negocioId },
      select: {
        googleAccountId: true, googleLocationId: true, googleAccountName: true,
        googleLocationName: true, estado: true, conectadoEn: true, expiryDate: true,
      },
    });
    return {
      configurado: this.configurado,
      conectado: !!integracion && integracion.estado === 'CONECTADO',
      oauthDisponible: this.configurado,
      integracion,
    };
  }

  /**
   * Paso 1 del OAuth: genera la URL de consentimiento.
   * El `state` es aleatorio y se guarda en Redis con TTL 5 min, ligado al
   * negocio y al empleado que inicio el flujo (evita CSRF).
   */
  async urlAutorizacion(negocioId: string, empleadoId: string) {
    if (!this.configurado) {
      throw new BadRequestException(
        'Google OAuth no configurado: faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET',
      );
    }
    const state = randomUUID();
    await this.redis.set(
      `${STATE_PREFIX}${state}`,
      JSON.stringify({ negocioId, empleadoId, creadoEn: Date.now() }),
      STATE_TTL,
    );

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',       // fuerza refresh_token en cada consentimiento
      include_granted_scopes: 'true',
      state,
    });
    return { url: `${OAUTH_AUTH}?${params.toString()}`, state, expiraEnSegundos: STATE_TTL };
  }

  /** Consume el state de Redis. Devuelve null si no existe o ya vencio. */
  private async consumirState(state: string) {
    if (!state) return null;
    const clave = `${STATE_PREFIX}${state}`;
    const raw = await this.redis.get(clave).catch(() => null);
    if (!raw) return null;
    await this.redis.del(clave).catch(() => undefined); // un solo uso
    try {
      return JSON.parse(raw) as { negocioId: string; empleadoId: string };
    } catch {
      return null;
    }
  }

  /** Paso 2: el callback canjea el `code`, cifra los tokens y los guarda. */
  async callback(code: string, state: string) {
    const ctx = await this.consumirState(state);
    if (!ctx) {
      throw new BadRequestException('State de OAuth invalido, vencido o ya usado');
    }
    if (!code) throw new BadRequestException('Falta el parametro code');

    const tokens = await this.intercambiarCodigo(code);
    if (!tokens.access_token) throw new InternalServerErrorException('Google no devolvio access_token');

    const expira = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

    // Tokens CIFRADOS con AES-256-GCM antes de tocar la base.
    const previo = await this.prisma.integracionGoogle.findUnique({
      where: { negocioId: ctx.negocioId }, select: { refreshToken: true },
    });
    const refreshCifrado = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : previo?.refreshToken ?? ''; // Google solo manda refresh_token la primera vez

    const integracion = await this.prisma.integracionGoogle.upsert({
      where: { negocioId: ctx.negocioId },
      update: {
        accessToken: encrypt(tokens.access_token),
        refreshToken: refreshCifrado,
        expiryDate: expira,
        estado: 'CONECTADO',
      },
      create: {
        negocioId: ctx.negocioId,
        accessToken: encrypt(tokens.access_token),
        refreshToken: refreshCifrado,
        expiryDate: expira,
        estado: 'CONECTADO',
      },
      select: { negocioId: true, expiryDate: true, estado: true },
    });

    await this.auditoria.registrar({
      negocioId: ctx.negocioId, accion: 'google.conectado', empleadoId: ctx.empleadoId,
      detalle: { expiryDate: expira.toISOString() },
    });

    return { conectado: true, negocioId: integracion.negocioId, expiraEn: integracion.expiryDate };
  }

  private async intercambiarCodigo(code: string): Promise<TokensGoogle> {
    const { data } = await axios.post<TokensGoogle>(
      OAUTH_TOKEN,
      new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
    );
    return data;
  }

  private async refrescar(refreshToken: string): Promise<TokensGoogle> {
    const { data } = await axios.post<TokensGoogle>(
      OAUTH_TOKEN,
      new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
    );
    return data;
  }

  /**
   * Devuelve un access token VALIDO, refrescando antes de llamar a la API si
   * esta por vencer (margen de 60s) o ya vencio.
   */
  async accessTokenValido(negocioId: string): Promise<string | null> {
    const integracion = await this.prisma.integracionGoogle.findUnique({
      where: { negocioId },
      select: { accessToken: true, refreshToken: true, expiryDate: true, estado: true },
    });
    if (!integracion || integracion.estado !== 'CONECTADO') return null;

    const margen = 60_000;
    if (integracion.expiryDate.getTime() - margen > Date.now()) {
      return decrypt(integracion.accessToken);
    }

    if (!integracion.refreshToken) {
      await this.marcarError(negocioId, 'Sin refresh token: hay que reconectar Google');
      return null;
    }

    try {
      const nuevos = await this.refrescar(decrypt(integracion.refreshToken));
      if (!nuevos.access_token) throw new Error('respuesta sin access_token');
      const expira = new Date(Date.now() + (nuevos.expires_in ?? 3600) * 1000);
      await this.prisma.integracionGoogle.update({
        where: { negocioId },
        data: { accessToken: encrypt(nuevos.access_token), expiryDate: expira, estado: 'CONECTADO' },
      });
      return nuevos.access_token;
    } catch (e) {
      await this.marcarError(negocioId, `Refresh fallo: ${(e as Error).message}`);
      return null;
    }
  }

  private async marcarError(negocioId: string, motivo: string) {
    this.logger.error(`Google ${negocioId}: ${motivo}`);
    await this.prisma.integracionGoogle
      .update({ where: { negocioId }, data: { estado: 'ERROR' } })
      .catch(() => undefined);
    await this.auditoria.registrar({ negocioId, accion: 'google.error', detalle: { motivo } });
  }

  /**
   * ¿Google rechazo las credenciales? Solo el 401 significa que hay que reconectar.
   * Un 403 (cuenta sin permiso / API sin habilitar), 404 (host retirado) o 429 (cuota)
   * son problemas de configuracion o de cuota, no del token.
   */
  private rompeLasCredenciales(e: unknown): boolean {
    return (e as { response?: { status?: number } })?.response?.status === 401;
  }

  /**
   * Traduce el error de Google a un motivo legible para el panel.
   *
   * El sobre de error trae `error.message` ("Quota exceeded for quota metric ...") y,
   * cuando es cuota, la cuota del proyecto en `details[].metadata.quota_limit_value`
   * (0 = el proyecto no tiene acceso asignado todavia). Los 4xx tipicos se anotan con
   * una pista: son los que se ven al configurar, no bugs del codigo.
   */
  private motivoDeGoogle(e: unknown): string {
    const err = e as {
      message?: string;
      response?: {
        status?: number;
        data?: {
          error?: {
            message?: string;
            status?: string;
            details?: Array<{ metadata?: Record<string, string> }>;
          };
        };
      };
    };
    const status = err?.response?.status;
    const g = err?.response?.data?.error;
    const meta = Array.isArray(g?.details)
      ? g?.details.map((d) => d?.metadata).find((m) => m?.quota_limit_value !== undefined)
      : undefined;
    const cuota = meta
      ? ` (cuota del proyecto: ${meta.quota_limit_value} en ${meta.quota_metric ?? 'la metrica'})`
      : '';
    if (g?.message) {
      return `Google rechazo la consulta [${status ?? 'sin status'} ${g.status ?? ''}]`.trim() +
        `: ${g.message}${cuota}`;
    }
    const pistas: Record<number, string> = {
      401: 'el access token fue rechazado',
      403: 'puede faltar habilitar la API o el permiso sobre la cuenta',
      404: 'el host de la API esta retirado, no habilitado, o el recurso no existe',
      429: 'cuota agotada o sin acceso al programa de Business Profile',
    };
    const pista = status && pistas[status] ? ` — ${pistas[status]}` : '';
    if (status) return `Google respondio ${status} sin detalle${cuota}${pista}`;
    return `No pudimos hablar con Google: ${err?.message ?? 'error desconocido'}`;
  }

  /**
   * Lista las cuentas y ubicaciones de Google del negocio.
   * Necesario porque el OAuth NO devuelve accountId/locationId: hay que
   * elegirlos, y sin ellos la Business Profile API no se puede llamar.
   */
  async descubrirUbicaciones(negocioId: string) {
    const token = await this.accessTokenValido(negocioId);
    if (!token) {
      throw new BadRequestException('Google no esta conectado o el token no es valido');
    }

    const cab = { headers: { Authorization: `Bearer ${token}` }, timeout: 12_000 };

    // Las cuentas van SIEMPRE envueltas: si Google falla, el panel tiene que ver el
    // motivo real (cuota, API sin habilitar, host retirado), no un 500 sin detalle.
    let accounts: Array<Record<string, any>> = [];
    try {
      const { data: cuentas } = await axios.get(`${GBP_ACCOUNTS}/accounts`, cab);
      accounts = cuentas?.accounts ?? [];
    } catch (e) {
      const motivo = this.motivoDeGoogle(e);
      this.logger.error(`Google ${negocioId} (ubicaciones): ${motivo}`);
      if (this.rompeLasCredenciales(e)) {
        await this.marcarError(negocioId, motivo);
      } else {
        // A PROPOSITO no se llama a marcarError() aca: marcar la integracion como ERROR
        // la saca de 'CONECTADO', y con eso el panel dice "Sin conectar", desaparece la
        // lista de ubicaciones y `accessTokenValido` corta el sync de resenas. Una cuota
        // agotada o un host caido NO significan que haya que reconectar. Queda en
        // auditoria para tener el rastro.
        await this.auditoria.registrar({
          negocioId, accion: 'google.error', detalle: { motivo, contexto: 'ubicaciones' },
        });
      }
      throw new BadRequestException(motivo);
    }

    const ubicaciones: Array<Record<string, unknown>> = [];
    for (const c of accounts) {
      const accountId = String(c.name ?? '').replace('accounts/', '');
      if (!accountId) continue;
      try {
        // `readMask` es obligatorio en la API moderna: sin el, la respuesta viene vacia.
        const { data: locs } = await axios.get(`${GBP_INFO}/accounts/${accountId}/locations`, {
          ...cab,
          params: { readMask: 'name,title,storefrontAddress' },
        });
        for (const l of (locs?.locations ?? []) as Array<Record<string, any>>) {
          ubicaciones.push({
            accountId,
            accountName: c.accountName ?? null,
            // El recurso viene con nombre completo (accounts/{a}/locations/{l}):
            // guardamos SOLO el id y lo rearmamos donde haga falta.
            locationId: String(l.name ?? '').split('/').pop() ?? '',
            locationName: l.title ?? null,
            direccion: l.storefrontAddress?.addressLines?.join(', ') ?? null,
          });
        }
      } catch (e) {
        this.logger.warn(`No se pudieron leer ubicaciones de accounts/${accountId}: ${(e as Error).message}`);
      }
    }
    return { total: ubicaciones.length, data: ubicaciones };
  }

  /** Fija la ubicacion cuyas resenas se van a sincronizar. */
  async seleccionarUbicacion(
    negocioId: string,
    empleadoId: string,
    dto: { accountId: string; locationId: string; accountName?: string; locationName?: string },
  ) {
    const existe = await this.prisma.integracionGoogle.findUnique({
      where: { negocioId }, select: { id: true },
    });
    if (!existe) throw new NotFoundException('Google no esta conectado para este negocio');

    const actualizada = await this.prisma.integracionGoogle.update({
      where: { negocioId },
      data: {
        googleAccountId: dto.accountId,
        googleLocationId: dto.locationId,
        googleAccountName: dto.accountName ?? null,
        googleLocationName: dto.locationName ?? null,
      },
      select: { googleAccountId: true, googleLocationId: true, googleLocationName: true },
    });

    await this.auditoria.registrar({
      negocioId, accion: 'google.ubicacion_seleccionada', empleadoId,
      detalle: { locationId: dto.locationId },
    });
    return actualizada;
  }

  async desconectar(negocioId: string, empleadoId: string) {
    const existe = await this.prisma.integracionGoogle.findUnique({
      where: { negocioId }, select: { id: true },
    });
    if (!existe) throw new NotFoundException('Este negocio no tiene Google conectado');

    await this.prisma.integracionGoogle.delete({ where: { negocioId } });
    await this.auditoria.registrar({ negocioId, accion: 'google.desconectado', empleadoId });
    return { desconectado: true };
  }

  /**
   * Trae resenas desde Google.
   * - Con OAuth: Business Profile API (todas las resenas).
   * - Sin OAuth pero con placeId + GOOGLE_PLACES_API_KEY: Places (hasta 5).
   * - Sin nada: lista vacia y un motivo (no rompe la PWA).
   */
  async obtenerResenasDeGoogle(negocioId: string): Promise<{
    origen: 'oauth' | 'places' | 'ninguno';
    motivo?: string;
    resenas: Array<{
      reviewId: string; autorNombre: string; autorFotoUrl?: string | null;
      estrellas: number; texto?: string | null; fechaResena: Date;
    }>;
  }> {
    const token = await this.accessTokenValido(negocioId);
    if (token) {
      const integracion = await this.prisma.integracionGoogle.findUnique({
        where: { negocioId },
        select: { googleAccountId: true, googleLocationId: true },
      });
      if (integracion?.googleAccountId && integracion.googleLocationId) {
        try {
          // Nombre completo del recurso moderno: accounts/{a}/locations/{l}/reviews.
          const url = `${GBP_REVIEWS}/accounts/${integracion.googleAccountId}/locations/${integracion.googleLocationId}/reviews`;
          const { data } = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}` }, timeout: 12_000,
            params: { pageSize: 50 },
          });
          const resenas = (data?.reviews ?? []).map((r: Record<string, any>) => ({
            reviewId: String(r.reviewId),
            autorNombre: r.reviewer?.displayName ?? 'Anonimo',
            autorFotoUrl: r.reviewer?.profilePhotoUrl ?? null,
            estrellas: this.estrellas(r.starRating),
            texto: r.comment ?? null,
            fechaResena: new Date(r.createTime ?? Date.now()),
          }));
          return { origen: 'oauth', resenas };
        } catch (e) {
          await this.marcarError(negocioId, `Fallo al leer resenas: ${(e as Error).message}`);
        }
      }
    }

    // Fallback: Places API con el placeId del negocio
    const clave = (process.env.GOOGLE_PLACES_API_KEY ?? '').trim();
    const negocio = await this.prisma.negocio.findUnique({
      where: { id: negocioId }, select: { placeId: true },
    });
    if (clave && negocio?.placeId) {
      try {
        const { data } = await axios.get(process.env.GOOGLE_PLACES_URL ?? PLACES_DETAILS, {
          params: { place_id: negocio.placeId, fields: 'reviews', key: clave, language: 'es' },
          timeout: 12_000,
        });
        const resenas = (data?.result?.reviews ?? []).map((r: Record<string, any>, i: number) => ({
          reviewId: `places:${negocio.placeId}:${r.time ?? i}`,
          autorNombre: r.author_name ?? 'Anonimo',
          autorFotoUrl: r.profile_photo_url ?? null,
          estrellas: Number(r.rating ?? 0),
          texto: r.text ?? null,
          fechaResena: new Date((r.time ?? Math.floor(Date.now() / 1000)) * 1000),
        }));
        return { origen: 'places', resenas };
      } catch (e) {
        return { origen: 'ninguno', motivo: `Places fallo: ${(e as Error).message}`, resenas: [] };
      }
    }

    return {
      origen: 'ninguno',
      motivo: this.configurado
        ? 'Sin integracion OAuth activa ni placeId configurado'
        : 'Google no configurado (faltan GOOGLE_CLIENT_ID/SECRET y GOOGLE_PLACES_API_KEY)',
      resenas: [],
    };
  }

  private estrellas(valor: unknown): number {
    const mapa: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    if (typeof valor === 'string' && mapa[valor]) return mapa[valor];
    const n = Number(valor);
    return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 0;
  }

  /**
   * Valida el token de verificacion de Pub/Sub con timingSafeEqual.
   * Comparacion en tiempo constante: `===` filtraria el prefijo correcto.
   */
  verificarTokenPubSub(recibido?: string) {
    const esperado = (process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN ?? '').trim();
    if (!esperado) {
      throw new InternalServerErrorException('GOOGLE_PUBSUB_VERIFICATION_TOKEN no configurado');
    }
    const a = Buffer.from(recibido ?? '', 'utf8');
    const b = Buffer.from(esperado, 'utf8');
    // timingSafeEqual exige igual longitud; si difieren, comparo contra si mismo
    // (misma cantidad de trabajo) y devuelvo false.
    const iguales = a.length === b.length && timingSafeEqual(a, b);
    if (!iguales) throw new BadRequestException('Token de verificacion de Pub/Sub invalido');
    return true;
  }
}