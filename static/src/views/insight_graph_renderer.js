/** @odoo-module **/

import { Component, onMounted, onWillUnmount, useRef, useState } from "@odoo/owl";
/* global ResizeObserver */
import { NodeTooltip } from "../components/NodeTooltip/NodeTooltip";
import { NodeContextMenu } from "../components/NodeContextMenu/NodeContextMenu";

export class InsightGraphRenderer extends Component {
    static template = "insight_graph.InsightGraphRenderer";
    static components = { NodeTooltip, NodeContextMenu };
    static props = {
        graphData: { type: Object },
        primaryModel: { type: String },
        modelConfigs: { type: Object, optional: true },
        onOpenForm: { type: Function },
        onDeleteNode: { type: Function },
        onLinkNodes: { type: Function },
        onCreateAndLink: { type: Function },
    };

    setup() {
        this.container = useRef("cytoscapeContainer");
        this.graphBody = useRef("graphBody");
        this.cy = null;
        this._resizeObserver = null;
        this._dragCleanup = null;

        this.state = useState({
            tooltip: null,
            colorMap: { _default: { bgColor: "#e8f4fd", borderColor: "#4a9eda", textColor: "#1a5276" } },
            edgeColorMap: {},
            selectedNodeId: null,
            contextMenuPos: null,   // { x1, y1, w, h } rendered px, relative to graphBody
            linkingState: null,     // { linkDef, sourceNodeData, sourceX, sourceY, mouseX, mouseY, hoverNodeId }
        });

        onMounted(() => {
            this._fitBodyHeight();
            this._initCytoscape();
            this._resizeObserver = new ResizeObserver(() => {
                this._fitBodyHeight();
                this.cy?.resize();
                this.cy?.fit(undefined, 40);
                this._updateContextMenuPos();
            });
            this._resizeObserver.observe(this.graphBody.el.parentElement);
        });
        onWillUnmount(() => {
            this._dragCleanup?.();
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

    // ── Context menu info ────────────────────────────────────────────────────

    get contextMenuInfo() {
        if (!this.state.selectedNodeId || !this.state.contextMenuPos) return null;
        const node = this.props.graphData.nodes.find((n) => n.id === this.state.selectedNodeId);
        if (!node) return null;
        const linkDefs = this.props.modelConfigs?.[node.model]?.links || [];
        return { pos: this.state.contextMenuPos, nodeData: node, linkDefs };
    }

    // ── Context menu action handlers ────────────────────────────────────────

    onOpenFormSelected() {
        const info = this.contextMenuInfo;
        if (info) this.props.onOpenForm(info.nodeData);
    }

    onDeleteSelected() {
        const info = this.contextMenuInfo;
        if (info) this.props.onDeleteNode(info.nodeData);
    }

    onHideSelected() {
        const nodeId = this.state.selectedNodeId;
        if (!nodeId) return;
        this.cy?.getElementById(nodeId).addClass("ig-hidden");
        this._selectNode(null);
    }

    // ── Link drag ────────────────────────────────────────────────────────────

    onStartLink(e, linkDef) {
        e.preventDefault();
        const info = this.contextMenuInfo;
        if (!info) return;

        const rect = this.container.el.getBoundingClientRect();
        const sourceX = info.pos.x1 + info.pos.w / 2;
        const sourceY = info.pos.y1 + info.pos.h / 2;

        this.state.linkingState = {
            linkDef,
            sourceNodeData: info.nodeData,
            sourceX,
            sourceY,
            mouseX: e.clientX - rect.left,
            mouseY: e.clientY - rect.top,
            hoverNodeId: null,
        };
        this.cy?.userPanningEnabled(false);
        this.container.el.style.cursor = "crosshair";

        const onMouseMove = (moveEvent) => {
            if (!this.container.el) return;
            const r = this.container.el.getBoundingClientRect();
            const x = moveEvent.clientX - r.left;
            const y = moveEvent.clientY - r.top;

            // Detect compatible node under cursor
            const graphPos = this._renderedToGraph(x, y);
            let hoverNodeId = null;
            this.cy?.nodes(`:visible`).forEach((node) => {
                if (hoverNodeId) return;
                const bb = node.boundingBox();
                if (
                    graphPos.x >= bb.x1 && graphPos.x <= bb.x2 &&
                    graphPos.y >= bb.y1 && graphPos.y <= bb.y2 &&
                    node.data().model === linkDef.model
                ) {
                    hoverNodeId = node.id();
                }
            });

            this.cy?.nodes().removeClass("ig-link-target");
            if (hoverNodeId) this.cy?.getElementById(hoverNodeId).addClass("ig-link-target");

            if (this.state.linkingState) {
                this.state.linkingState.mouseX = x;
                this.state.linkingState.mouseY = y;
                this.state.linkingState.hoverNodeId = hoverNodeId;
            }
        };

        const onMouseUp = async (upEvent) => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            this._dragCleanup = null;

            this.cy?.userPanningEnabled(true);
            this.cy?.nodes().removeClass("ig-link-target");
            if (this.container.el) this.container.el.style.cursor = "";

            const ls = this.state.linkingState;
            this.state.linkingState = null;
            if (!ls) return;

            if (ls.hoverNodeId) {
                const targetNodeData = this.props.graphData.nodes.find((n) => n.id === ls.hoverNodeId);
                if (targetNodeData) {
                    await this.props.onLinkNodes(ls.sourceNodeData, targetNodeData, ls.linkDef);
                }
            } else if (this.container.el) {
                // Dropped on background — create new record and link
                const r = this.container.el.getBoundingClientRect();
                const overCanvas =
                    upEvent.clientX >= r.left && upEvent.clientX <= r.right &&
                    upEvent.clientY >= r.top && upEvent.clientY <= r.bottom;
                if (overCanvas) {
                    await this.props.onCreateAndLink(ls.sourceNodeData, ls.linkDef);
                }
            }
        };

        this._dragCleanup = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            this.cy?.userPanningEnabled(true);
            this.cy?.nodes().removeClass("ig-link-target");
            if (this.container.el) this.container.el.style.cursor = "";
            this.state.linkingState = null;
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    _selectNode(nodeId) {
        if (this.state.selectedNodeId) {
            this.cy?.getElementById(this.state.selectedNodeId).removeClass("ig-selected");
        }
        this.state.selectedNodeId = nodeId;
        if (nodeId) {
            this.cy?.getElementById(nodeId).addClass("ig-selected");
            this._updateContextMenuPos();
        } else {
            this.state.contextMenuPos = null;
        }
    }

    _updateContextMenuPos() {
        if (!this.state.selectedNodeId || !this.cy) return;
        const nodeEl = this.cy.getElementById(this.state.selectedNodeId);
        if (!nodeEl || nodeEl.empty()) return;
        const bb = nodeEl.renderedBoundingBox();
        this.state.contextMenuPos = {
            x1: bb.x1,
            y1: bb.y1,
            w: bb.x2 - bb.x1,
            h: bb.y2 - bb.y1,
        };
    }

    _renderedToGraph(rx, ry) {
        const pan = this.cy.pan();
        const zoom = this.cy.zoom();
        return { x: (rx - pan.x) / zoom, y: (ry - pan.y) / zoom };
    }

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

        // Node tap: select / deselect
        this.cy.on("tap", "node", (evt) => {
            const nodeId = evt.target.id();
            if (this.state.selectedNodeId === nodeId) {
                this._selectNode(null);
            } else {
                this._selectNode(nodeId);
            }
        });

        // Background tap: deselect
        this.cy.on("tap", (evt) => {
            if (evt.target === this.cy) {
                this._selectNode(null);
            }
        });

        // Hover tooltip — suppressed when a node is selected or drag is active
        this.cy.on("mouseover", "node", (evt) => {
            if (this.state.selectedNodeId || this.state.linkingState) return;
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
            if (!this.state.selectedNodeId) this.container.el.style.cursor = "";
            this.state.tooltip = null;
        });

        // Keep context menu aligned on pan/zoom
        this.cy.on("viewport", () => {
            this.state.tooltip = null;
            this._updateContextMenuPos();
        });
    }

    _buildStyle() {
        const primaryModel = this.props.primaryModel;
        return [
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
            {
                selector: `node[model = "${primaryModel}"]`,
                style: { "border-width": 3, "font-weight": "bold", "font-size": "12px" },
            },
            {
                selector: `node[model != "${primaryModel}"]`,
                style: { opacity: 0.8 },
            },
            { selector: 'node[shape = "roundrectangle"]', style: { shape: "roundrectangle" } },
            { selector: 'node[shape = "rectangle"]',      style: { shape: "rectangle" } },
            { selector: 'node[shape = "diamond"]',        style: { shape: "diamond", width: "150px", padding: "22px" } },
            { selector: 'node[shape = "ellipse"]',        style: { shape: "ellipse" } },
            // Selected node
            {
                selector: "node.ig-selected",
                style: {
                    "border-width": 3,
                    "border-color": "#2563eb",
                    "overlay-opacity": 0.12,
                    "overlay-color": "#2563eb",
                    "overlay-padding": 6,
                },
            },
            // Link drop target highlight
            {
                selector: "node.ig-link-target",
                style: {
                    "border-color": "#10b981",
                    "border-width": 3,
                    "overlay-opacity": 0.15,
                    "overlay-color": "#10b981",
                    "overlay-padding": 6,
                },
            },
            // Hidden nodes
            {
                selector: "node.ig-hidden",
                style: { display: "none" },
            },
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
