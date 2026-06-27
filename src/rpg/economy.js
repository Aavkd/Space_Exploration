import {
    calculateCargoMass,
    getCargoDefinition,
    getCargoQuantity,
    sanitizeShipState
} from './cargo.js';

export const ECONOMY_STATE_VERSION = 1;
export const ECONOMY_SEED = 'deep-space-vr-economy-v1';
export const ECONOMY_TICK_SECONDS = 60;
export const MAX_ECONOMY_TICKS_PER_UPDATE = 10000;
export const MAX_TRADE_LEDGER_ENTRIES = 200;

export const TRADE_GOOD_IDS = Object.freeze([
    'field_rations',
    'navigation_components',
    'unregistered_signal_scrambler'
]);

export const MARKET_DEFINITIONS = Object.freeze({
    port_meridian_exchange: market({
        id: 'port_meridian_exchange',
        name: 'Port Meridian Exchange',
        systemId: 'entry_hub',
        goods: {
            field_rations: listing(10, 80, 50, 5, 2),
            navigation_components: listing(30, 15, 50, 1, 3),
            unregistered_signal_scrambler: listing(60, 5, 35, 0, 1, false, false)
        }
    }),
    index_k7_exchange: market({
        id: 'index_k7_exchange',
        name: 'K-7 Archive Exchange',
        systemId: 'index_hq',
        goods: {
            field_rations: listing(10, 20, 50, 1, 3),
            navigation_components: listing(30, 80, 50, 5, 2),
            unregistered_signal_scrambler: listing(60, 20, 35, 1, 2)
        }
    }),
    wayfarer_exchange: market({
        id: 'wayfarer_exchange',
        name: 'Wayfarer Convoy Exchange',
        systemId: 'drifter_convergence',
        goods: {
            field_rations: listing(10, 15, 50, 1, 4),
            navigation_components: listing(30, 25, 50, 1, 3),
            unregistered_signal_scrambler: listing(60, 70, 35, 4, 1)
        }
    })
});

export const MARKET_IDS = Object.freeze(Object.keys(MARKET_DEFINITIONS));

export function createInitialEconomyState(gameTime = 0) {
    const time = sanitizeGameTime(gameTime, 'economy initial gameTime');
    const markets = {};
    const intel = {};
    for (const marketId of MARKET_IDS) {
        const definition = MARKET_DEFINITIONS[marketId];
        const goods = {};
        for (const cargoId of TRADE_GOOD_IDS) {
            goods[cargoId] = { stock: definition.goods[cargoId].initialStock };
        }
        markets[marketId] = {
            id: marketId,
            systemId: definition.systemId,
            lastUpdatedAtGameTime: time,
            goods
        };
        intel[marketId] = createIntelSnapshot(markets[marketId], time);
    }
    return {
        version: ECONOMY_STATE_VERSION,
        seed: ECONOMY_SEED,
        lastTickGameTime: time,
        nextLedgerSequence: 1,
        markets: { byId: markets },
        intel: { byMarketId: intel },
        ledger: []
    };
}

export function sanitizeEconomyState(value, { gameTime = Number.MAX_SAFE_INTEGER } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('simulation.economy must be an object.');
    }
    if (value.version !== ECONOMY_STATE_VERSION) {
        throw new Error(`Unsupported economy state version: ${value.version ?? 'missing'}.`);
    }
    if (value.seed !== ECONOMY_SEED) throw new Error(`Unknown economy seed: ${value.seed ?? 'missing'}.`);
    const currentGameTime = sanitizeGameTime(gameTime, 'simulation.gameTime');
    const lastTickGameTime = sanitizeGameTime(
        value.lastTickGameTime,
        'simulation.economy.lastTickGameTime'
    );
    if (lastTickGameTime > currentGameTime) {
        throw new Error('simulation.economy.lastTickGameTime cannot exceed simulation.gameTime.');
    }
    const markets = {};
    assertExactIds(value.markets?.byId, MARKET_IDS, 'economy market');
    for (const marketId of MARKET_IDS) {
        markets[marketId] = sanitizeMarket(value.markets.byId[marketId], marketId, currentGameTime);
    }
    const intel = {};
    assertExactIds(value.intel?.byMarketId, MARKET_IDS, 'economy intel market');
    for (const marketId of MARKET_IDS) {
        intel[marketId] = sanitizeIntel(value.intel.byMarketId[marketId], marketId, currentGameTime);
    }
    if (!Array.isArray(value.ledger)) throw new Error('simulation.economy.ledger must be an array.');
    if (value.ledger.length > MAX_TRADE_LEDGER_ENTRIES) {
        throw new Error(`Economy ledger exceeds ${MAX_TRADE_LEDGER_ENTRIES} entries.`);
    }
    const ledger = value.ledger.map((entry, index) => sanitizeLedgerEntry(entry, index));
    for (let index = 1; index < ledger.length; index += 1) {
        if (ledger[index].sequence <= ledger[index - 1].sequence) {
            throw new Error('Economy ledger sequences must be strictly increasing.');
        }
    }
    const nextLedgerSequence = sanitizePositiveInteger(
        value.nextLedgerSequence,
        'simulation.economy.nextLedgerSequence'
    );
    if (ledger.length && nextLedgerSequence <= ledger.at(-1).sequence) {
        throw new Error('Economy next ledger sequence must follow the retained ledger.');
    }
    return {
        version: ECONOMY_STATE_VERSION,
        seed: ECONOMY_SEED,
        lastTickGameTime,
        nextLedgerSequence,
        markets: { byId: markets },
        intel: { byMarketId: intel },
        ledger
    };
}

