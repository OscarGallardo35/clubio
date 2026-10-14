import {
  combinarAtencionYDelivery,
  evaluarHorario,
  normalizarHorarioSemana,
  proximaAperturaTexto,
  validarGrilla,
  type RangoHorario,
} from './horario-negocio';

/**
 * UNIT TESTS de la logica pura de horarios. `ahora` SIEMPRE inyectado: nada depende de la
 * hora real. Referencia: 2026-10-14 es MIERCOLES; la hora argentina es UTC-3 (fijo).
 */

/** 'YYYY-MM-DDTHH:mm' hora ARGENTINA -> Date UTC. */
const ar = (iso: string): Date => new Date(`${iso}:00-03:00`);

const R = (desde: string, hasta: string): RangoHorario => ({ desde, hasta });

const TODO_EL_DIA = { desde: '12:00', hasta: '15:00' } as RangoHorario;
const SEMANA_COMPLETA = {
  lun: [TODO_EL_DIA], mar: [TODO_EL_DIA], mie: [TODO_EL_DIA], jue: [TODO_EL_DIA],
  vie: [TODO_EL_DIA], sab: [TODO_EL_DIA], dom: [TODO_EL_DIA],
};

describe('evaluarHorario', () => {
  it('SIN_HORARIOS: sin grilla configurada el local esta SIEMPRE abierto', () => {
    const r = evaluarHorario(null, ar('2026-10-14T04:00'));
    expect(r.abierto).toBe(true);
    expect(r.motivo).toBe('SIN_HORARIOS');
    expect(r.proximaApertura).toBeNull();
    expect(r.cierraEnMin).toBeNull();
  });

  it('ABIERTO: dentro de la franja (borde inferior inclusive)', () => {
    const r = evaluarHorario(SEMANA_COMPLETA, ar('2026-10-14T12:00'));
    expect(r.abierto).toBe(true);
    expect(r.motivo).toBe('DENTRO_DE_HORARIO');
    expect(r.cierraEnMin).toBe(180); // 12:00 -> 15:00
  });

  it('CERRADO: fuera de la franja, con la proxima apertura de manana', () => {
    const r = evaluarHorario(SEMANA_COMPLETA, ar('2026-10-14T16:00'));
    expect(r.abierto).toBe(false);
    expect(r.motivo).toBe('FUERA_DE_HORARIO');
    expect(r.proximaApertura?.toISOString()).toBe('2026-10-15T15:00:00.000Z'); // jue 12:00 AR
  });

  it('CRUZA MEDIANOCHE: 20:00-02:00 abierto a las 01:00 del dia SIGUIENTE (pertenece al dia anterior)', () => {
    // Solo el MARTES tiene la franja que cruza; el miercoles a la 01:00 sigue vigente.
    const horario = { mar: [R('20:00', '02:00')] };
    const r = evaluarHorario(horario, ar('2026-10-14T01:00'));
    expect(r.abierto).toBe(true);
    expect(r.cierraEnMin).toBe(60); // hasta las 02:00
  });

  it('CRUZA MEDIANOCHE: la franja pertenece al dia en que ABRE, no a la madrugada', () => {
    // martes 20:00 -> miercoles 02:00: el miercoles 01:00 esta abierto...
    const horario = { mar: [R('20:00', '02:00')], lun: [R('20:00', '02:00')] };
    expect(evaluarHorario(horario, ar('2026-10-13T01:00')).abierto).toBe(true);
    // ...pero el lunes 01:00 NO (el domingo no tiene franja; la del lunes arranca a las 20:00).
    expect(evaluarHorario(horario, ar('2026-10-12T01:00')).abierto).toBe(false);
  });

  it('CRUZA MEDIANOCHE: abierto 22:00 -> 02:00 y cierra en 4 h de reloj', () => {
    const r = evaluarHorario({ mie: [R('20:00', '02:00')] }, ar('2026-10-14T22:00'));
    expect(r.abierto).toBe(true);
    expect(r.cierraEnMin).toBe(240); // 22:00 -> 24:00 (120) + 00:00 -> 02:00 (120)
  });

  it('hasta "00:00" = hasta la medianoche de ese dia', () => {
    const abierto = evaluarHorario({ mie: [R('18:00', '00:00')] }, ar('2026-10-14T23:00'));
    expect(abierto.abierto).toBe(true);
    expect(abierto.cierraEnMin).toBe(60);
    expect(evaluarHorario({ mie: [R('18:00', '00:00')] }, ar('2026-10-14T00:30')).abierto).toBe(false);
  });

  it('VARIOS RANGOS por dia: cierra en el hueco y reabre el mismo dia', () => {
    const horario = { mie: [R('12:00', '15:00'), R('20:00', '23:00')] };
    const enHueco = evaluarHorario(horario, ar('2026-10-14T16:00'));
    expect(enHueco.abierto).toBe(false);
    // El mismo dia a las 20:00 (UTC 23:00).
    expect(enHueco.proximaApertura?.toISOString()).toBe('2026-10-14T23:00:00.000Z');

    const segunda = evaluarHorario(horario, ar('2026-10-14T21:00'));
    expect(segunda.abierto).toBe(true);
    expect(segunda.cierraEnMin).toBe(120);
  });

  it('DIA SIN RANGOS: grilla configurada pero el dia no tiene franja', () => {
    const horario = { ...SEMANA_COMPLETA, mie: [] };
    const r = evaluarHorario(horario as never, ar('2026-10-14T13:00'));
    expect(r.abierto).toBe(false);
    expect(r.motivo).toBe('SIN_HORARIO_DEL_DIA');
    expect(r.proximaApertura?.toISOString()).toBe('2026-10-15T15:00:00.000Z');
  });

  it('FERIADO: el dia entero esta cerrado por excepcion', () => {
    const r = evaluarHorario(SEMANA_COMPLETA, ar('2026-10-14T13:00'), {
      diasCerrados: new Set(['2026-10-14']),
    });
    expect(r.abierto).toBe(false);
    expect(r.motivo).toBe('EXCEPCION');
    expect(r.proximaApertura?.toISOString()).toBe('2026-10-15T15:00:00.000Z');
  });

  it('CIERRE TEMPORAL: varios dias seguidos cerrados', () => {
    const r = evaluarHorario(SEMANA_COMPLETA, ar('2026-10-14T13:00'), {
      diasCerrados: new Set(['2026-10-14', '2026-10-15']),
    });
    expect(r.abierto).toBe(false);
    expect(r.motivo).toBe('EXCEPCION');
    expect(r.proximaApertura?.toISOString()).toBe('2026-10-16T15:00:00.000Z'); // viernes 12:00 AR
  });

  it('cierra a las 15:00: a las 15:00 ya esta cerrado (borde superior exclusivo)', () => {
    const r = evaluarHorario(SEMANA_COMPLETA, ar('2026-10-14T15:00'));
    expect(r.abierto).toBe(false);
    expect(r.proximaApertura?.toISOString()).toBe('2026-10-15T15:00:00.000Z');
  });

  it('grilla que no abre nunca devuelve proximaApertura null', () => {
    const r = evaluarHorario({ mie: [] }, ar('2026-10-14T13:00'));
    expect(r.abierto).toBe(false);
    expect(r.proximaApertura).toBeNull();
  });
});

