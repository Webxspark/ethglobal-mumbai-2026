/** Browser stub for accidental node: builtin imports in client chunks. */
const empty = {};
export default empty;
export const createHash = () => ({
  update: () => ({ digest: () => "" }),
});
export const randomBytes = (n: number) => new Uint8Array(n);
export const mkdir = async () => undefined;
export const readFile = async () => new Uint8Array();
export const writeFile = async () => undefined;
export const join = (...parts: string[]) => parts.join("/");
export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const extname = (p: string) => {
  const base = basename(p);
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i) : "";
};
