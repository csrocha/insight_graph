/** @odoo-module **/

import { Component } from "@odoo/owl";

export class NodeContextMenu extends Component {
    static template = "insight_graph.NodeContextMenu";
    static props = {
        // Rendered bounding box of selected node, relative to graphBody container
        pos: Object,        // { x1, y1, w, h }
        linkDefs: Array,    // [{ field, direction, model, isCollapsed }]
        isPinned: Boolean,
        onDelete: Function,
        onHide: Function,
        onPin: Function,
        onUnpin: Function,
        onStartLink: Function, // (mousedownEvent, linkDef) => void — drag
        onClickLink: Function, // (linkDef) => void — click (only for collapsed circles)
    };

    get overlayStyle() {
        const { x1, y1, w, h } = this.props.pos;
        return `left:${x1}px;top:${y1}px;width:${w}px;height:${h}px;`;
    }

    circleLabel(link) {
        const label = link.fieldString || link.model.split(".").pop();
        return label.substring(0, 3).toUpperCase();
    }

    circleTitle(link) {
        const label = link.fieldString || link.model.split(".").pop();
        return link.isCollapsed ? `Expandir: ${label}` : label;
    }

    // Click on a relation circle: only acts when collapsed
    onCircleClick(link) {
        if (link.isCollapsed) this.props.onClickLink(link);
    }
}
