import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';

/**
 * Subida de imagenes (Cloudinary). No importa PrismaModule ni JwtGlobalModule: los dos son
 * `@Global`, y es lo que los guards (StaffGuard) necesitan.
 */
@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
