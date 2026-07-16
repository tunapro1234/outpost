/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "d3-force-3d" {
  export function forceX(x?: number): any;
  export function forceY(y?: number): any;
  export function forceCollide(radius?: number): any;
}
