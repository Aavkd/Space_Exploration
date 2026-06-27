import assert from 'node:assert/strict';
import test from 'node:test';

import {
    EconomyRuntime,
    MARKET_DEFINITIONS,
    MARKET_IDS,
    TRADE_GOOD_IDS,
    advanceEconomy,
    calculateHyperdriveFuelCost,
    calculateMarketQuote,
    createInitialEconomyState,
    createRpgRuntime,
    sanitizeEconomyState
} from '../../src/rpg/index.js';
import { PatrolRuntime } from '../../src/rpg/PatrolRuntime.js';
import {
    LocalSaveSlots,
    SlotRpgPersistence,
    createSaveEnvelope,
    sanitizeSaveEnvelope
} from '../../src/save/index.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
        this.failNextWrite = false;
    }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) {
        if (this.failNextWrite) {
            this.failNextWrite = false;
            throw new Error('simulated interrupted transaction');
        }
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
}

function createHarness({ storage = new MemoryStorage(), gameTime = 0 } = {}) {
    let time = gameTime;
    let stamp = 0;
    const now = () => new Date(Date.UTC(2026, 5, 27, 20, 0, stamp++)).toISOString();
    const slots = new LocalSaveSlots({
        storage,
        now,
        makeId: () => 'slot-phase20'
    });
    const getGameTime = () => time;
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime }),
        now
    });
    return {
        storage,
        slots,
        rpg,
        now,
        getGameTime,
        setGameTime: (value) => { time = value; },
        economy: new EconomyRuntime({ slots, getGameTime }),
        patrol: new PatrolRuntime({ slots, rpg, getGameTime, now })
    };
}

function reopen(harness, { newSlotManager = false } = {}) {
    const slots = newSlotManager
        ? new LocalSaveSlots({
            storage: harness.storage,
            now: harness.now,
            makeId: () => 'slot-unused'
        })
        : harness.slots;
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime: harness.getGameTime }),
        now: harness.now
    });
    return {
        ...harness,
        slots,
        rpg,
        economy: new EconomyRuntime({ slots, getGameTime: harness.getGameTime }),
        patrol: new PatrolRuntime({
            slots,
            rpg,
            getGameTime: harness.getGameTime,
            now: harness.now
        })
    };
}

function snapshotDomains(harness) {
    const envelope = harness.slots.getActiveEnvelope();
    return structuredClone({ ship: envelope.ship, economy: envelope.simulation.economy });
}

function downgradePatrolToV1(patrol) {
    const downgradeEncounter = (encounter) => {
        if (!encounter) return encounter;
        const next = structuredClone(encounter);
        delete next.cargoScan.contrabandValue;
        for (const match of next.cargoScan.matches) {
            delete match.unitValue;
            delete match.totalValue;
        }
        return next;
    };
    return {
        ...structuredClone(patrol),
        version: 1,
        activeEncounter: downgradeEncounter(patrol.activeEncounter),
        history: patrol.history.map(downgradeEncounter)
    };
}

test('Phase 19 version-8 save migrates through Phase 21 without offline economy catch-up', () => {
    const current = createSaveEnvelope({
        slotId: 'slot-phase20-migration',
        now: '2026-06-27T00:00:00.000Z',
        gameTime: 1234
    });
    current.ship.credits = 1150;
    const previous = structuredClone(current);
    previous.version = 8;
    previous.rpg.version = 6;
    previous.rpg.patrol = downgradePatrolToV1(previous.rpg.patrol);
    delete previous.simulation.economy;

    const migrated = sanitizeSaveEnvelope(previous);
    assert.equal(migrated.version, 10);
    assert.equal(migrated.rpg.version, 8);
    assert.equal(migrated.rpg.patrol.version, 2);
    assert.equal(migrated.autosave.reason, 'phase-21-v9');
    assert.equal(migrated.simulation.economy.lastTickGameTime, 1234);
    assert.equal(migrated.ship.credits, 1150);
    assert.deepEqual(
        migrated.simulation.economy,
        createInitialEconomyState(1234)
    );
});

