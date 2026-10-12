import { describe, it, expect } from 'vitest';
import { statusColorMap as upstream } from '../../../../packages/viewer-ui/src/components/shared/StatusBadge';
import { statusColorMap as ours } from '../../components/scenario/components/shared/StatusBadge';

/**
 * The scenario viewer's StatusBadge is a hand-maintained copy of
 * packages/viewer-ui's. The two drifted: viewer-ui carried four gps-mentor
 * verdict colours and a known-holding confidence colour this tree did not, so
 * every mentor verdict rendered gray (#3002). Typecheck passes either way: the
 * map is a plain Record<string, BadgeColor> and a missing key is just a lookup
 * miss.
 *
 * SUPERSET, not equality: this tree may carry a colour viewer-ui has no use for.
 * What must not happen is a value viewer-ui colours and this one greys out.
 *
 * Compares the real exported objects, not source text: parsing the files failed
 * open on a `}` in a comment, a double-quoted colour, and two keys on one line.
 */
describe('StatusBadge colour parity with packages/viewer-ui', () => {
  it('colours every status viewer-ui colours, with the same colour', () => {
    const missing = Object.keys(upstream).filter((k) => !(k in ours));
    expect(missing, 'statuses viewer-ui colours that this tree renders gray').toEqual([]);
    const disagreements = Object.keys(upstream)
      .filter((k) => k in ours && ours[k] !== upstream[k])
      .map((k) => `${k}: viewer-ui ${upstream[k]}, here ${ours[k]}`);
    expect(disagreements, 'same status, different colour').toEqual([]);
  });
});
