/** @odoo-module **/

import { registry } from "@web/core/registry";
import { InsightGraphArchParser } from "./insight_graph_arch_parser";
import { InsightGraphController } from "./insight_graph_controller";
import { InsightGraphRenderer } from "./insight_graph_renderer";

export const insightGraphView = {
    type: "insight_graph",
    display_name: "Insight Graph",
    icon: "fa fa-share-alt",
    multiRecord: true,
    Controller: InsightGraphController,
    Renderer: InsightGraphRenderer,
    ArchParser: InsightGraphArchParser,
    searchMenuTypes: ["filter", "favorite"],
};

registry.category("views").add("insight_graph", insightGraphView);
