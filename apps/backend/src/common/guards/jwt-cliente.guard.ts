import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard de cliente (PWA Cliente).
 * La estrategia 'jwt-cliente' se registra en el Lote 2 (auth/strategies).
 */
@Injectable()
export class JwtClienteGuard extends AuthGuard('jwt-cliente') {}
