-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) — SaaS Multitenant de Fidelización
-- ============================================================================
-- Este script:
-- 1. Crea los roles de PostgreSQL (app_user, admin_role, migration_role).
-- 2. Habilita RLS en todas las tablas con negocioId.
-- 3. Crea políticas de aislamiento por tenant.
-- 4. Configura el bypass para el rol admin_role (super-admin).
--
-- Ejecutar DESPUÉS de `prisma migrate deploy`.
-- ============================================================================

-- ============================================================================
-- 1. CREACIÓN DE ROLES
-- ============================================================================
-- Nota: los roles deben existir antes de asignarles permisos.
-- Si ya existen, se ignoran los errores con DO $$ ... EXCEPTION.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user WITH LOGIN PASSWORD 'CAMBIAR_EN_PRODUCCION';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin_role') THEN
    CREATE ROLE admin_role WITH LOGIN PASSWORD 'CAMBIAR_EN_PRODUCCION' BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migration_role') THEN
    CREATE ROLE migration_role WITH LOGIN PASSWORD 'CAMBIAR_EN_PRODUCCION' BYPASSRLS;
  END IF;
END
$$;

-- Permisos generales sobre el schema público
GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO admin_role;
GRANT USAGE ON SCHEMA public TO migration_role;

-- app_user: permisos CRUD sobre todas las tablas (RLS filtra las filas)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- admin_role y migration_role: acceso completo (bypass RLS)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO migration_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO admin_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO migration_role;

-- Asegurar que las tablas futuras también tengan los permisos
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO admin_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO admin_role;

-- ============================================================================
-- 2. HABILITACIÓN DE RLS Y POLÍTICAS
-- ============================================================================
-- Cada tabla con negocioId tiene:
--   - ENABLE ROW LEVEL SECURITY
--   - FORCE ROW LEVEL SECURITY (aplica también al owner de la tabla)
--   - Política tenant_isolation: filtra por app.current_negocio_id
--   - Política admin_bypass: permite a admin_role ver todo
--
-- La variable app.current_negocio_id se setea con:
--   SELECT set_config('app.current_negocio_id', '<negocioId>', true);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1. Tablas principales con negocioId directo
-- ----------------------------------------------------------------------------