export function getMarketDefinition(id) {
    const definition = MARKET_DEFINITIONS[id];
    if (!definition) throw new Error(`Unknown market ID: ${id}`);
    return definition;
}

export function getMarketIdForSystem(systemId) {
    if (systemId === null || systemId === undefined) return null;
    return MARKET_IDS.find((id) => MARKET_DEFINITIONS[id].systemId === systemId) ?? null;
}

export function calculateMarketQuote(marketId, cargoId, stock) {
    const definition = getMarketDefinition(marketId);
    if (!TRADE_GOOD_IDS.includes(cargoId)) throw new Error(`Unknown trade good ID: ${cargoId}`);
    const config = definition.goods[cargoId];
    const cleanStock = sanitizeStock(stock, config, `${marketId}.${cargoId}.stock`);
    const scarcityPercent = clampInteger(
        150 - Math.floor((cleanStock * 100) / config.maximumStock),
        50,
        150
    );
    const midpoint = Math.max(1, Math.round((config.basePrice * scarcityPercent) / 100));
    return {
        cargoId,
        stock: cleanStock,
        buyPrice: Math.max(1, Math.ceil((midpoint * 105) / 100)),
        sellPrice: Math.max(1, Math.floor((midpoint * 95) / 100)),
        buyAllowed: config.buyAllowed,
        sellAllowed: config.sellAllowed
    };
}

export function advanceEconomy(value, gameTime, { maxTicks = MAX_ECONOMY_TICKS_PER_UPDATE } = {}) {
    const time = sanitizeGameTime(gameTime, 'economy update gameTime');
    const economy = sanitizeEconomyState(value, { gameTime: time });
    const availableTicks = Math.floor((time - economy.lastTickGameTime) / ECONOMY_TICK_SECONDS);
    const ticksApplied = Math.min(
        availableTicks,
        clampInteger(Number(maxTicks), 0, MAX_ECONOMY_TICKS_PER_UPDATE)
    );
    if (ticksApplied <= 0) return { economy, ticksApplied: 0 };
    for (const marketId of MARKET_IDS) {
        const marketState = economy.markets.byId[marketId];
        const definition = MARKET_DEFINITIONS[marketId];
        for (const cargoId of TRADE_GOOD_IDS) {
            const config = definition.goods[cargoId];
            const delta = (config.production - config.consumption) * ticksApplied;
            marketState.goods[cargoId].stock = clampInteger(
                marketState.goods[cargoId].stock + delta,
                config.minimumStock,
                config.maximumStock
            );
        }
    }
    economy.lastTickGameTime += ticksApplied * ECONOMY_TICK_SECONDS;
    for (const market of Object.values(economy.markets.byId)) {
        market.lastUpdatedAtGameTime = economy.lastTickGameTime;
    }
    return {
        economy: sanitizeEconomyState(economy, { gameTime: time }),
        ticksApplied
    };
}

export function refreshMarketIntel(value, marketId, gameTime) {
    const time = sanitizeGameTime(gameTime, 'market observation gameTime');
    const economy = sanitizeEconomyState(value, { gameTime: time });
    const marketState = economy.markets.byId[getMarketDefinition(marketId).id];
    economy.intel.byMarketId[marketId] = createIntelSnapshot(marketState, time);
    return sanitizeEconomyState(economy, { gameTime: time });
}

