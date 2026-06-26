export const CONTACT_DEFINITIONS = Object.freeze({
    port_meridian_harbormaster: Object.freeze({
        id: 'port_meridian_harbormaster',
        type: 'contact',
        name: 'Harbormaster Vale',
        title: 'Port Meridian Traffic Office',
        factionId: 'commonwealth',
        civTier: 2,
        namedSystemId: 'entry_hub',
        initialNodeId: 'intro',
        nodes: Object.freeze({
            intro: Object.freeze({
                id: 'intro',
                text: 'Port Meridian traffic office, receiving you. Hold your line and keep your transponder warm. New arrivals are welcome here, provided they do not make trouble for the people keeping the lights on.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'ask_port_meridian',
                        label: 'Ask about Port Meridian.',
                        nextNodeId: 'port_meridian'
                    }),
                    Object.freeze({
                        id: 'ask_commonwealth',
                        label: 'Ask about the Commonwealth presence.',
                        nextNodeId: 'commonwealth'
                    }),
                    Object.freeze({
                        id: 'ask_work',
                        label: 'Ask if there is work available.',
                        missionAction: Object.freeze({
                            type: 'offer',
                            missionId: 'port_meridian_route_packet'
                        }),
                        missionNodeMap: Object.freeze({
                            unavailable: 'mission_offer',
                            offered: 'mission_offer',
                            accepted: 'mission_accepted',
                            'resolved:commonwealth': 'mission_resolved_commonwealth',
                            'resolved:index': 'mission_resolved_index',
                            'failed:declined': 'mission_declined',
                            default: 'mission_offer'
                        })
                    }),
                    Object.freeze({
                        id: 'ask_delivery_work',
                        label: 'Ask about freight bound for the Index.',
                        missionAction: Object.freeze({
                            type: 'offer',
                            missionId: 'index_archive_delivery'
                        }),
                        missionNodeMap: Object.freeze({
                            unavailable: 'delivery_offer',
                            offered: 'delivery_offer',
                            accepted: 'delivery_accepted',
                            'resolved:delivered': 'delivery_resolved',
                            'failed:abandoned': 'delivery_abandoned',
                            'failed:cargo_lost': 'delivery_lost',
                            default: 'delivery_offer'
                        })
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            port_meridian: Object.freeze({
                id: 'port_meridian',
                text: 'Port Meridian is less a station than a promise people keep making to each other. Ships arrive cold, hungry, and half-broken; most leave warmer than they came in.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'return_intro',
                        label: 'Return to the channel menu.',
                        nextNodeId: 'intro'
                    }),
                    Object.freeze({
                        id: 'ask_work',
                        label: 'Ask if there is work available.',
                        missionAction: Object.freeze({
                            type: 'offer',
                            missionId: 'port_meridian_route_packet'
                        }),
                        missionNodeMap: Object.freeze({
                            unavailable: 'mission_offer',
                            offered: 'mission_offer',
                            accepted: 'mission_accepted',
                            'resolved:commonwealth': 'mission_resolved_commonwealth',
                            'resolved:index': 'mission_resolved_index',
                            'failed:declined': 'mission_declined',
                            default: 'mission_offer'
                        })
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            commonwealth: Object.freeze({
                id: 'commonwealth',
                text: 'Commonwealth crews built the port, but no one owns the dark around it. We keep berths open, routes marked, and arguments from becoming wars when we can manage it.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'return_intro',
                        label: 'Return to the channel menu.',
                        nextNodeId: 'intro'
                    }),
                    Object.freeze({
                        id: 'ask_port_meridian',
                        label: 'Ask about Port Meridian.',
                        nextNodeId: 'port_meridian'
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            work: Object.freeze({
                id: 'work',
                text: 'There is work now. A route packet came in with the authentication stripped and the margins full of Index notation. I need a pilot to decide whether this stays with traffic control or leaves through an archive channel.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'accept_route_packet',
                        label: 'Accept the route packet errand.',
                        missionAction: Object.freeze({
                            type: 'accept',
                            missionId: 'port_meridian_route_packet'
                        }),
                        nextNodeId: 'mission_accepted'
                    }),
                    Object.freeze({
                        id: 'decline_route_packet',
                        label: 'Decline the errand.',
                        missionAction: Object.freeze({
                            type: 'fail',
                            missionId: 'port_meridian_route_packet',
                            outcomeId: 'declined'
                        }),
                        nextNodeId: 'mission_declined'
                    }),
                    Object.freeze({
                        id: 'return_intro',
                        label: 'Return to the channel menu.',
                        nextNodeId: 'intro'
                    }),
                    Object.freeze({
                        id: 'ask_commonwealth',
                        label: 'Ask about the Commonwealth presence.',
                        nextNodeId: 'commonwealth'
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            mission_offer: Object.freeze({
                id: 'mission_offer',
                text: 'Here is the lawful version: an inbound courier dumped a corrupted route packet before vanishing off beacon. The Commonwealth wants it folded into Port Meridian traffic control. The Index will pay for the raw pattern. You carry it; you choose where it lands.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'accept_route_packet',
                        label: 'Accept the route packet errand.',
                        missionAction: Object.freeze({
                            type: 'accept',
                            missionId: 'port_meridian_route_packet'
                        }),
                        nextNodeId: 'mission_accepted'
                    }),
                    Object.freeze({
                        id: 'decline_route_packet',
                        label: 'Decline the errand.',
                        missionAction: Object.freeze({
                            type: 'fail',
                            missionId: 'port_meridian_route_packet',
                            outcomeId: 'declined'
                        }),
                        nextNodeId: 'mission_declined'
                    }),
                    Object.freeze({
                        id: 'return_intro',
                        label: 'Return to the channel menu.',
                        nextNodeId: 'intro'
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            mission_accepted: Object.freeze({
                id: 'mission_accepted',
                text: 'Packet is on your board. No cargo, no docking, no firefight; just a decision with teeth. Send it to Port Meridian traffic and we can harden the public routes. Send it to the Index and the archive gets the pattern first.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'resolve_route_commonwealth',
                        label: 'Deliver the route packet to Port Meridian traffic control.',
                        missionAction: Object.freeze({
                            type: 'resolve',
                            missionId: 'port_meridian_route_packet',
                            branchId: 'commonwealth'
                        }),
                        nextNodeId: 'mission_resolved_commonwealth'
                    }),
                    Object.freeze({
                        id: 'resolve_route_index',
                        label: 'Sell a clean copy to the Index archive channel.',
                        missionAction: Object.freeze({
                            type: 'resolve',
                            missionId: 'port_meridian_route_packet',
                            branchId: 'index'
                        }),
                        nextNodeId: 'mission_resolved_index'
                    }),
                    Object.freeze({
                        id: 'return_intro',
                        label: 'Return to the channel menu.',
                        nextNodeId: 'intro'
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            mission_resolved_commonwealth: Object.freeze({
                id: 'mission_resolved_commonwealth',
                text: 'Traffic control has the packet. We are already scrubbing the public beacons against it. The Index will hate being second to the signal, but every cold ship coming in on those lanes owes you a quiet thanks.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'return_intro',
                        label: 'Return to the channel menu.',
                        nextNodeId: 'intro'
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            mission_resolved_index: Object.freeze({
                id: 'mission_resolved_index',
                text: 'The archive channel confirms receipt. The Index will make a cathedral out of the pattern by morning. Port Meridian can still survive with yesterday\'s maps, but do not expect traffic control to call that prudence.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'return_intro',
                        label: 'Return to the channel menu.',
                        nextNodeId: 'intro'
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            mission_declined: Object.freeze({
                id: 'mission_declined',
                text: 'Understood. I will mark you unavailable for the packet and keep it in the office queue. Some work waits. Some work curdles. This one will do one or the other without you.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'return_intro',
                        label: 'Return to the channel menu.',
                        nextNodeId: 'intro'
                    }),
                    Object.freeze({
                        id: 'end_transmission',
                        label: 'End transmission.',
                        close: true
                    })
                ])
            }),
            delivery_offer: Object.freeze({
                id: 'delivery_offer',
                text: 'Four sealed Index archive canisters are waiting at your cargo terminal. Take them to Index Relay K-7 intact. The relay pays 850 credits; the route and the fuel are yours to manage.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'accept_archive_delivery',
                        label: 'Accept the Index archive delivery.',
                        missionAction: Object.freeze({
                            type: 'accept',
                            missionId: 'index_archive_delivery'
                        }),
                        nextNodeId: 'delivery_accepted'
                    }),
                    Object.freeze({
                        id: 'decline_archive_delivery',
                        label: 'Decline the freight job.',
                        missionAction: Object.freeze({
                            type: 'fail',
                            missionId: 'index_archive_delivery',
                            outcomeId: 'abandoned'
                        }),
                        nextNodeId: 'delivery_abandoned'
                    }),
                    Object.freeze({ id: 'return_intro', label: 'Return to the channel menu.', nextNodeId: 'intro' }),
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            delivery_accepted: Object.freeze({
                id: 'delivery_accepted',
                text: 'The cargo authorization is live. Load the canisters at your ship terminal, lock Index Relay K-7, and keep your protected fuel reserve intact.',
                choices: Object.freeze([
                    Object.freeze({ id: 'return_intro', label: 'Return to the channel menu.', nextNodeId: 'intro' }),
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            delivery_resolved: Object.freeze({
                id: 'delivery_resolved',
                text: 'Relay K-7 confirms the canisters and the payment. Clean work. The Index now has one more piece of the dark pinned under glass.',
                choices: Object.freeze([
                    Object.freeze({ id: 'return_intro', label: 'Return to the channel menu.', nextNodeId: 'intro' }),
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            delivery_abandoned: Object.freeze({
                id: 'delivery_abandoned',
                text: 'Understood. The freight authorization is closed and the canisters are no longer your responsibility.',
                choices: Object.freeze([
                    Object.freeze({ id: 'return_intro', label: 'Return to the channel menu.', nextNodeId: 'intro' }),
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            delivery_lost: Object.freeze({
                id: 'delivery_lost',
                text: 'The loss report reached us. The Index will notice the empty shelf, even if it never learns your name.',
                choices: Object.freeze([
                    Object.freeze({ id: 'return_intro', label: 'Return to the channel menu.', nextNodeId: 'intro' }),
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            })
        })
    }),
    index_hq_archivist: Object.freeze({
        id: 'index_hq_archivist',
        type: 'contact',
        name: 'Archivist Senn',
        title: 'Index Relay K-7 Intake',
        factionId: 'index',
        civTier: 2,
        namedSystemId: 'index_hq',
        initialNodeId: 'intro',
        nodes: Object.freeze({
            intro: Object.freeze({
                id: 'intro',
                text: 'Index Relay K-7 intake acknowledges your transponder. Physical archive deliveries are verified through the cargo terminal; nothing enters the catalogue on a voice claim.',
                choices: Object.freeze([
                    Object.freeze({
                        id: 'ask_delivery_status',
                        label: 'Ask about the Port Meridian delivery.',
                        missionAction: Object.freeze({
                            type: 'offer',
                            missionId: 'index_archive_delivery'
                        }),
                        missionNodeMap: Object.freeze({
                            unavailable: 'not_expected',
                            offered: 'not_expected',
                            accepted: 'awaiting_terminal',
                            'resolved:delivered': 'received',
                            'failed:abandoned': 'closed',
                            'failed:cargo_lost': 'lost',
                            default: 'not_expected'
                        })
                    }),
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            awaiting_terminal: Object.freeze({
                id: 'awaiting_terminal',
                text: 'Your manifest matches the expected seal count. Complete the physical transfer at your cargo terminal.',
                choices: Object.freeze([
                    Object.freeze({ id: 'return_intro', label: 'Return to intake.', nextNodeId: 'intro' }),
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            received: Object.freeze({
                id: 'received',
                text: 'Four seals verified. Eight hundred fifty credits released. Your delivery is now part of the permanent record.',
                choices: Object.freeze([
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            not_expected: Object.freeze({
                id: 'not_expected',
                text: 'No active freight authorization is attached to your transponder.',
                choices: Object.freeze([
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            closed: Object.freeze({
                id: 'closed',
                text: 'The Port Meridian authorization was abandoned. Intake has closed the record.',
                choices: Object.freeze([
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            }),
            lost: Object.freeze({
                id: 'lost',
                text: 'The manifest is marked lost. There is nothing for intake to verify.',
                choices: Object.freeze([
                    Object.freeze({ id: 'end_transmission', label: 'End transmission.', close: true })
                ])
            })
        })
    })
});

export const CONTACT_IDS = Object.freeze(Object.keys(CONTACT_DEFINITIONS));
