import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard de dueno (PWA Admin).
 * La estrategia 'jwt-dueno' se registra en el Lote 2 (auth/strategies).
 */
@Injectable()
export class JwtDuenoGuard extends AuthGuard('jwt-dueno') {}
