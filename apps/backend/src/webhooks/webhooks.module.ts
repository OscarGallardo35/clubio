import { Global, Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

/**
 * Global: lo usan Google (Pub/Sub) y, mas adelante, Mercado Pago / Stripe.
 */
@Global()
@Module({
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}