test('version-8 active patrol snapshots migrate appraisal fields without changing encounter outcome state', () => {
    const harness = createHarness();
    const envelope = harness.slots.getActiveEnvelope();
    envelope.ship.cargo.stacks = [{
        cargoId: 'unregistered_signal_scrambler',
        quantity: 1
    }];
    harness.slots.saveDomains({ ship: envelope.ship, gameTime: 0 });
    harness.patrol.syncSystem('entry_hub');
    const current = harness.slots.getActiveEnvelope();
    const previous = structuredClone(current);
    previous.version = 8;
    previous.rpg.version = 6;
    previous.rpg.patrol = downgradePatrolToV1(previous.rpg.patrol);
    delete previous.simulation.economy;

    const migrated = sanitizeSaveEnvelope(previous);
    const encounter = migrated.rpg.patrol.activeEncounter;
    assert.equal(encounter.cargoScan.status, 'contraband');
    assert.equal(encounter.cargoScan.contrabandValue, 0);
    assert.equal(encounter.cargoScan.matches[0].unitValue, 0);
    assert.equal(encounter.cargoScan.matches[0].totalValue, 0);
    assert.equal(encounter.outcomeId, null);
});

test('three markets, stable goods, quotes, and active-play ticks are deterministic and bounded', () => {
    assert.deepEqual(MARKET_IDS, [
        'port_meridian_exchange',
        'index_k7_exchange',
        'wayfarer_exchange'
    ]);
    assert.deepEqual(TRADE_GOOD_IDS, [
        'field_rations',
        'navigation_components',
        'unregistered_signal_scrambler'
    ]);
    const initial = createInitialEconomyState(10);
    assert.deepEqual(
        calculateMarketQuote('port_meridian_exchange', 'field_rations', 80),
        calculateMarketQuote('port_meridian_exchange', 'field_rations', 80)
    );
    assert.deepEqual(advanceEconomy(initial, 69).economy, initial);
    const first = advanceEconomy(initial, 70);
    const second = advanceEconomy(initial, 70);
    assert.equal(first.ticksApplied, 1);
    assert.deepEqual(first, second);
    assert.equal(
        first.economy.markets.byId.port_meridian_exchange.goods.field_rations.stock,
        83
    );
    assert.equal(
        first.economy.markets.byId.wayfarer_exchange.goods.field_rations.stock,
        12
    );
});

test('clean Port Meridian to Wayfarer route profits and visibly narrows the spread', () => {
    let harness = createHarness();
    harness.economy.syncSystem('entry_hub');
    const portBefore = harness.economy.getMarket('port_meridian_exchange').report.goods.field_rations;
    const buy = harness.economy.buy('field_rations', 20).transaction;
    assert.equal(buy.total, 160);
    assert.equal(buy.stockBefore, 80);
    assert.equal(buy.stockAfter, 60);
    assert.equal(buy.creditsAfter, 140);

    harness = reopen(harness);
    assert.equal(harness.slots.getActiveEnvelope().ship.credits, 140);
    assert.equal(harness.slots.getActiveEnvelope().simulation.economy.ledger.length, 1);
    harness.economy.syncSystem('drifter_convergence');
    const wayfarerBefore = harness.economy.getMarket('wayfarer_exchange').report.goods.field_rations;
    const sell = harness.economy.sell('field_rations', 20).transaction;
    assert.equal(sell.total, 260);
    assert.equal(sell.stockBefore, 15);
    assert.equal(sell.stockAfter, 35);
    assert.equal(sell.creditsAfter, 400);
    assert.ok(sell.creditsAfter > 300);

    const portAfter = harness.economy.getMarket('port_meridian_exchange').report.goods.field_rations;
    const wayfarerAfter = harness.economy.getMarket('wayfarer_exchange').report.goods.field_rations;
    assert.ok(portAfter.buyPrice > portBefore.buyPrice);
    assert.ok(wayfarerAfter.sellPrice < wayfarerBefore.sellPrice);
    assert.ok(calculateHyperdriveFuelCost('entry_hub', 'drifter_convergence').fuelCost > 0);
});

