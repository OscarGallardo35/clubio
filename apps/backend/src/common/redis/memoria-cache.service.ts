import { Injectable } from '@nestjs/common';

interface Entrada {
  valor: unknown;
  /** Epoch ms en que vence. */
  expira: number;
}

/**
 * Cache en MEMORIA DEL PROCESO, delante de las lecturas read-mostly de Redis.
 *
 * Por que existe: medido en vivo, el backend generaba ~1.44 comandos/s (124.7k/
 * dia = 3.74M/mes = 7.5x el plan Free de Upstash) y ~86% eran LECTURAS REPETIDAS
 * de `sucursal:resolve:*`, `config:efectiva:*` y `plan:features:*`: datos que
 * cambian una vez por semana y se leian en CADA request tenant. Esta capa
 * contesta esas mismas claves sin tocar la red.
 *
 * CONTRATO (importante):
 *  - El TTL en memoria tiene que ser IGUAL O MENOR al de Redis. Nunca mayor: si
 *    fuera mayor, la memoria seguiria sirviendo un dato que Redis ya vencio.
 *  - CADA invalidacion de Redis sobre estas claves tiene que invalidar tambien la
 *    memoria (ver `invalidar*` de los servicios). Por eso es un provider GLOBAL
 *    compartido: `SucursalResolverService.invalidar` tiene que poder borrar de la
 *    MISMA instancia que lee `ConfiguracionService`.
 *
 * HOY HAY UNA SOLA INSTANCIA del backend, asi que esto es coherente: un unico
 * proceso escribe y lee el Map. SI ALGUN DIA SE ESCALA A 2+ INSTANCIAS (replicas
 * de Railway), la invalidacion de una instancia NO alcanza a las otras: las demas
 * seguirian sirviendo el dato viejo hasta que venza el TTL en memoria. Antes de
 * escalar hay que reemplazar esto por un bus de invalidacion (pub/sub de Redis) o
 * volver a leer de Redis. Ojo: la cache de Redis de hoy ya tiene una version mas
 * suave del mismo problema (otra instancia no se entera del `del` hasta el TTL).
 */
@Injectable()
export class MemoriaCacheService {
  private readonly mapa = new Map<string, Entrada>();
  /** Tope de entradas para que un negocio con muchas sucursales no crezca sin freno. */
  private readonly maxEntradas: number;

  constructor() {
    const n = Number(process.env.MEMORIA_CACHE_MAX_ENTRADAS);
    this.maxEntradas = Number.isFinite(n) && n > 0 ? n : 2000;
  }

  get<T>(clave: string): T | undefined {
    const e = this.mapa.get(clave);
    if (!e) return undefined;
    if (e.expira <= Date.now()) {
      this.mapa.delete(clave);
      return undefined;
    }
    return e.valor as T;
  }

  set(clave: string, valor: unknown, ttlSegundos: number): void {
    if (this.maxEntradas > 0 && this.mapa.size >= this.maxEntradas && !this.mapa.has(clave)) {
      // Eviccion del mas viejo (Map preserva orden de insercion). No es LRU fino:
      // alcanza como tope de memoria, no como politica de reemplazo.
      const masVieja = this.mapa.keys().next().value as string | undefined;
      if (masVieja !== undefined) this.mapa.delete(masVieja);
    }
    this.mapa.set(clave, { valor, expira: Date.now() + Math.max(1, ttlSegundos) * 1000 });
  }

  /** Borra claves exactas. Devuelve cuantas existian. */
  del(...claves: string[]): number {
    let borradas = 0;
    for (const c of claves) if (this.mapa.delete(c)) borradas++;
    return borradas;
  }

  /**
   * Borra por patron glob con `*` (misma semantica que `RedisService.delByPattern`,
   * pero en memoria: no hace falta SCAN ni hay riesgo de bloquear nada).
   */
  delByPattern(patron: string): number {
    const re = new RegExp(`^${patron.split('*').map(escaparRegex).join('.*')}$`);
    let borradas = 0;
    for (const clave of [...this.mapa.keys()]) {
      if (re.test(clave)) {
        this.mapa.delete(clave);
        borradas++;
      }
    }
    return borradas;
  }

  get tamano(): number {
    return this.mapa.size;
  }
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
