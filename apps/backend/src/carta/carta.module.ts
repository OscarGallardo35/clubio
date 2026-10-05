import { Module } from '@nestjs/common';
import { CartaService } from './carta.service';
import { CartaController } from './carta.controller';

@Module({
  controllers: [CartaController],
  providers: [CartaService],
  exports: [CartaService],
})
export class CartaModule {}
