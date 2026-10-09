import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PushService, COLA_PUSH } from './push.service';
import { COLA_DISPAROS, DisparosService } from './disparos.service';
import { PushProcessor } from './push.processor';
import { DisparosProcessor } from './disparos.processor';
import { PushScheduler } from './push.scheduler';
import { PushController } from './push.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: COLA_PUSH }, { name: COLA_DISPAROS }),
  ],
  controllers: [PushController],
  providers: [PushService, PushProcessor, PushScheduler, DisparosService, DisparosProcessor],
  exports: [PushService, DisparosService],
})
export class PushModule {}
