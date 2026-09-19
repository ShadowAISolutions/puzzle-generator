import { createHash } from 'node:crypto';

export function sha256hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
