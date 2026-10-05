import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca un endpoint como publico (sin JWT). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
