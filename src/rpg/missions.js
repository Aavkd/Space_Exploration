export const MISSION_STATUSES = Object.freeze({
    UNAVAILABLE: 'unavailable',
    OFFERED: 'offered',
    ACCEPTED: 'accepted',
    RESOLVED: 'resolved',
    FAILED: 'failed'
});

export const OBJECTIVE_STATUSES = Object.freeze({
    PENDING: 'pending',
    ACTIVE: 'active',
    COMPLETE: 'complete',
    FAILED: 'failed'
});

export const MISSION_DEFINITIONS = Object.freeze({
    port_meridian_route_packet: Object.freeze({
        id: 'port_meridian_route_packet',
        name: 'A Clean Copy',
        namedSystemId: 'entry_hub',
        contactId: 'port_meridian_harbormaster',
        initialStatus: MISSION_STATUSES.UNAVAILABLE,
        description: 'Choose the fate of a damaged route-intel packet recovered near Port Meridian.',
        branches: Object.freeze({
            commonwealth: Object.freeze({
                id: 'commonwealth',
                label: 'Turn the route packet over to Port Meridian traffic control.',
                worldFlags: Object.freeze({
                    'port_meridian.route_packet_owner': 'commonwealth',
                    'port_meridian.route_packet_commonwealth_secured': true,
                    'port_meridian.route_packet_index_archived': false,
                    'port_meridian.route_packet_resolved': true
                }),
                reputation: Object.freeze({
                    commonwealth: 0.18,
                    index: -0.08
                })
            }),
            index: Object.freeze({
                id: 'index',
                label: 'Sell the packet to the Index archive channel.',
                worldFlags: Object.freeze({
                    'port_meridian.route_packet_owner': 'index',
                    'port_meridian.route_packet_commonwealth_secured': false,
                    'port_meridian.route_packet_index_archived': true,
                    'port_meridian.route_packet_resolved': true
                }),
                reputation: Object.freeze({
                    index: 0.18,
                    commonwealth: -0.08
                })
            })
        }),
        failureOutcomes: Object.freeze({
            declined: Object.freeze({
                id: 'declined',
                label: 'Declined the route packet errand.',
                worldFlags: Object.freeze({
                    'port_meridian.route_packet_declined': true
                })
            })
        })
    }),
    index_archive_delivery: Object.freeze({
        id: 'index_archive_delivery',
        name: 'The Weight of a Copy',
        namedSystemId: 'entry_hub',
        contactId: 'port_meridian_harbormaster',
        initialStatus: MISSION_STATUSES.UNAVAILABLE,
        requiresExternalResolution: true,
        description: 'Carry four sealed archive canisters from Port Meridian to the Index HQ relay.',
        cargo: Object.freeze({
            cargoId: 'index_archive_canister',
            quantity: 4,
            pickupSystemId: 'entry_hub',
            deliverySystemId: 'index_hq'
        }),
        objectives: Object.freeze({
            load_archive_canisters: Object.freeze({
                id: 'load_archive_canisters',
                label: 'Load four sealed archive canisters at Port Meridian.'
            }),
            travel_to_index_hq: Object.freeze({
                id: 'travel_to_index_hq',
                label: 'Travel to Index Relay K-7.'
            }),
            deliver_archive_canisters: Object.freeze({
                id: 'deliver_archive_canisters',
                label: 'Deliver the canisters through the cargo terminal.'
            })
        }),
        branches: Object.freeze({
            delivered: Object.freeze({
                id: 'delivered',
                label: 'Delivered the sealed archive canisters.',
                credits: 850,
                reputation: Object.freeze({ index: 0.15 }),
                worldFlags: Object.freeze({
                    'index_hq.archive_delivery_complete': true
                })
            })
        }),
        failureOutcomes: Object.freeze({
            abandoned: Object.freeze({
                id: 'abandoned',
                label: 'Abandoned the archive delivery.',
                worldFlags: Object.freeze({
                    'index_hq.archive_delivery_abandoned': true
                })
            }),
            cargo_lost: Object.freeze({
                id: 'cargo_lost',
                label: 'Lost or jettisoned the archive canisters.',
                worldFlags: Object.freeze({
                    'index_hq.archive_delivery_cargo_lost': true
                })
            })
        })
    })
});

export const MISSION_IDS = Object.freeze(Object.keys(MISSION_DEFINITIONS));
