// Barrel de @repo/types — tipos compartidos entre frontend y backend.
// NO importa @prisma/client: los tipos se definen a mano para no acoplar
// el frontend al ORM. Deben coincidir con el schema.prisma consolidado.

export * from './enums';
export * from './entities';
export * from './dto';
export * from './ws-events';
