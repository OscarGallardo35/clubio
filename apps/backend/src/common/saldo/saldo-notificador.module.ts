import { Global, Module } from '@nestjs/common';
import { SaldoNotificador } from './saldo-notificador.service';

/**
 * @Global por el mismo motivo que FidelizacionModule/AuditoriaModule: el aviso de saldo lo usan
 * Visitas (`editarMonto`), Fidelizacion (`acreditar`) y Push (`aplicarRegalo`), y que cualquiera
 * de esos importara a los otros armaria un ciclo (Visitas -> Push -> Visitas). Se registra una
 * vez en AppModule y listo.
 *
 * El `@Global()` NO es decorativo: sin el, Nest no resuelve `SaldoNotificador` en
 * DisparosService/PremiosService y el backend no arranca (mismo hallazgo que FidelizacionModule:
 * "Nest can't resolve dependencies of ...").
 */
@Global()
@Module({
  providers: [SaldoNotificador],
  exports: [SaldoNotificador],
})
export class SaldoNotificadorModule {}
