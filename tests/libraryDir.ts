import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The local score library (not in the repo): MIDITUTOR_LIBRARY, else scripts/local_config.json "library". '' when unset. */
export const libraryDir = (): string => {
  let dir = process.env.MIDITUTOR_LIBRARY ?? '';
  const cfg = path.join(__dirname, '..', 'scripts', 'local_config.json');
  if (!dir && existsSync(cfg)) {
    try {
      dir = JSON.parse(readFileSync(cfg, 'utf8')).library ?? '';
    } catch {
      dir = '';
    }
  }
  return dir ? dir.replace(/[\/]*$/, '/') : '';
};
