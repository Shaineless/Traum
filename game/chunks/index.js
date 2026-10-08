// Liste aller Chunk Layouts. Der Generator liest nur diese Datei.
import { ADVANCED } from './advanced.js';
import { BASIC } from './basic.js';
import { EXPERT } from './expert.js';
import { NIGHTMARE } from './nightmare.js';
import { FLAT, GATE } from './special.js';

export const CHUNKS = [...BASIC, ...ADVANCED, ...EXPERT, ...NIGHTMARE];
export { FLAT, GATE };
