/** @odoo-module **/

import { Component, onMounted, onWillUnmount, useRef, useState } from "@odoo/owl";
import { NodeTooltip } from "../components/NodeTooltip/NodeTooltip";

// flow_state → Cytoscape colors
const FLOW_COLORS = {
    complete:   { bg: "#d4edda", border: "#28a745", text: "#155724" },
    incomplete: { bg: "#fff3cd", border: "#ffc107", text: "#856404" },
    inactive:   { bg: "#e2e3e5", border: "#6c757d", text: "#383d41" },
    error:      { bg: "#f8d7da", border: "#dc3545", text: "#721c24" },
    _default:   { bg: "#e8f4fd", border: "#4a9eda", text: "#1a5276" },
};

function flowColors(flowState) {
    return FLOW_COLORS[flowState] || FLOW_COLORS._default;
}

export class InsightGraphRenderer extends Component {
    static template = "insight_graph.InsightGraphRenderer";
    static components = { NodeTooltip };
    static props = {
        graphData: { type: Object },      // { nodes: [], edges: [] }
        primaryModel: { type: String },   // model name of primary records
        onNodeClick: { type: Function },
    };

    setup() {
        this.container = useRef("cytoscapeContainer");
        this.cy = null;

        this.state = useState({ tooltip: null });

        onMounted(() => this._initCytoscape());
        onWillUnmount(() => {
            if (this.cy) {
                this.cy.destroy();
                this.cy = null;
            }
        });
    }

    _initCytoscape() {
        const { nodes, edges } = this.props.graphData;

        const elements = [
            ...nodes.map((n) => ({ data: { ...n } })),
            ...edges.map((e) => ({ data: { source: e.source, target: e.target } })),
        ];

        /* global cytoscape */
        this.cy = cytoscape({
            container: this.container.el,
            elements,
            style: this._buildStyle(),
            layout: {
                name: "dagre",
                rankDir: "LR",
                nodeSep: 50,
                rankSep: 100,
                padding: 40,
                animate: false,
            },
            wheelSensitivity: 0.3,
            minZoom: 0.1,
            maxZoom: 3,
        });

        this.cy.on("tap", "node", (evt) => {
            this.props.onNodeClick(evt.target.data());
        });

        this.cy.on("mouseover", "node", (evt) => {
            const node = evt.target;
            const pos = node.renderedPosition();
            const data = node.data();
            if (!data.tooltipFields?.length) return;
            this.state.tooltip = {
                x: pos.x + 12,
                y: pos.y - 10,
                label: data.label,
                model: data.model,
                flowState: data.flowState,
                fields: data.tooltipFields,
            };
        });

        this.cy.on("mouseout", "node", () => {
            this.state.tooltip = null;
        });

        // Hide tooltip on pan/zoom
        this.cy.on("viewport", () => {
            this.state.tooltip = null;
        });
    }

    _buildStyle() {
        const primaryModel = this.props.primaryModel;
        return [
            // ── Base node ──────────────────────────────────────────
            {
                selector: "node",
                style: {
                    label: "data(label)",
                    "text-wrap": "wrap",
                    "text-max-width": "110px",
                    "font-size": "11px",
                    "text-valign": "center",
                    "text-halign": "center",
                    width: "130px",
                    height: "44px",
                    cursor: "pointer",
                    "border-width": 2,
                    "background-color": FLOW_COLORS._default.bg,
                    "border-color": FLOW_COLORS._default.border,
                    color: FLOW_COLORS._default.text,
                },
            },
            // ── Primary node: bolder border ────────────────────────
            {
                selector: `node[model = "${primaryModel}"]`,
                style: {
                    "border-width": 3,
                    "font-weight": "bold",
                    "font-size": "12px",
                },
            },
            // ── Secondary (non-primary) nodes: lighter ─────────────
            {
                selector: `node[model != "${primaryModel}"]`,
                style: { opacity: 0.8 },
            },
            // ── Shapes ─────────────────────────────────────────────
            { selector: 'node[shape = "roundrectangle"]', style: { shape: "roundrectangle" } },
            { selector: 'node[shape = "rectangle"]',      style: { shape: "rectangle" } },
            { selector: 'node[shape = "diamond"]',        style: { shape: "diamond", width: "150px", height: "60px" } },
            { selector: 'node[shape = "ellipse"]',        style: { shape: "ellipse" } },
            // ── Flow state colors ──────────────────────────────────
            ...Object.entries(FLOW_COLORS)
                .filter(([k]) => k !== "_default")
                .map(([state, c]) => ({
                    selector: `node[flowState = "${state}"]`,
                    style: { "background-color": c.bg, "border-color": c.border, color: c.text },
                })),
            // ── Edges ──────────────────────────────────────────────
            {
                selector: "edge",
                style: {
                    width: 1.5,
                    "line-color": "#adb5bd",
                    "target-arrow-color": "#adb5bd",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    opacity: 0.7,
                },
            },
        ];
    }

    onZoomIn() {
        this.cy?.zoom({ level: this.cy.zoom() * 1.25, renderedPosition: this._center() });
    }
    onZoomOut() {
        this.cy?.zoom({ level: this.cy.zoom() * 0.8, renderedPosition: this._center() });
    }
    onFit() {
        this.cy?.fit(undefined, 40);
    }

    _center() {
        const el = this.container.el;
        return { x: el.offsetWidth / 2, y: el.offsetHeight / 2 };
    }
}