test('integer settlement cannot mint credits through an immediate round trip', () => {
    const harness = createHarness();
    harness.economy.syncSystem('entry_hub');
    const before = harness.slots.getActiveEnvelope().ship.credits;
    harness.economy.buy('field_rations', 1);
    harness.economy.sell('field_rations', 1);
    const after = harness.slots.getActiveEnvelope().ship.credits;
    assert.ok(after < before);
    for (const entry of harness.economy.getState().economy.ledger) {
        assert.ok(Number.isSafeInteger(entry.unitPrice));
        assert.ok(Number.isSafeInteger(entry.total));
        assert.equal(entry.total, entry.unitPrice * entry.quantity);
    }
});

test('funds, cargo capacity, cargo quantity, market capacity, IDs, and context fail atomically', () => {
    const harness = createHarness();
    assert.throws(() => harness.economy.buy('field_rations', 1), /inside one of the three/);
    harness.economy.syncSystem('entry_hub');
    const initial = snapshotDomains(harness);
    assert.throws(() => harness.economy.buy('missing', 1), /Unknown trade good ID/);
    assert.deepEqual(snapshotDomains(harness), initial);
    assert.throws(() => harness.economy.buy('field_rations', 0), /positive integer/);
    assert.deepEqual(snapshotDomains(harness), initial);
    assert.throws(() => harness.economy.buy('field_rations', 80), /Insufficient credits/);
    assert.deepEqual(snapshotDomains(harness), initial);

    const ship = harness.slots.getActiveEnvelope().ship;
    ship.cargo.stacks = [{ cargoId: 'maintenance_supplies', quantity: 4 }];
    harness.slots.saveDomains({ ship, gameTime: harness.getGameTime() });
    const full = snapshotDomains(harness);
    assert.throws(() => harness.economy.buy('field_rations', 1), /Insufficient cargo capacity/);
    assert.deepEqual(snapshotDomains(harness), full);
    assert.throws(() => harness.economy.sell('field_rations', 1), /Insufficient cargo quantity/);
    assert.deepEqual(snapshotDomains(harness), full);

    const envelope = harness.slots.getActiveEnvelope();
    envelope.ship.cargo.stacks = [{ cargoId: 'field_rations', quantity: 1 }];
    envelope.simulation.economy.markets.byId.port_meridian_exchange.goods.field_rations.stock = 100;
    envelope.simulation.economy.intel.byMarketId.port_meridian_exchange =
        createInitialEconomyState(0).intel.byMarketId.port_meridian_exchange;
    envelope.simulation.economy.intel.byMarketId.port_meridian_exchange.goods.field_rations =
        { stock: 100, buyPrice: 6, sellPrice: 4 };
    harness.slots.saveDomains({
        ship: envelope.ship,
        economy: envelope.simulation.economy,
        gameTime: 0
    });
    const capped = snapshotDomains(harness);
    assert.throws(() => harness.economy.sell('field_rations', 1), /Market capacity exceeded/);
    assert.deepEqual(snapshotDomains(harness), capped);
});

test('remote reports remain age-stamped until local observation refreshes them', () => {
    const harness = createHarness({ gameTime: 0 });
    harness.economy.syncSystem('entry_hub');
    harness.setGameTime(125);
    harness.economy.update();
    const reports = harness.economy.getReports();
    const local = reports.find((entry) => entry.marketId === 'port_meridian_exchange');
    const remote = reports.find((entry) => entry.marketId === 'wayfarer_exchange');
    assert.equal(local.local, true);
    assert.equal(local.ageSeconds, 0);
    assert.equal(remote.local, false);
    assert.equal(remote.observedAtGameTime, 0);
    assert.equal(remote.ageSeconds, 125);
    harness.economy.syncSystem('drifter_convergence');
    const refreshed = harness.economy.getReports()
        .find((entry) => entry.marketId === 'wayfarer_exchange');
    assert.equal(refreshed.local, true);
    assert.equal(refreshed.observedAtGameTime, 125);
    assert.equal(refreshed.ageSeconds, 0);
});

test('closed-game reload adds no ticks and active-slot reset restores initial economy', () => {
    let harness = createHarness({ gameTime: 240 });
    harness.economy.syncSystem('entry_hub');
    harness.economy.buy('field_rations', 1);
    const beforeClose = structuredClone(
        harness.slots.getActiveEnvelope().simulation.economy
    );
    harness = reopen(harness, { newSlotManager: true });
    assert.deepEqual(
        harness.slots.getActiveEnvelope().simulation.economy,
        beforeClose
    );

    harness.slots.resetActiveSlot();
    harness = reopen(harness);
    assert.deepEqual(
        harness.slots.getActiveEnvelope().simulation.economy,
        createInitialEconomyState(0)
    );
});

