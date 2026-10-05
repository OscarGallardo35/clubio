import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard de staff (PWA Staff).
 * La estrategia 'jwt-empleado' se registra en el Lote 2 (auth/strategies).
 */
@Injectable()
export class JwtEmpleadoGuard extends AuthGuard('jwt-empleado') {}