-- Negocio
ALTER TABLE "Negocio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Negocio" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Negocio";
CREATE POLICY tenant_isolation ON "Negocio"
  USING ("id" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "Negocio";
CREATE POLICY admin_bypass ON "Negocio"
  TO admin_role
  USING (true);

-- Sucursal
ALTER TABLE "Sucursal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sucursal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Sucursal";
CREATE POLICY tenant_isolation ON "Sucursal"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "Sucursal";
CREATE POLICY admin_bypass ON "Sucursal"
  TO admin_role
  USING (true);

-- ConfiguracionClub
ALTER TABLE "ConfiguracionClub" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConfiguracionClub" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConfiguracionClub";
CREATE POLICY tenant_isolation ON "ConfiguracionClub"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "ConfiguracionClub";
CREATE POLICY admin_bypass ON "ConfiguracionClub"
  TO admin_role
  USING (true);

-- Empleado
ALTER TABLE "Empleado" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Empleado" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Empleado";
CREATE POLICY tenant_isolation ON "Empleado"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "Empleado";
CREATE POLICY admin_bypass ON "Empleado"
  TO admin_role
  USING (true);

-- Cliente
ALTER TABLE "Cliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cliente" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Cliente";
CREATE POLICY tenant_isolation ON "Cliente"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "Cliente";
CREATE POLICY admin_bypass ON "Cliente"
  TO admin_role
  USING (true);

-- Visita
ALTER TABLE "Visita" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Visita" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Visita";
CREATE POLICY tenant_isolation ON "Visita"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "Visita";
CREATE POLICY admin_bypass ON "Visita"
  TO admin_role
  USING (true);

-- TokenValidacion
ALTER TABLE "TokenValidacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TokenValidacion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TokenValidacion";
CREATE POLICY tenant_isolation ON "TokenValidacion"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "TokenValidacion";
CREATE POLICY admin_bypass ON "TokenValidacion"
  TO admin_role
  USING (true);

-- ItemCarta
ALTER TABLE "ItemCarta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItemCarta" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ItemCarta";
CREATE POLICY tenant_isolation ON "ItemCarta"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "ItemCarta";
CREATE POLICY admin_bypass ON "ItemCarta"
  TO admin_role
  USING (true);

-- GrupoModificador
ALTER TABLE "GrupoModificador" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GrupoModificador" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GrupoModificador";
CREATE POLICY tenant_isolation ON "GrupoModificador"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "GrupoModificador";
CREATE POLICY admin_bypass ON "GrupoModificador"
  TO admin_role
  USING (true);

-- ReglaUpsell
ALTER TABLE "ReglaUpsell" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReglaUpsell" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReglaUpsell";
CREATE POLICY tenant_isolation ON "ReglaUpsell"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "ReglaUpsell";
CREATE POLICY admin_bypass ON "ReglaUpsell"
  TO admin_role
  USING (true);

-- Pedido
ALTER TABLE "Pedido" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pedido" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Pedido";
CREATE POLICY tenant_isolation ON "Pedido"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "Pedido";
CREATE POLICY admin_bypass ON "Pedido"
  TO admin_role
  USING (true);

-- Turno
ALTER TABLE "Turno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Turno" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Turno";
CREATE POLICY tenant_isolation ON "Turno"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "Turno";
CREATE POLICY admin_bypass ON "Turno"
  TO admin_role
  USING (true);

-- EncargadoDia
ALTER TABLE "EncargadoDia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EncargadoDia" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EncargadoDia";
CREATE POLICY tenant_isolation ON "EncargadoDia"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "EncargadoDia";
CREATE POLICY admin_bypass ON "EncargadoDia"
  TO admin_role
  USING (true);

-- CheckinTurno
ALTER TABLE "CheckinTurno" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckinTurno" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CheckinTurno";
CREATE POLICY tenant_isolation ON "CheckinTurno"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "CheckinTurno";
CREATE POLICY admin_bypass ON "CheckinTurno"
  TO admin_role
  USING (true);

-- ResenaGoogle
ALTER TABLE "ResenaGoogle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResenaGoogle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ResenaGoogle";
CREATE POLICY tenant_isolation ON "ResenaGoogle"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "ResenaGoogle";
CREATE POLICY admin_bypass ON "ResenaGoogle"
  TO admin_role
  USING (true);

-- IntegracionGoogle
ALTER TABLE "IntegracionGoogle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegracionGoogle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IntegracionGoogle";
CREATE POLICY tenant_isolation ON "IntegracionGoogle"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "IntegracionGoogle";
CREATE POLICY admin_bypass ON "IntegracionGoogle"
  TO admin_role
  USING (true);

-- NotificacionPush
ALTER TABLE "NotificacionPush" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificacionPush" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificacionPush";
CREATE POLICY tenant_isolation ON "NotificacionPush"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "NotificacionPush";
CREATE POLICY admin_bypass ON "NotificacionPush"
  TO admin_role
  USING (true);

-- NotificacionPushEmpleado
ALTER TABLE "NotificacionPushEmpleado" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificacionPushEmpleado" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NotificacionPushEmpleado";
CREATE POLICY tenant_isolation ON "NotificacionPushEmpleado"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "NotificacionPushEmpleado";
CREATE POLICY admin_bypass ON "NotificacionPushEmpleado"
  TO admin_role
  USING (true);

-- CampanaMarketing
ALTER TABLE "CampanaMarketing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampanaMarketing" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CampanaMarketing";
CREATE POLICY tenant_isolation ON "CampanaMarketing"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "CampanaMarketing";
CREATE POLICY admin_bypass ON "CampanaMarketing"
  TO admin_role
  USING (true);

-- UsoMensual
ALTER TABLE "UsoMensual" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsoMensual" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UsoMensual";
CREATE POLICY tenant_isolation ON "UsoMensual"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "UsoMensual";
CREATE POLICY admin_bypass ON "UsoMensual"
  TO admin_role
  USING (true);

-- EventoAuditoria
ALTER TABLE "EventoAuditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventoAuditoria" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EventoAuditoria";
CREATE POLICY tenant_isolation ON "EventoAuditoria"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "EventoAuditoria";
CREATE POLICY admin_bypass ON "EventoAuditoria"
  TO admin_role
  USING (true);

-- Suscripcion
ALTER TABLE "Suscripcion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Suscripcion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Suscripcion";
CREATE POLICY tenant_isolation ON "Suscripcion"
  USING ("negocioId" = current_setting('app.current_negocio_id', true)::text);
DROP POLICY IF EXISTS admin_bypass ON "Suscripcion";
CREATE POLICY admin_bypass ON "Suscripcion"
  TO admin_role
  USING (true);

-- ============================================================================
-- 3. TABLAS SIN NEGOCIOID DIRECTO
-- ============================================================================
-- Estas tablas NO llevan RLS propio porque:
--   a) Se acceden siempre a través de una tabla padre que ya tiene RLS.
--   b) Son globales y solo el super-admin las gestiona.
-- ============================================================================

-- Tablas SIN RLS (acceso a través de padre):
-- - ConfiguracionSucursal (vía Sucursal)
-- - DispositivoCliente (vía Cliente)
-- - TarjetaClienteSucursal (vía Cliente/Sucursal)
-- - ItemCartaSucursal (vía ItemCarta/Sucursal)
-- - OpcionModificador (vía GrupoModificador)
-- - SesionEmpleado (vía Empleado)
-- - SesionDueno (vía Empleado)
-- - RegistroAcceso (vía Empleado)
-- - Impersonacion (vía Negocio)

-- Tablas GLOBALES sin RLS (solo super-admin):
-- - PlanFeature
-- - Lead
-- - SuperAdmin
-- - SesionSuperAdmin
-- - ComunicacionMasiva
-- - EventoAuditoriaSuperAdmin
-- - WebhookLog

-- ============================================================================
-- 4. FUNCIÓN HELPER PARA SETEAR EL TENANT
-- ============================================================================
-- Uso desde Prisma:
--   await prisma.$executeRaw`SELECT set_config('app.current_negocio_id', ${negocioId}, true)`;
-- El tercer parámetro `true` significa LOCAL (se limpia al terminar la transacción).
-- ============================================================================

CREATE OR REPLACE FUNCTION set_current_negocio_id(negocio_id TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_negocio_id', negocio_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. VERIFICACIÓN
-- ============================================================================
-- Para verificar que RLS está activo en una tabla:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
--
-- Para verificar las políticas:
--   SELECT * FROM pg_policies WHERE schemaname = 'public';
--
-- Para probar RLS manualmente:
--   SET ROLE app_user;
--   SELECT set_config('app.current_negocio_id', 'negocio-123', true);
--   SELECT * FROM "Cliente"; -- Solo devuelve los del negocio-123
--   RESET ROLE;
-- ============================================================================

-- ============================================================================
-- FIN DEL SCRIPT
-- ============================================================================