test('a patrol snapshot exposes immutable dynamic contraband value', () => {
    const harness = createHarness();
    harness.economy.syncSystem('drifter_convergence');
    harness.economy.buy('unregistered_signal_scrambler', 1);
    harness.patrol.syncSystem('entry_hub');
    const encounter = harness.patrol.getState().activeEncounter;
    assert.equal(encounter.cargoScan.status, 'contraband');
    assert.equal(encounter.cargoScan.contrabandValue, 92);
    assert.equal(encounter.cargoScan.matches[0].unitValue, 92);
    harness.economy.syncSystem('entry_hub');
    assert.equal(
        harness.patrol.getState().activeEncounter.cargoScan.contrabandValue,
        92
    );
});

test('interrupted durable write reloads wholly before while live memory is wholly after', () => {
    let harness = createHarness();
    harness.economy.syncSystem('entry_hub');
    const durableBefore = snapshotDomains(harness);
    harness.storage.failNextWrite = true;
    const result = harness.economy.buy('field_rations', 1);
    assert.equal(result.transaction.cargoAfter, 1);
    assert.equal(harness.slots.getStatus().lastError.operation, 'save');
    const liveAfter = snapshotDomains(harness);
    assert.notDeepEqual(liveAfter, durableBefore);

    harness = reopen(harness, { newSlotManager: true });
    assert.deepEqual(snapshotDomains(harness), durableBefore);
    assert.equal(harness.slots.getActiveEnvelope().simulation.economy.ledger.length, 0);
});

test('economy validation rejects forged IDs, bounds, quotes, ledger arithmetic, and future time', () => {
    const base = createInitialEconomyState(0);
    for (const [mutate, pattern] of [
        [(state) => { state.markets.byId.forged = {}; }, /Invalid economy market ID/],
        [(state) => { state.markets.byId.port_meridian_exchange.goods.field_rations.stock = 101; }, /within 0-100/],
        [(state) => { state.intel.byMarketId.port_meridian_exchange.goods.field_rations.buyPrice = 999; }, /Forged economy intel quote/],
        [(state) => { state.lastTickGameTime = 1; }, /cannot exceed simulation.gameTime/]
    ]) {
        const dirty = structuredClone(base);
        mutate(dirty);
        assert.throws(() => sanitizeEconomyState(dirty, { gameTime: 0 }), pattern);
    }

    const harness = createHarness();
    harness.economy.syncSystem('entry_hub');
    harness.economy.buy('field_rations', 1);
    const dirty = harness.economy.getState().economy;
    dirty.ledger[0].total += 1;
    assert.throws(
        () => sanitizeEconomyState(dirty, { gameTime: 0 }),
        /ledger total mismatch/
    );
});

test('seeded million-tick soak is deterministic with finite bounded stock and prices', () => {
    const run = () => {
        let economy = createInitialEconomyState(0);
        for (let chunk = 1; chunk <= 100; chunk += 1) {
            const gameTime = chunk * 10000 * 60;
            economy = advanceEconomy(economy, gameTime).economy;
        }
        return economy;
    };
    const first = run();
    const second = run();
    assert.deepEqual(first, second, `economy soak seed: ${first.seed}`);
    for (const marketId of MARKET_IDS) {
        for (const cargoId of TRADE_GOOD_IDS) {
            const stock = first.markets.byId[marketId].goods[cargoId].stock;
            const definition = MARKET_DEFINITIONS[marketId].goods[cargoId];
            const quote = calculateMarketQuote(marketId, cargoId, stock);
            assert.ok(Number.isInteger(stock));
            assert.ok(stock >= definition.minimumStock && stock <= definition.maximumStock);
            assert.ok(Number.isSafeInteger(quote.buyPrice) && quote.buyPrice > 0);
            assert.ok(Number.isSafeInteger(quote.sellPrice) && quote.sellPrice > 0);
        }
    }
});
