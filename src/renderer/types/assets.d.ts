/// <reference types="vite/client" />

// Vite raw-string imports (e.g. `import xml from './score.musicxml?raw'`).
declare module '*?raw' {
  const content: string;
  export default content;
}
