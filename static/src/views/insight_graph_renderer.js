/** @odoo-module **/

import { Component, onMounted, onWillUnmount, useRef, useState } from "@odoo/owl";
/* global ResizeObserver */
import { NodeTooltip } from "../components/NodeTooltip/NodeTooltip";

export class InsightGraphRenderer extends Component {
    static template = "insight_graph.InsightGraphRenderer";
    static components = { NodeTooltip };
    static props = {
        graphData: { type: Object },      // { nodes: [], edges: [], nodeLegend: [], edgeLegend: [] }
        primaryModel: { type: String },   // model name of primary records
        onNodeClick: { type: Function },
    };

    setup() {
        this.container = useRef("cytoscapeContainer");
        this.graphBody = useRef("graphBody");
        this.cy = null;
        this._resizeObserver = null;

        this.state = useState({
            tooltip: null,
            colorMap: { _default: { bgColor: "#e8f4fd", borderColor: "#4a9eda", textColor: "#1a5276" } },
            edgeColorMap: {},
        });

        onMounted(() => {
            this._fitBodyHeight();
            this._initCytoscape();
            this._resizeObserver = new ResizeObserver(() => {
                this._fitBodyHeight();
                this.cy?.resize();
                this.cy?.fit(undefined, 40);
            });
            this._resizeObserver.observe(this.graphBody.el.parentElement);
        });
        onWillUnmount(() => {
            this._resizeObserver?.disconnect();
            if (this.cy) {
                this.cy.destroy();
                this.cy = null;
            }
        });
    }

    // ── Legend getters ───────────────────────────────────────────────────────

    get colorLegend() {
        const { nodes } = this.props.graphData;
        const states = [...new Set(nodes.map((n) => n.flowState).filter(Boolean))];
        return states.map((state) => ({
            state,
            ...(this.state.colorMap[state] || this.state.colorMap._default),
        }));
    }

    get nodeLegend() {
        return this.props.graphData.nodeLegend || [];
    }

    get edgeLegend() {
        return this.props.graphData.edgeLegend || [];
    }

    get defaultNodeColors() {
        return this.state.colorMap._default;
    }

    modelShortName(model) {
        return model.split(".").pop();
    }

    edgeLegendLabel(rel) {
        const src = `${this.modelShortName(rel.sourceModel)}.${rel.sourceField}`;
        const tgt = rel.targetField
            ? `${this.modelShortName(rel.targetModel)}.${rel.targetField}`
            : this.modelShortName(rel.targetModel);
        return `${src} → ${tgt}`;
    }

    edgeLegendColor(rel) {
        const key = `${rel.sourceModel}::${rel.sourceField}`;
        return this.state.edgeColorMap[key] || "#adb5bd";
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    _fitBodyHeight() {
        const el = this.graphBody.el;
        const top = el.getBoundingClientRect().top;
        el.style.height = Math.max(200, window.innerHeight - top) + "px";
    }

    _resolveEdgeColors(edges) {
        const style = getComputedStyle(this.container.el);
        const readVar = (name) => style.getPropertyValue(name).trim();
        const DEFAULT_COLOR = "#adb5bd";
        const cache = {};
        for (const edge of edges) {
            const { relationModel, relationField } = edge;
            if (!relationModel || !relationField) continue;
            const key = `${relationModel}::${relationField}`;
            if (!(key in cache)) {
                const varName = `--o-insight-relation-${relationModel.replace(/\./g, "-")}-${relationField}`;
                cache[key] = readVar(varName) || DEFAULT_COLOR;
            }
        }
        return cache;
    }

    _resolveStateColors(nodes) {
        const style = getComputedStyle(this.container.el);
        const readVar = (name) => style.getPropertyValue(name).trim();
        const DEFAULT = {
            bgColor:     readVar("--o-insight-state-default-bg")     || "#e8f4fd",
            borderColor: readVar("--o-insight-state-default-border") || "#4a9eda",
            textColor:   readVar("--o-insight-state-default-text")   || "#1a5276",
        };
        const cache = {};
        const states = [...new Set(nodes.map((n) => n.flowState).filter(Boolean))];
        for (const state of states) {
            const bg = readVar(`--o-insight-state-${state}-bg`);
            cache[state] = {
                bgColor:     bg || DEFAULT.bgColor,
                borderColor: readVar(`--o-insight-state-${state}-border`) || DEFAULT.borderColor,
                textColor:   readVar(`--o-insight-state-${state}-text`)   || DEFAULT.textColor,
            };
        }
        return { ...cache, _default: DEFAULT };
    }

    _initCytoscape() {
        const { nodes, edges } = this.props.graphData;
        const colorCache = this._resolveStateColors(nodes);
        this.state.colorMap = colorCache;
        const edgeColorCache = this._resolveEdgeColors(edges);
        this.state.edgeColorMap = edgeColorCache;

        const elements = [
            ...nodes.map((n) => ({
                data: { ...n, ...colorCache[n.flowState || "_default"] },
            })),
            ...edges.map((e) => {
                const colorKey = e.relationModel && e.relationField
                    ? `${e.relationModel}::${e.relationField}`
                    : null;
                const lineColor = (colorKey && edgeColorCache[colorKey]) || "#adb5bd";
                return { data: { source: e.source, target: e.target, lineColor } };
            }),
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
            wheelSensitivity: 1,
            minZoom: 0.1,
            maxZoom: 3,
        });

        this.cy.on("tap", "node", (evt) => {
            this.props.onNodeClick(evt.target.data());
        });

        this.cy.on("mouseover", "node", (evt) => {
            this.container.el.style.cursor = "pointer";
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
            this.container.el.style.cursor = "";
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
            // ── Base node — auto-height from label to prevent text overflow ──
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
                    height: "label",
                    padding: "10px",
                    "border-width": 2,
                    "background-color": "data(bgColor)",
                    "border-color": "data(borderColor)",
                    color: "data(textColor)",
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
            { selector: 'node[shape = "diamond"]',        style: { shape: "diamond", width: "150px", padding: "22px" } },
            { selector: 'node[shape = "ellipse"]',        style: { shape: "ellipse" } },
            // ── Edges — color driven by --o-insight-relation-{model}-{field} CSS var ──
            {
                selector: "edge",
                style: {
                    width: 2,
                    "line-color": "data(lineColor)",
                    "target-arrow-color": "data(lineColor)",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    opacity: 0.8,
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