export function createMarketReport(value, marketId, gameTime, { local = false } = {}) {
    const time = sanitizeGameTime(gameTime, 'market report gameTime');
    const economy = sanitizeEconomyState(value, { gameTime: time });
    const definition = getMarketDefinition(marketId);
    const snapshot = local
        ? createIntelSnapshot(economy.markets.byId[marketId], time)
        : economy.intel.byMarketId[marketId];
    return {
        marketId,
        name: definition.name,
        systemId: definition.systemId,
        local,
        observedAtGameTime: snapshot.observedAtGameTime,
        ageSeconds: Math.max(0, time - snapshot.observedAtGameTime),
        goods: structuredClone(snapshot.goods)
    };
}

export function getContrabandAppraisal(economy, cargoId, quantity, gameTime) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`Contraband appraisal quantity must be a positive integer: ${quantity}`);
    }
    const clean = sanitizeEconomyState(economy, { gameTime });
    const marketId = 'port_meridian_exchange';
    const stock = clean.markets.byId[marketId].goods[cargoId]?.stock;
    if (stock === undefined) throw new Error(`Unknown trade good ID for contraband appraisal: ${cargoId}`);
    const unitValue = calculateMarketQuote(marketId, cargoId, stock).buyPrice;
    return { unitValue, totalValue: safeMultiply(unitValue, quantity, 'contraband appraisal') };
}

export class EconomyRuntime {
    constructor({ slots, getGameTime = () => 0 } = {}) {
        if (!slots) throw new Error('EconomyRuntime requires a save-slot manager.');
        this.slots = slots;
        this.getGameTime = getGameTime;
        this.activeSystemId = null;
        this.activeMarketId = null;
        this._read();
    }

    reload() {
        this.activeSystemId = null;
        this.activeMarketId = null;
        this._read();
        return this.getState();
    }

    getState() {
        const envelope = this.slots.getActiveEnvelope();
        return {
            economy: sanitizeEconomyState(envelope.simulation.economy, {
                gameTime: envelope.simulation.gameTime
            }),
            activeSystemId: this.activeSystemId,
            activeMarketId: this.activeMarketId,
            reports: this.getReports()
        };
    }

    getMarket(marketId) {
        const state = this.getState();
        return {
            definition: getMarketDefinition(marketId),
            state: state.economy.markets.byId[marketId],
            report: createMarketReport(
                state.economy,
                marketId,
                this.getGameTime(),
                { local: marketId === this.activeMarketId }
            )
        };
    }

    getReports() {
        const envelope = this.slots.getActiveEnvelope();
        return MARKET_IDS.map((marketId) => createMarketReport(
            envelope.simulation.economy,
            marketId,
            this.getGameTime(),
            { local: marketId === this.activeMarketId }
        ));
    }

    syncSystem(systemId) {
        this.update(this.getGameTime());
        this.activeSystemId = systemId || null;
        this.activeMarketId = getMarketIdForSystem(this.activeSystemId);
        if (!this.activeMarketId) return this.getState();
        const envelope = this.slots.getActiveEnvelope();
        const economy = refreshMarketIntel(
            envelope.simulation.economy,
            this.activeMarketId,
            this.getGameTime()
        );
        this._commit(envelope.ship, economy, 'market-intel-refreshed');
        return this.getState();
    }

    update(gameTime = this.getGameTime()) {
        const envelope = this.slots.getActiveEnvelope();
        const rawLastTick = Number(envelope.simulation.economy?.lastTickGameTime);
        if (
            Number.isFinite(rawLastTick)
            && gameTime >= rawLastTick
            && gameTime - rawLastTick < ECONOMY_TICK_SECONDS
        ) {
            return { changed: false, ticksApplied: 0 };
        }
        const { economy, ticksApplied } = advanceEconomy(envelope.simulation.economy, gameTime);
        if (ticksApplied <= 0) return { changed: false, ticksApplied };
        const next = this.activeMarketId
            ? refreshMarketIntel(economy, this.activeMarketId, gameTime)
            : economy;
        this._commit(envelope.ship, next, 'economy-tick');
        return { changed: true, ticksApplied, state: this.getState() };
    }

    buy(cargoId, quantity = 1) {
        return this._trade('buy', cargoId, quantity);
    }

