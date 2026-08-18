import type { LayoutBackend } from '../domain/port';

let registered: LayoutBackend | null = null;

export function registerLayoutBackend(backend: LayoutBackend | null) {
  registered = backend;
}

export function getLayoutBackend() {
  return registered;
}
