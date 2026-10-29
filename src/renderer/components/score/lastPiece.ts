// #10160: the Score tab reopens the piece he last had on screen after a restart.
import { pieceFileName } from '../../../shared/pieceFiles';

export interface PieceRef {
  id: string;
  label: string;
}

/**
 * What to remember for a piece on screen. A score the tutor pushed this session
 * (id pushed-N) is saved to his Pieces folder under its title, so after a restart it
 * is that file.
 */
export function rememberRef(id: string, label: string, hasScore: boolean): PieceRef {
  return { id: id.startsWith('pushed-') && hasScore ? `file:${pieceFileName(label)}` : id, label };
}

/**
 * Which piece to show at start: the saved one by id, else by title (a piece the tutor
 * pushed comes back from his Pieces folder under a file: id, same title). 'wait' while
 * the folder is still being read; the default when it's gone (deleted or renamed).
 */
export function resolvePieceId(
  saved: PieceRef | null,
  pieces: PieceRef[],
  folderLoaded: boolean,
  defaultId: string,
): string | 'wait' {
  if (!saved) return defaultId;
  const hit = pieces.find((p) => p.id === saved.id) ?? pieces.find((p) => p.label === saved.label);
  if (hit) return hit.id;
  return folderLoaded ? defaultId : 'wait';
}