    sell(cargoId, quantity = 1) {
        return this._trade('sell', cargoId, quantity);
    }

    _trade(side, cargoId, quantity) {
        if (!this.activeMarketId) {
            throw new Error('Trade requires the ship to be inside one of the three authored market systems.');
        }
        if (!TRADE_GOOD_IDS.includes(cargoId)) throw new Error(`Unknown trade good ID: ${cargoId}`);
        const amount = sanitizePositiveInteger(quantity, 'trade quantity');
        const gameTime = sanitizeGameTime(this.getGameTime(), 'trade gameTime');
        this.update(gameTime);
        const envelope = this.slots.getActiveEnvelope();
        const ship = sanitizeShipState(envelope.ship);
        const economy = sanitizeEconomyState(envelope.simulation.economy, { gameTime });
        const marketId = this.activeMarketId;
        const definition = getMarketDefinition(marketId);
        const listing = definition.goods[cargoId];
        const market = economy.markets.byId[marketId];
        const stockBefore = market.goods[cargoId].stock;
        const quote = calculateMarketQuote(marketId, cargoId, stockBefore);
        if (!quote[`${side}Allowed`]) {
            throw new Error(`${definition.name} does not permit ${side} transactions for ${cargoId}.`);
        }
        const unitPrice = side === 'buy' ? quote.buyPrice : quote.sellPrice;
        const total = safeMultiply(unitPrice, amount, 'trade total');
        const creditsBefore = requireSafeCredits(ship.credits);
        const cargoBefore = getCargoQuantity(ship, cargoId);
        if (side === 'buy') {
            if (stockBefore < amount) {
                throw new Error(`Insufficient market stock for ${cargoId}: ${stockBefore} available, ${amount} requested.`);
            }
            if (creditsBefore < total) {
                throw new Error(`Insufficient credits: ${total} required, ${creditsBefore} available.`);
            }
            const cargo = getCargoDefinition(cargoId);
            const availableMass = ship.cargo.capacityMass - calculateCargoMass(ship.cargo.stacks);
            const requiredMass = cargo.unitMass * amount;
            if (requiredMass > availableMass) {
                throw new Error(`Insufficient cargo capacity: ${requiredMass} mass required, ${availableMass} available.`);
            }
            ship.credits = creditsBefore - total;
            addCargo(ship, cargoId, amount);
            market.goods[cargoId].stock -= amount;
        } else {
            if (cargoBefore < amount) {
                throw new Error(`Insufficient cargo quantity for ${cargoId}: ${cargoBefore} aboard, ${amount} requested.`);
            }
            if (stockBefore + amount > listing.maximumStock) {
                throw new Error(`Market capacity exceeded for ${cargoId}: ${listing.maximumStock - stockBefore} units available.`);
            }
            ship.credits = safeAdd(creditsBefore, total, 'trade credits');
            removeCargo(ship, cargoId, amount);
            market.goods[cargoId].stock += amount;
        }
        const cleanShip = sanitizeShipState(ship);
        const sequence = economy.nextLedgerSequence;
        const stockAfter = market.goods[cargoId].stock;
        const cargoAfter = getCargoQuantity(cleanShip, cargoId);
        economy.nextLedgerSequence += 1;
        economy.ledger.push({
            id: `trade-${String(sequence).padStart(6, '0')}`,
            sequence,
            marketId,
            systemId: definition.systemId,
            cargoId,
            side,
            quantity: amount,
            unitPrice,
            total,
            gameTime,
            creditsBefore,
            creditsAfter: cleanShip.credits,
            stockBefore,
            stockAfter,
            cargoBefore,
            cargoAfter
        });
        economy.ledger = economy.ledger.slice(-MAX_TRADE_LEDGER_ENTRIES);
        economy.intel.byMarketId[marketId] = createIntelSnapshot(market, gameTime);
        this._commit(cleanShip, economy, `market-${side}`);
        return {
            changed: true,
            transaction: structuredClone(economy.ledger.at(-1)),
            state: this.getState()
        };
    }

    _read() {
        const envelope = this.slots.getActiveEnvelope();
        return sanitizeEconomyState(envelope.simulation.economy, {
            gameTime: envelope.simulation.gameTime
        });
    }

    _commit(ship, economy, reason) {
        return this.slots.saveDomains(
            {
                ship: sanitizeShipState(ship),
                economy: sanitizeEconomyState(economy, { gameTime: this.getGameTime() }),
                gameTime: this.getGameTime()
            },
            { kind: 'auto', reason }
        );
    }
}

