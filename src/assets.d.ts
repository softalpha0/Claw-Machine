// Vite resolves image imports to a hashed URL string at build time.
declare module "*.png" {
  const src: string;
  export default src;
}
