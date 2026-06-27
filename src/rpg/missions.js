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
    }),
    index_k7_surface_verification: Object.freeze({
        id: 'index_k7_surface_verification',
        name: 'K-7 Surface Verification',
        namedSystemId: 'index_hq',
        contactId: 'index_hq_archivist',
        initialStatus: MISSION_STATUSES.UNAVAILABLE,
        requiresExternalResolution: true,
        description: 'Verify the K-7 Cartography Annex beacon from the surface and report from the ship.',
        surfacePoiId: 'index_k7_cartography_outpost',
        objectives: Object.freeze({
            discover_k7_outpost: Object.freeze({
                id: 'discover_k7_outpost',
                label: 'Acquire the K-7 Cartography Annex scanner contact.'
            }),
            land_at_k7_outpost: Object.freeze({
                id: 'land_at_k7_outpost',
                label: 'Land inside the marked safe area.'
            }),
            access_k7_surface_terminal: Object.freeze({
                id: 'access_k7_surface_terminal',
                label: 'Verify the archive beacon at the surface terminal.'
            }),
            return_to_ship: Object.freeze({
                id: 'return_to_ship',
                label: 'Return to and board the ship.'
            }),
            report_k7_surface_survey: Object.freeze({
                id: 'report_k7_surface_survey',
                label: 'Report the survey from the ship log.'
            })
        }),
        branches: Object.freeze({
            survey_reported: Object.freeze({
                id: 'survey_reported',
                label: 'Reported the verified K-7 surface beacon.',
                worldFlags: Object.freeze({
                    'index_hq.k7_surface_verification_complete': true
                })
            })
        }),
        failureOutcomes: Object.freeze({})
    }),
    wayfarer_derelict_recovery: Object.freeze({
        id: 'wayfarer_derelict_recovery',
        name: 'A Quiet Crossing',
        namedSystemId: 'drifter_convergence',
        contactId: null,
        initialStatus: MISSION_STATUSES.UNAVAILABLE,
        requiresExternalResolution: true,
        description: 'Secure beside a Wayfarer survey wreck, recover its operations log, and return.',
        boardingPoiId: 'wayfarer_research_derelict',
        objectives: Object.freeze({
            secure_wayfarer_derelict: Object.freeze({
                id: 'secure_wayfarer_derelict',
                label: 'Stabilize close to the Wayfarer survey wreck.'
            }),
            board_wayfarer_derelict: Object.freeze({
                id: 'board_wayfarer_derelict',
                label: 'Cross by EVA and enter the survey wreck.'
            }),
            recover_wayfarer_log: Object.freeze({
                id: 'recover_wayfarer_log',
                label: 'Recover the wreck operations log.'
            }),
            return_from_wayfarer_derelict: Object.freeze({
                id: 'return_from_wayfarer_derelict',
                label: 'Return safely to the ship.'
            })
        }),
        branches: Object.freeze({
            log_recovered: Object.freeze({
                id: 'log_recovered',
                label: 'Recovered the survey wreck operations log.',
                worldFlags: Object.freeze({
                    'drifter_convergence.wayfarer_derelict_log_recovered': true
                })
            })
        }),
        failureOutcomes: Object.freeze({})
    })
});

export const MISSION_IDS = Object.freeze(Object.keys(MISSION_DEFINITIONS));
