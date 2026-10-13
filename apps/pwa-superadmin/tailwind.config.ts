import type { Config } from 'tailwindcss';
import preset from '@repo/config/tailwind-preset';

const config: Config = {
  // El preset ya incluye ../../apps/**/app/** y ../../packages/ui/src/**
  presets: [preset as Config],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
