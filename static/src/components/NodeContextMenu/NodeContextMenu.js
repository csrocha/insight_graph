/** @odoo-module **/

import { Component } from "@odoo/owl";

export class NodeContextMenu extends Component {
    static template = "insight_graph.NodeContextMenu";
    static props = {
        // Rendered bounding box of selected node, relative to graphBody container
        pos: Object,       // { x1, y1, w, h }
        linkDefs: Array,   // [{ field, direction, model }]
        onOpenForm: Function,
        onDelete: Function,
        onHide: Function,
        onStartLink: Function, // (mousedownEvent, linkDef) => void
    };

    get overlayStyle() {
        const { x1, y1, w, h } = this.props.pos;
        return `left:${x1}px;top:${y1}px;width:${w}px;height:${h}px;`;
    }

    modelShortName(model) {
        return model.split(".").pop().substring(0, 3).toUpperCase();
    }
}
