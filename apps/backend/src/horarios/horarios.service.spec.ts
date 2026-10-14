import { HorariosService } from './horarios.service';
import type { RangoHorario } from './helpers/horario-negocio';

/**
 * UNIT TESTS de HorariosService con dependencias mockeadas: cubre lo que NO es puro —
 * la grilla EFECTIVA por sucursal (override) y las excepciones por fecha. `ahora` siempre
 * inyectado.
 */
const ar = (iso: string): Date => new Date(`${iso}:00-03:00`);
const R = (desde: string, hasta: string): RangoHorario => ({ desde, hasta });
const SEMANA = {
  lun: [R('12:00', '15:00')], mar: [R('12:00', '15:00')], mie: [R('12:00', '15:00')],
  jue: [R('12:00', '15:00')], vie: [R('12:00', '15:00')], sab: [R('12:00', '15:00')],
  dom: [R('12:00', '15:00')],
};

function crear(configPorSucursal: Record<string, unknown>, excepciones: unknown[] = []) {
  const prisma = {
    excepcionHorario: { findMany: jest.fn().mockResolvedValue(excepciones) },
  } as never;
  const auditoria = { registrar: jest.fn() } as never;
  const configuracion = {
    configEfectivaCacheada: jest.fn(async (_n: string, sucursalId?: string) => configPorSucursal[sucursalId ?? 'club'] ?? {}),
  } as never;
  return { service: new HorariosService(prisma, auditoria, configuracion), prisma, configuracion };
}

describe('HorariosService.estaAbierto', () => {
  it('SIN HORARIOS configurados = siempre abierto (no rompe los tenants existentes)', async () => {
    const { service } = crear({ club: { horariosAtencion: null, horariosDelivery: null } });
    const r = await service.estaAbierto({ negocioId: 'n1', ahora: ar('2026-10-14T23:30') });
    expect(r.abierto).toBe(true);
    expect(r.motivo).toBe('SIN_HORARIOS');
  });

  it('un objeto VACIO `{}` tambien es "sin horarios"', async () => {
    const { service } = crear({ club: { horariosAtencion: {}, horariosDelivery: {} } });
    const r = await service.estaAbierto({ negocioId: 'n1', ahora: ar('2026-10-14T23:30') });
    expect(r.abierto).toBe(true);
    expect(r.motivo).toBe('SIN_HORARIOS');
  });

  it('bloquea fuera de la franja y devuelve proximaApertura', async () => {
    const { service } = crear({ club: { horariosAtencion: SEMANA } });
    const r = await service.estaAbierto({ negocioId: 'n1', ahora: ar('2026-10-14T16:00') });
    expect(r.abierto).toBe(false);
    expect(r.proximaApertura?.toISOString()).toBe('2026-10-15T15:00:00.000Z');
  });

  it('OVERRIDE POR SUCURSAL: la sucursal cerrada no afecta al club y viceversa', async () => {
    // El club abre 12-15; la sucursal "s1" tiene su propio 20-23.
    const { service, configuracion } = crear({
      club: { horariosAtencion: SEMANA },
      s1: { horariosAtencion: { ...SEMANA, mie: [R('20:00', '23:00')] } },
    });
    const ahora = ar('2026-10-14T13:00');

    const delClub = await service.estaAbierto({ negocioId: 'n1', ahora });
    const deSucursal = await service.estaAbierto({ negocioId: 'n1', sucursalId: 's1', ahora });

    expect(delClub.abierto).toBe(true);
    expect(deSucursal.abierto).toBe(false);
    // El override se resolvio con la sucursal (no con el club).
    expect((configuracion as { configEfectivaCacheada: jest.Mock }).configEfectivaCacheada)
      .toHaveBeenCalledWith('n1', 's1');
  });

  it('EXCEPCION (feriado / cierre temporal) cierra el local aunque la grilla abra', async () => {
    const { service } = crear(
      { club: { horariosAtencion: SEMANA } },
      [{ desdeFecha: new Date('2026-10-14'), hastaFecha: new Date('2026-10-15') }],
    );
    const r = await service.estaAbierto({ negocioId: 'n1', ahora: ar('2026-10-14T13:00') });
    expect(r.abierto).toBe(false);
    expect(r.motivo).toBe('EXCEPCION');
    expect(r.proximaApertura?.toISOString()).toBe('2026-10-16T15:00:00.000Z');
  });

  it('la excepcion alcanza a la sucursal solo si es de esa sucursal o es global (null)', async () => {
    const { service, prisma } = crear({ club: { horariosAtencion: SEMANA } });
    await service.estaAbierto({ negocioId: 'n1', sucursalId: 's1', ahora: ar('2026-10-14T13:00') });
    const where = (prisma as { excepcionHorario: { findMany: jest.Mock } }).excepcionHorario.findMany
      .mock.calls[0][0].where;
    expect(where.negocioId).toBe('n1');
    expect(where.OR).toEqual([{ sucursalId: null }, { sucursalId: 's1' }]);
    expect(where.desdeFecha).toBeDefined();
    expect(where.hastaFecha).toBeDefined();
  });

  it('DELIVERY: atencion abierta + delivery cerrado => el delivery no esta abierto', async () => {
    const { service } = crear({
      club: {
        horariosAtencion: SEMANA,
        horariosDelivery: { ...SEMANA, mie: [R('20:00', '23:00')] },
      },
    });
    const ahora = ar('2026-10-14T13:00');
    expect((await service.estaAbierto({ negocioId: 'n1', tipo: 'atencion', ahora })).abierto).toBe(true);
    const delivery = await service.estaAbierto({ negocioId: 'n1', tipo: 'delivery', ahora });
    expect(delivery.abierto).toBe(false);
  });

  it('sin grilla de delivery, el delivery sigue la atencion', async () => {
    const { service } = crear({ club: { horariosAtencion: SEMANA, horariosDelivery: null } });
    const ahora = ar('2026-10-14T13:00');
    expect((await service.estaAbierto({ negocioId: 'n1', tipo: 'delivery', ahora })).abierto).toBe(true);
  });

  it('estadoLocal devuelve atencion y delivery', async () => {
    const { service } = crear({ club: { horariosAtencion: SEMANA } });
    const estado = await service.estadoLocal('n1', 's1', ar('2026-10-14T13:00'));
    expect(Object.keys(estado)).toEqual(['atencion', 'delivery']);
    expect(estado.atencion.abierto).toBe(true);
  });
});

describe('HorariosService.diasCerrados', () => {
  it('expande el rango de fechas y recorta a la ventana', async () => {
    const { service } = crear({}, [
      { desdeFecha: new Date('2026-10-14'), hastaFecha: new Date('2026-10-16') },
    ]);
    const set = await service.diasCerrados('n1', undefined, ar('2026-10-14T13:00'));
    expect(set.has('2026-10-14')).toBe(true);
    expect(set.has('2026-10-15')).toBe(true);
    expect(set.has('2026-10-16')).toBe(true);
    expect(set.has('2026-10-13')).toBe(false);
  });

  it('invierte fechas corruptas sin romper (usa solo el inicio)', async () => {
    const { service } = crear({}, [
      { desdeFecha: new Date('2026-10-20'), hastaFecha: new Date('2026-10-18') },
    ]);
    const set = await service.diasCerrados('n1', undefined, ar('2026-10-20T13:00'));
    expect(set.has('2026-10-20')).toBe(true);
  });
});
