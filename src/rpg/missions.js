export const MISSION_STATUSES = Object.freeze({
    UNAVAILABLE: 'unavailable',
    OFFERED: 'offered',
    ACCEPTED: 'accepted',
    RESOLVED: 'resolved',
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
    })
});

export const MISSION_IDS = Object.freeze(Object.keys(MISSION_DEFINITIONS));
