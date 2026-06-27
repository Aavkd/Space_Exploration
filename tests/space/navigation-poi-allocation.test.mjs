import assert from 'node:assert/strict';
import test from 'node:test';

import { NAMED_SYSTEM_DEFINITIONS } from '../../src/rpg/registries.js';
import { calculateSystemPoiLimit } from '../../src/space/universe/poiAllocation.js';

test('navigation reserves one system row for every positioned authored destination', () => {
    const authored = Object.values(NAMED_SYSTEM_DEFINITIONS)
        .filter((definition) => Array.isArray(definition.position));
    assert.deepEqual(
        authored.map((definition) => definition.id),
        ['entry_hub', 'index_hq', 'drifter_convergence']
    );
    assert.equal(calculateSystemPoiLimit(8, authored.length), 3);
});

test('navigation allocation remains bounded and preserves the procedural quota', () => {
    assert.equal(calculateSystemPoiLimit(8, 0), 2);
    assert.equal(calculateSystemPoiLimit(8, 2), 2);
    assert.equal(calculateSystemPoiLimit(8, 3), 3);
    assert.equal(calculateSystemPoiLimit(2, 3), 2);
    assert.equal(calculateSystemPoiLimit(0, 3), 0);
});
