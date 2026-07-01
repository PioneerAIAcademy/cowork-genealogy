// Ambient declarations so the viewer typechecks as a standalone package.
// CSS Modules (the consuming app's bundler — Vite / electron-vite — provides
// the real implementation at build time).
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'
