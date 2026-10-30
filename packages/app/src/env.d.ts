declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'vuetify';
declare module 'vuetify/lib/components/*';
declare module 'vuetify/lib/directives/*';
declare module 'vite-plugin-vuetify';

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_VPN_SERVER: string;
  readonly VITE_API_URL: string;
  readonly VITE_VPN_SERVER?: string;
  readonly VITE_APP_NAME?: string;
  // Add more env variables as needed
  readonly [key: string]: string | boolean | number | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// / <reference types="vite/client" />

// Declare image module types
declare module '*.json' {
  const value: any;
  export default value;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.gif' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

// Vite `?url` imports (ONNX Runtime files, src/workers/onnxRuntime.ts)
declare module '*?url' {
  const url: string;
  export default url;
}

// Audio imports
declare module '*.mp3' {
  const value: string;
  export default value;
}

declare module '*.wav' {
  const value: string;
  export default value;
}

declare module '*.ogg' {
  const value: string;
  export default value;
}

// Vite env
interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly VITE_API_URL: string;
  // Add more env variables here
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly glob: (pattern: string, options?: any) => Record<string, () => Promise<any>>;
}