function listing(
    basePrice,
    initialStock,
    targetStock,
    production,
    consumption,
    buyAllowed = true,
    sellAllowed = true
) {
    return Object.freeze({
        basePrice,
        minimumStock: 0,
        maximumStock: 100,
        initialStock,
        targetStock,
        production,
        consumption,
        buyAllowed,
        sellAllowed
    });
}

function market(value) {
    return Object.freeze({
        ...value,
        goods: Object.freeze(Object.fromEntries(
            Object.entries(value.goods).map(([id, entry]) => [id, Object.freeze(entry)])
        ))
    });
}

function sanitizeMarket(value, marketId, gameTime) {
    const definition = getMarketDefinition(marketId);
    if (value?.id !== marketId) throw new Error(`Economy market ID mismatch: ${value?.id ?? 'missing'}/${marketId}.`);
    if (value.systemId !== definition.systemId) throw new Error(`Economy market system mismatch: ${marketId}.`);
    assertExactIds(value.goods, TRADE_GOOD_IDS, `economy market ${marketId} good`);
    const goods = {};
    for (const cargoId of TRADE_GOOD_IDS) {
        goods[cargoId] = {
            stock: sanitizeStock(
                value.goods[cargoId]?.stock,
                definition.goods[cargoId],
                `economy.${marketId}.${cargoId}.stock`
            )
        };
    }
    const lastUpdatedAtGameTime = sanitizeGameTime(
        value.lastUpdatedAtGameTime,
        `economy.${marketId}.lastUpdatedAtGameTime`
    );
    if (lastUpdatedAtGameTime > gameTime) {
        throw new Error(`Economy market update time cannot exceed game time: ${marketId}.`);
    }
    return { id: marketId, systemId: definition.systemId, lastUpdatedAtGameTime, goods };
}

function sanitizeIntel(value, marketId, gameTime) {
    const observedAtGameTime = sanitizeGameTime(
        value?.observedAtGameTime,
        `economy.intel.${marketId}.observedAtGameTime`
    );
    if (observedAtGameTime > gameTime) {
        throw new Error(`Economy intel observation cannot exceed game time: ${marketId}.`);
    }
    assertExactIds(value?.goods, TRADE_GOOD_IDS, `economy intel ${marketId} good`);
    const goods = {};
    for (const cargoId of TRADE_GOOD_IDS) {
        const stock = sanitizeStock(
            value.goods[cargoId]?.stock,
            MARKET_DEFINITIONS[marketId].goods[cargoId],
            `economy.intel.${marketId}.${cargoId}.stock`
        );
        const expected = calculateMarketQuote(marketId, cargoId, stock);
        const buyPrice = sanitizePositiveInteger(
            value.goods[cargoId]?.buyPrice,
            `economy.intel.${marketId}.${cargoId}.buyPrice`
        );
        const sellPrice = sanitizePositiveInteger(
            value.goods[cargoId]?.sellPrice,
            `economy.intel.${marketId}.${cargoId}.sellPrice`
        );
        if (buyPrice !== expected.buyPrice || sellPrice !== expected.sellPrice) {
            throw new Error(`Forged economy intel quote: ${marketId}/${cargoId}.`);
        }
        goods[cargoId] = { stock, buyPrice, sellPrice };
    }
    return { observedAtGameTime, goods };
}

