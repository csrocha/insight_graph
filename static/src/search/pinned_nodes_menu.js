/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { patch } from "@web/core/utils/patch";
import { SearchBar } from "@web/search/search_bar/search_bar";
import { SearchBarMenu } from "@web/search/search_bar_menu/search_bar_menu";

export class PinnedNodesMenu extends Component {
    static template = "insight_graph.PinnedNodesMenu";

    setup() {
        this.state = useState({ search: "" });
    }

    get pinnedNodes() {
        return (this.env.igControllerState?.graphData?.nodes || []).filter((n) => n.isPinned);
    }

    get filteredPinnedNodes() {
        const search = this.state.search.toLowerCase().trim();
        if (!search) return this.pinnedNodes;
        return this.pinnedNodes.filter((n) => n.label.toLowerCase().includes(search));
    }

    onSelectNode(nodeId) {
        this.env.igCenterOnNode?.(nodeId);
    }
}

// Register PinnedNodesMenu in SearchBarMenu (where the t-inherit extension lives).
SearchBarMenu.components = { ...(SearchBarMenu.components || {}), PinnedNodesMenu };