describe('combinarAtencionYDelivery', () => {
  it('delivery exige AMBAS abiertas', () => {
    const abierta = evaluarHorario(SEMANA_COMPLETA, ar('2026-10-14T13:00'));
    const cerrada = evaluarHorario({ mie: [R('20:00', '23:00')] }, ar('2026-10-14T13:00'));
    expect(combinarAtencionYDelivery(abierta, cerrada).abierto).toBe(false);
    expect(combinarAtencionYDelivery(abierta, abierta).abierto).toBe(true);
  });

  it('la proxima apertura combinada es la MAS TARDIA de las dos', () => {
    const atencionCerrada = evaluarHorario(SEMANA_COMPLETA, ar('2026-10-14T16:00')); // abre jue 12:00
    const deliveryCerrado = evaluarHorario({ jue: [R('18:00', '22:00')] } as never, ar('2026-10-14T16:00')); // abre jue 18:00
    const r = combinarAtencionYDelivery(atencionCerrada, deliveryCerrado);
    expect(r.abierto).toBe(false);
    expect(r.proximaApertura?.toISOString()).toBe('2026-10-15T21:00:00.000Z'); // jue 18:00 AR
  });
});

describe('normalizarHorarioSemana', () => {
  it('null / undefined / no-objeto / objeto VACIO = sin override', () => {
    expect(normalizarHorarioSemana(null)).toBeNull();
    expect(normalizarHorarioSemana(undefined)).toBeNull();
    expect(normalizarHorarioSemana('x')).toBeNull();
    expect(normalizarHorarioSemana([{ desde: '12:00', hasta: '15:00' }])).toBeNull();
    expect(normalizarHorarioSemana({})).toBeNull();
  });

  it('un dia presente con lista vacia cuenta como CERRADO (no como sin override)', () => {
    const n = normalizarHorarioSemana({ lun: [] });
    expect(n).toEqual({ lun: [] });
  });

  it('descarta rangos invalidos y conserva los validos', () => {
    const n = normalizarHorarioSemana({ lun: [TODO_EL_DIA, { desde: '25:00', hasta: '99:99' }, null] });
    expect(n).toEqual({ lun: [TODO_EL_DIA] });
  });
});

describe('validarGrilla (input del admin)', () => {
  it('acepta una grilla valida y normaliza el objeto vacio a null', () => {
    expect(validarGrilla({ lun: [TODO_EL_DIA] })).toEqual({ lun: [TODO_EL_DIA] });
    expect(validarGrilla({})).toBeNull();
    expect(validarGrilla(null)).toBeNull();
  });

  it('rechaza dia invalido, hora invalida y desde === hasta', () => {
    expect(() => validarGrilla({ lunes: [] })).toThrow(/dia invalido/);
    expect(() => validarGrilla({ lun: [{ desde: '9:00', hasta: '15:00' }] })).toThrow(/hora invalida/);
    expect(() => validarGrilla({ lun: [{ desde: '12:00', hasta: '12:00' }] })).toThrow(/no pueden ser iguales/);
    expect(() => validarGrilla({ lun: 'x' })).toThrow(/deben ser una lista/);
  });
});

describe('proximaAperturaTexto', () => {
  it('hoy / manana / fecha', () => {
    const ahora = ar('2026-10-14T16:00');
    expect(proximaAperturaTexto(ar('2026-10-14T20:00'), ahora)).toBe('hoy 20:00');
    expect(proximaAperturaTexto(ar('2026-10-15T12:00'), ahora)).toBe('manana 12:00');
    expect(proximaAperturaTexto(ar('2026-10-20T12:00'), ahora)).toBe('2026-10-20 12:00');
    expect(proximaAperturaTexto(null, ahora)).toBeNull();
  });
});
