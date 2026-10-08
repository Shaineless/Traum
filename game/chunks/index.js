// Liste aller Chunk Layouts. Der Generator liest nur diese Datei.
import { ADVANCED } from './advanced.js';
import { BASIC } from './basic.js';
import { FLAT, GATE } from './special.js';

export const CHUNKS = [...BASIC, ...ADVANCED];
export { FLAT, GATE };