function sanitizeLedgerEntry(value, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Economy ledger entry ${index} must be an object.`);
    }
    const sequence = sanitizePositiveInteger(value.sequence, `economy.ledger[${index}].sequence`);
    const id = `trade-${String(sequence).padStart(6, '0')}`;
    if (value.id !== id) throw new Error(`Invalid economy ledger ID: ${value.id ?? 'missing'}.`);
    const market = getMarketDefinition(value.marketId);
    if (value.systemId !== market.systemId) throw new Error(`Economy ledger market/system mismatch: ${id}.`);
    if (!TRADE_GOOD_IDS.includes(value.cargoId)) throw new Error(`Unknown trade good ID in economy ledger: ${value.cargoId}`);
    if (!['buy', 'sell'].includes(value.side)) throw new Error(`Unknown economy ledger side: ${value.side}`);
    const quantity = sanitizePositiveInteger(value.quantity, `${id}.quantity`);
    const unitPrice = sanitizePositiveInteger(value.unitPrice, `${id}.unitPrice`);
    const total = sanitizeNonNegativeSafeInteger(value.total, `${id}.total`);
    if (total !== safeMultiply(unitPrice, quantity, id)) throw new Error(`Economy ledger total mismatch: ${id}.`);
    const gameTime = sanitizeGameTime(value.gameTime, `${id}.gameTime`);
    const creditsBefore = sanitizeNonNegativeSafeInteger(value.creditsBefore, `${id}.creditsBefore`);
    const creditsAfter = sanitizeNonNegativeSafeInteger(value.creditsAfter, `${id}.creditsAfter`);
    const stockBefore = sanitizeStock(value.stockBefore, market.goods[value.cargoId], `${id}.stockBefore`);
    const stockAfter = sanitizeStock(value.stockAfter, market.goods[value.cargoId], `${id}.stockAfter`);
    const cargoBefore = sanitizeNonNegativeSafeInteger(value.cargoBefore, `${id}.cargoBefore`);
    const cargoAfter = sanitizeNonNegativeSafeInteger(value.cargoAfter, `${id}.cargoAfter`);
    const direction = value.side === 'buy' ? -1 : 1;
    if (
        creditsAfter !== creditsBefore + direction * total
        || stockAfter !== stockBefore + direction * quantity
        || cargoAfter !== cargoBefore - direction * quantity
    ) {
        throw new Error(`Economy ledger invariant mismatch: ${id}.`);
    }
    return {
        id, sequence, marketId: value.marketId, systemId: value.systemId,
        cargoId: value.cargoId, side: value.side, quantity, unitPrice, total,
        gameTime, creditsBefore, creditsAfter, stockBefore, stockAfter,
        cargoBefore, cargoAfter
    };
}

function createIntelSnapshot(marketState, observedAtGameTime) {
    const goods = {};
    for (const cargoId of TRADE_GOOD_IDS) {
        const quote = calculateMarketQuote(
            marketState.id,
            cargoId,
            marketState.goods[cargoId].stock
        );
        goods[cargoId] = {
            stock: quote.stock,
            buyPrice: quote.buyPrice,
            sellPrice: quote.sellPrice
        };
    }
    return { observedAtGameTime, goods };
}

function addCargo(ship, cargoId, quantity) {
    const stack = ship.cargo.stacks.find((entry) => entry.cargoId === cargoId);
    if (stack) stack.quantity += quantity;
    else ship.cargo.stacks.push({ cargoId, quantity });
}

function removeCargo(ship, cargoId, quantity) {
    const stack = ship.cargo.stacks.find((entry) => entry.cargoId === cargoId);
    if (!stack || stack.quantity < quantity) {
        throw new Error(`Cannot remove ${quantity} units of cargo ${cargoId}; insufficient quantity.`);
    }
    stack.quantity -= quantity;
    ship.cargo.stacks = ship.cargo.stacks.filter((entry) => entry.quantity > 0);
}

function sanitizeStock(value, config, label) {
    const stock = sanitizeNonNegativeSafeInteger(value, label);
    if (stock < config.minimumStock || stock > config.maximumStock) {
        throw new Error(`${label} must be within ${config.minimumStock}-${config.maximumStock}.`);
    }
    return stock;
}

function sanitizePositiveInteger(value, label) {
    const number = sanitizeNonNegativeSafeInteger(value, label);
    if (number <= 0) throw new Error(`${label} must be a positive integer.`);
    return number;
}

function sanitizeNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
    return number;
}

function sanitizeGameTime(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`${label} must be a non-negative finite number.`);
    }
    return number;
}

function requireSafeCredits(value) {
    return sanitizeNonNegativeSafeInteger(value, 'ship.credits for trade');
}

function safeMultiply(a, b, label) {
    const result = a * b;
    if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} exceeds safe integer limits.`);
    return result;
}

function safeAdd(a, b, label) {
    const result = a + b;
    if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} exceeds safe integer limits.`);
    return result;
}

function clampInteger(value, minimum, maximum) {
    if (!Number.isFinite(value)) throw new Error(`Cannot clamp non-finite integer: ${value}`);
    return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function assertExactIds(value, expected, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} registry must be an object.`);
    }
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((id, index) => id !== wanted[index])) {
        const unknown = actual.find((id) => !wanted.includes(id));
        const missing = wanted.find((id) => !actual.includes(id));
        throw new Error(`Invalid ${label} ID: ${unknown ?? `missing ${missing}`}.`);
    }
}
