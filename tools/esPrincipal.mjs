// ¿Se corrió este archivo con `node archivo.mjs`, o lo importó otro? Comparar `import.meta.url` con
// `file://${process.argv[1]}` falla en una carpeta con espacios (la URL los lleva como %20) y a través de enlaces
// simbólicos (la URL es la ruta real): la herramienta salía sin hacer nada ni decir nada.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function esPrincipal(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return realpathSync(resolve(argv1)) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}
