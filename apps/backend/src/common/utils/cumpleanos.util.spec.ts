import {
  anioObjetivo,
  clampDiasAntes,
  cumpleElDiaObjetivo,
  cumpleEfectivo,
  edadALaFecha,
  esAnioBisiesto,
  fechaARDe,
  type FechaAR,
} from './cumpleanos.util';

/**
 * UNIT TESTS de la logica PURA del disparo de cumpleanos. Nada depende del reloj real:
 * todas las funciones reciben la fecha por parametro.
 *
 * `fechaNacimiento` se guarda como DIA DE CALENDARIO a las 00:00 UTC (igual que
 * `parseFechaNacimientoPerfil`), por eso el helper la construye con `Date.UTC`.
 */
const nacido = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));
const hoy = (y: number, m: number, d: number): FechaAR => ({ y, m, d });

describe('esAnioBisiesto', () => {
  it('2024 si, 2026 no, 2000 si (siglo divisible por 400), 1900 no', () => {
    expect(esAnioBisiesto(2024)).toBe(true);
    expect(esAnioBisiesto(2026)).toBe(false);
    expect(esAnioBisiesto(2000)).toBe(true);
    expect(esAnioBisiesto(1900)).toBe(false);
    expect(esAnioBisiesto(2028)).toBe(true);
  });
});

describe('cumpleElDiaObjetivo', () => {
  it('cumple HOY con diasAntes:0 -> true', () => {
    expect(cumpleElDiaObjetivo(nacido(1990, 5, 14), hoy(2026, 5, 14), 0)).toBe(true);
  });

  it('cumple HOY pero con diasAntes:3 -> false (todavia no es la fecha objetivo)', () => {
    expect(cumpleElDiaObjetivo(nacido(1990, 5, 14), hoy(2026, 5, 14), 3)).toBe(false);
  });

  it('cumple en 3 dias con diasAntes:3 -> true (el saludo sale 3 dias antes)', () => {
    expect(cumpleElDiaObjetivo(nacido(1990, 5, 14), hoy(2026, 5, 11), 3)).toBe(true);
  });

  it('cumple en 3 dias con diasAntes:0 -> false (sin adelanto no matchea)', () => {
    expect(cumpleElDiaObjetivo(nacido(1990, 5, 14), hoy(2026, 5, 11), 0)).toBe(false);
  });

  it('un cliente SIN fecha de nacimiento NUNCA entra', () => {
    expect(cumpleElDiaObjetivo(null, hoy(2026, 5, 14), 0)).toBe(false);
    expect(cumpleElDiaObjetivo(undefined, hoy(2026, 5, 14), 7)).toBe(false);
  });

  describe('29/02', () => {
    it('en anio NO bisiesto se saluda el 28/02', () => {
      const n = nacido(2000, 2, 29); // bisiesto, pero ahora miramos 2027
      expect(cumpleElDiaObjetivo(n, hoy(2027, 2, 28), 0)).toBe(true);
      expect(cumpleElDiaObjetivo(n, hoy(2027, 3, 1), 0)).toBe(false);
    });

    it('en anio BISIESTO se saluda el 29/02', () => {
      const n = nacido(2000, 2, 29);
      expect(cumpleElDiaObjetivo(n, hoy(2028, 2, 29), 0)).toBe(true);
      expect(cumpleElDiaObjetivo(n, hoy(2028, 2, 28), 0)).toBe(false);
    });
  });

  describe('cruce de anio', () => {
    it('un cumpleanos del 1/1 con diasAntes:3 se saluda el 29/12 del anio anterior', () => {
      expect(cumpleElDiaObjetivo(nacido(1990, 1, 1), hoy(2026, 12, 29), 3)).toBe(true);
    });

    it('y NO se saluda el 1/1 (eso es diasAntes:0, otro dia)', () => {
      expect(cumpleElDiaObjetivo(nacido(1990, 1, 1), hoy(2026, 12, 29), 0)).toBe(false);
      expect(cumpleElDiaObjetivo(nacido(1990, 1, 1), hoy(2027, 1, 1), 0)).toBe(true);
    });

    it('no compara por strings MM-DD: 31/12 -> 02/01 tambien cruza', () => {
      // Hoy 30/12 + 3 dias = 02/01 del anio siguiente.
      expect(cumpleElDiaObjetivo(nacido(1985, 1, 2), hoy(2026, 12, 30), 3)).toBe(true);
    });
  });
});

describe('anioObjetivo (clave de dedupe una-vez-por-anio)', () => {
  it('sin adelanto es el anio de hoy', () => {
    expect(anioObjetivo(hoy(2026, 5, 14), 0)).toBe(2026);
  });

  it('el saludo adelantado comparte el anio del CUMPLEANOS (no el de hoy)', () => {
    // 29/12 + 3 = 1/1 del anio siguiente.
    expect(anioObjetivo(hoy(2026, 12, 29), 3)).toBe(2027);
  });
});

describe('cumpleEfectivo', () => {
  it('normaliza 29/02 a 28/02 solo en anios no bisiestos', () => {
    expect(cumpleEfectivo(nacido(2000, 2, 29), 2027)).toEqual({ mes: 2, dia: 28 });
    expect(cumpleEfectivo(nacido(2000, 2, 29), 2028)).toEqual({ mes: 2, dia: 29 });
    expect(cumpleEfectivo(nacido(1990, 5, 14), 2027)).toEqual({ mes: 5, dia: 14 });
  });
});

describe('edadALaFecha', () => {
  it('cuenta la edad cumplida (resta 1 si todavia no llego el dia)', () => {
    expect(edadALaFecha(nacido(1990, 5, 14), hoy(2026, 5, 14))).toBe(36); // el dia del cumple
    expect(edadALaFecha(nacido(1990, 5, 14), hoy(2026, 5, 13))).toBe(35); // un dia antes
    expect(edadALaFecha(nacido(1990, 5, 14), hoy(2026, 12, 31))).toBe(36);
  });

  it('null sin fecha de nacimiento', () => {
    expect(edadALaFecha(null, hoy(2026, 5, 14))).toBeNull();
    expect(edadALaFecha(undefined, hoy(2026, 5, 14))).toBeNull();
  });
});

describe('clampDiasAntes', () => {
  it('acota a [0,7] y sanea valores raros', () => {
    expect(clampDiasAntes(3)).toBe(3);
    expect(clampDiasAntes(0)).toBe(0);
    expect(clampDiasAntes(9)).toBe(7);
    expect(clampDiasAntes(-2)).toBe(0);
    expect(clampDiasAntes('3')).toBe(3);
    expect(clampDiasAntes('x')).toBe(0);
    expect(clampDiasAntes(undefined)).toBe(0);
  });
});

describe('fechaARDe', () => {
  it('aplica el offset AR (-3h) sobre un Date UTC', () => {
    // 2026-05-14T02:00:00Z son las 23:00 del 13/05 en AR.
    const r = fechaARDe(new Date('2026-05-14T02:00:00.000Z'));
    expect(r).toEqual({ y: 2026, m: 5, d: 13 });
  });
});
