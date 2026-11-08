import { createHash } from 'node:crypto';
import { scoreContentKey } from '../shared/scoreContent';

/** #11358: sha256 of the score with his fingers left out; undefined if it can't be read. */
export function contentSha256(musicxml: string): string | undefined {
  try {
    return createHash('sha256').update(scoreContentKey(musicxml)).digest('hex');
  } catch {
    return undefined;
  }
}
