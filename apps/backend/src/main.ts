import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefijo global: todos los endpoints cuelgan de /api
  app.setGlobalPrefix('api');

  // CORS: lista estatica (CORS_ORIGINS) + los tenants por SUBDOMINIO, que son dinamicos
  // (`<slug>.app.clubio.lat`): no se pueden enumerar, van por regex. `credentials: true` obliga a
  // devolver el origen EXACTO (nunca `*`), por eso es un callback y no un array.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const dinamicos = [
    // UN nivel: `bar-la-esquina.clubio.lat`. Es el formato que usa el DNS y el que cubre el
    // certificado universal de Cloudflare (un wildcard de DOS niveles no lo cubre: ver
    // TROUBLESHOOTING).
    /^https:\/\/[a-z0-9-]+\.clubio\.lat$/i,
    // Se mantienen por las dudas de una topologia vieja o de un acceso por el subdominio de la app.
    /^https:\/\/[a-z0-9-]+\.app\.clubio\.lat$/i,
    /^https:\/\/[a-z0-9-]+\.staff\.clubio\.lat$/i,
  ];
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, permitido?: boolean) => void) => {
      // Sin Origin (curl, health checks, apps nativas): no hay politica que aplicar.
      if (!origin) return callback(null, true);
      // Sin lista estatica se mantiene el comportamiento historico (reflejar el origen): no cambiar
      // esto sin revisar prod, donde CORS_ORIGINS SI esta seteada.
      if (origins.length === 0) return callback(null, true);
      const permitido = origins.includes(origin) || dinamicos.some((re) => re.test(origin));
      return callback(null, permitido);
    },
    credentials: true,
  });

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Backend escuchando en http://localhost:${port}/api`);
}

void bootstrap();
