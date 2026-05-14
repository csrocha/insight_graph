/** @odoo-module **/

import { Component } from "@odoo/owl";

export class NodeTooltip extends Component {
    static template = "insight_graph.NodeTooltip";
    static props = {
        info: {
            type: Object,
            shape: {
                x: Number,
                y: Number,
                label: String,
                model: { type: String, optional: true },
                flowState: { type: String, optional: true },
                flowStateLabel: { type: String, optional: true },
                fields: { type: Array, optional: true },
            },
        },
    };
}
