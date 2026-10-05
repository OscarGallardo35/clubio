import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Formatea TODOS los errores como { statusCode, message, error, timestamp, path }. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : null;

    let message: unknown = 'Error interno del servidor';
    let error = 'InternalServerError';
    // Campos propios del payload (feature, recurso, estado, limiteBase, ...).
    // Antes se descartaban: un 403 con detalle llegaba al cliente solo con el
    // message, asi que la PWA no podia mostrar el detalle del limite.
    let extra: Record<string, unknown> = {};

    if (typeof payload === 'string') {
      message = payload;
    } else if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      message = p.message ?? message;
      error = (p.error as string) ?? error;
      const { statusCode: _sc, message: _m, error: _e, ...resto } = p;
      extra = resto;
    }

    // El nombre del error sale del STATUS real, no del payload: si no, un 403
    // sin campo `error` se reportaba como "InternalServerError".
    if (error === 'InternalServerError' && isHttp) {
      error = HttpStatus[status] ?? `HTTP_${status}`;
    }

    if (!isHttp) {
      this.logger.error(`${req.method} ${req.originalUrl}`, (exception as Error)?.stack);
    }

    res.status(status).json({
      ...extra,
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  }
}
