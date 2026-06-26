export const FACTION_DEFINITIONS = Object.freeze({
    index: Object.freeze({
        id: 'index',
        name: 'Index',
        civTier: 2
    }),
    drifters: Object.freeze({
        id: 'drifters',
        name: 'Drifters',
        civTier: 2
    }),
    concordance: Object.freeze({
        id: 'concordance',
        name: 'The Concordance',
        civTier: 2
    }),
    commonwealth: Object.freeze({
        id: 'commonwealth',
        name: 'The Commonwealth',
        civTier: 2
    }),
    company_of_doom: Object.freeze({
        id: 'company_of_doom',
        name: 'Company of Doom',
        civTier: 2
    }),
    truth_seekers: Object.freeze({
        id: 'truth_seekers',
        name: 'The Truth Seekers',
        civTier: 2
    })
});

export const NAMED_SYSTEM_DEFINITIONS = Object.freeze({
    entry_hub: Object.freeze({
        id: 'entry_hub',
        name: 'Port Meridian',
        navigationLabel: 'Port Meridian',
        role: 'Entry hub - first major port, multi-faction, dense',
        startingTier: 2,
        startingFactionId: 'commonwealth',
        seed: 'rpg-entry-hub-v1',
        position: Object.freeze([12000, 1400, -18000]),
        star: Object.freeze({
            color: '#ffd89a',
            temperatureK: 5400,
            luminosity: 1.35
        })
    }),
    index_hq: Object.freeze({
        id: 'index_hq',
        role: 'Index HQ - the archive world, information is currency',
        startingTier: 2,
        startingFactionId: 'index'
    }),
    drifter_convergence: Object.freeze({
        id: 'drifter_convergence',
        role: 'Drifter convergence - ship-born meeting point',
        startingTier: 2,
        startingFactionId: 'drifters'
    }),
    concordance_pilgrimage_site: Object.freeze({
        id: 'concordance_pilgrimage_site',
        role: 'Concordance pilgrimage site - near a Tier 4 trace',
        startingTier: 2,
        startingFactionId: 'concordance'
    }),
    company_of_doom_stronghold: Object.freeze({
        id: 'company_of_doom_stronghold',
        role: 'Company of Doom stronghold - anti-ascension bastion',
        startingTier: 2,
        startingFactionId: 'company_of_doom'
    }),
    truth_seeker_site: Object.freeze({
        id: 'truth_seeker_site',
        role: 'Truth Seeker site - partially transformed, unsettling',
        startingTier: 2,
        startingFactionId: 'truth_seekers'
    }),
    tier_3_enclave: Object.freeze({
        id: 'tier_3_enclave',
        role: "Tier 3 enclave - a post-human group's domain",
        startingTier: 3,
        startingFactionId: null
    }),
    tier_0_world: Object.freeze({
        id: 'tier_0_world',
        role: 'Tier 0 world - pre-spaceflight civilization on a true-scale planet',
        startingTier: 0,
        startingFactionId: null
    }),
    deep_void_anomaly: Object.freeze({
        id: 'deep_void_anomaly',
        role: 'Deep void anomaly - Tier 4 trace, no faction claim',
        startingTier: 4,
        startingFactionId: null
    }),
    threshold: Object.freeze({
        id: 'threshold',
        role: 'The Threshold - where ascension becomes possible',
        startingTier: 4,
        startingFactionId: null
    })
});

export const FACTION_IDS = Object.freeze(Object.keys(FACTION_DEFINITIONS));
export const NAMED_SYSTEM_IDS = Object.freeze(Object.keys(NAMED_SYSTEM_DEFINITIONS));
