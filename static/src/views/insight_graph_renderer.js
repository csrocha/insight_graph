/** @odoo-module **/

// Persists the Cytoscape viewport across unmount/remount cycles (e.g. after an action refresh).
let _savedViewport = null;

import { Component, onMounted, onWillUnmount, useExternalListener, useRef, useState } from "@odoo/owl";
/* global ResizeObserver */
import { evaluateBooleanExpr } from "@web/core/py_js/py_utils";
import { NodeTooltip } from "../components/NodeTooltip/NodeTooltip";
import { NodeContextMenu } from "../components/NodeContextMenu/NodeContextMenu";

export class InsightGraphRenderer extends Component {
    static template = "insight_graph.InsightGraphRenderer";
    static components = { NodeTooltip, NodeContextMenu };
    static LAYOUTS = [
        { key: "dagre-lr",    label: "Izq → Der",   icon: "fa-long-arrow-right" },
        { key: "dagre-tb",    label: "Arr → Abj",   icon: "fa-long-arrow-down"  },
        { key: "circle",      label: "Circular",     icon: "fa-circle-o"         },
        { key: "concentric",  label: "Concéntrico",  icon: "fa-bullseye"         },
        { key: "breadthfirst", label: "Árbol",       icon: "fa-sitemap"          },
        { key: "grid",        label: "Grilla",       icon: "fa-th"               },
        { key: "cose",        label: "Fuerza",       icon: "fa-random"           },
    ];
    static props = {
        graphData: { type: Object },
        primaryModel: { type: String },
        modelConfigs: { type: Object, optional: true },
        onOpenForm: { type: Function },
        onDeleteNode: { type: Function },
        onLinkNodes: { type: Function },
        onCreateAndLink: { type: Function },
        onExecuteAction: { type: Function },
        onPinNode: { type: Function },
        onUnpinNode: { type: Function },
        onSelectionChange: { type: Function, optional: true },
        onRendererReady: { type: Function, optional: true },
    };

    setup() {
        this.container = useRef("cytoscapeContainer");
        this.graphBody = useRef("graphBody");
        this.htmlLayer = useRef("htmlLayer");
        this.cy = null;
        this._resizeObserver = null;
        this._dragCleanup = null;
        this._suppressSelectEvents = false;
        this._nodeDivs = {};  // nodeId → HTMLElement (template-mode nodes only)

        this.state = useState({
            tooltip: null,
            colorMap: { _default: { bgColor: "#e8f4fd", borderColor: "#4a9eda", textColor: "#1a5276" } },
            edgeColorMap: {},
            selectedNodeIds: {},    // nodeId → true/false
            pinnedNodeIds: {},      // nodeId → true  (loaded from localStorage on mount)
            contextMenuPos: null,   // { x1, y1, w, h } rendered px, relative to graphBody
            linkingState: null,     // { linkDef, sourceNodeData, sourceX, sourceY, mouseX, mouseY, hoverNodeId }
            hiddenNodes: {},        // nodeId → true  (persists within session until page reload)
            layoutKey: "dagre-lr",
            layoutMenuOpen: false,
        });

        useExternalListener(window, "click", () => {
            this.state.layoutMenuOpen = false;
        });

        onMounted(() => {
            this._fitBodyHeight();
            this._initCytoscape();
            if (_savedViewport) {
                this.cy.pan(_savedViewport.pan);
                this.cy.zoom(_savedViewport.zoom);
                _savedViewport = null;
            } else {
                this.cy.fit(undefined, 40);
            }
            this._syncPinsFromStorage();
            this.props.onRendererReady?.({
                centerOnNode: (id) => this._centerOnNode(id),
                getHiddenNodeIds: () => new Set(
                    Object.entries(this.state.hiddenNodes)
                        .filter(([, v]) => v)
                        .map(([id]) => id)
                ),
            });
            this._resizeObserver = new ResizeObserver(() => {
                this._fitBodyHeight();
                this.cy?.resize();
                this._updateContextMenuPos();
            });
            this._resizeObserver.observe(this.graphBody.el.parentElement);
        });
        onWillUnmount(() => {
            if (this.cy) {
                _savedViewport = { pan: this.cy.pan(), zoom: this.cy.zoom() };
            }
            this._dragCleanup?.();
            this._resizeObserver?.disconnect();
            if (this.cy) {
                this.cy.destroy();
                this.cy = null;
            }
        });
    }

    // ── Selection getters ────────────────────────────────────────────────────

    /** ID of the primary selected node (first in selectedNodeIds), or null. */
    get selectedNodeId() {
        return Object.keys(this.state.selectedNodeIds).find(
            (k) => this.state.selectedNodeIds[k]
        ) || null;
    }

    /** Number of currently selected nodes. */
    get selectionCount() {
        return Object.values(this.state.selectedNodeIds).filter(Boolean).length;
    }

    /**
     * Action buttons visible for the current selection.
     * Only shown when all selected nodes belong to the same model.
     * Invisible expressions are evaluated against the primary node's rawFields.
     */
    get visibleButtons() {
        const primaryId = this.selectedNodeId;
        if (!primaryId) return [];
        const primaryNode = this.props.graphData.nodes.find((n) => n.id === primaryId);
        if (!primaryNode) return [];

        // Hide buttons when nodes of different models are selected
        const allSelected = this.props.graphData.nodes.filter(
            (n) => this.state.selectedNodeIds[n.id]
        );
        if (allSelected.some((n) => n.model !== primaryNode.model)) return [];

        const modelButtons = this.props.modelConfigs?.[primaryNode.model]?.buttons || [];
        return modelButtons.filter((btn) => {
            if (!btn.invisible) return true;
            try {
                return !evaluateBooleanExpr(btn.invisible, primaryNode.rawFields || {});
            } catch {
                return true;
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

    /** Only non-null when exactly one node is selected (shows per-node overlay). */
    get contextMenuInfo() {
        if (this.selectionCount !== 1 || !this.state.contextMenuPos) return null;
        const node = this.props.graphData.nodes.find((n) => n.id === this.selectedNodeId);
        if (!node) return null;
        const rawLinks = this.props.modelConfigs?.[node.model]?.links || [];

        const linkDefs = [];
        for (const link of rawLinks) {
            const relatedIds = this._getRelatedNodeIds(node, link);
            const hiddenIds = relatedIds.filter((id) => this.state.hiddenNodes[id]);
            const visibleIds = relatedIds.filter((id) => !this.state.hiddenNodes[id]);

            const isSingleM2OVisible =
                relatedIds.length === 1 && visibleIds.length === 1 && hiddenIds.length === 0;

            console.debug(
                `[ig:ctx] field=${link.field} dir=${link.direction}` +
                ` related=[${relatedIds.join(",")}]` +
                ` hidden=[${hiddenIds.join(",")}]` +
                ` visible=[${visibleIds.join(",")}]` +
                ` ${(link.direction === "upstream" && isSingleM2OVisible) ? "SKIP" : `show isCollapsed=${hiddenIds.length > 0}`}`
            );

            if (link.direction === "upstream" && isSingleM2OVisible) continue;
            linkDefs.push({ ...link, isCollapsed: hiddenIds.length > 0 });
        }

        return { pos: this.state.contextMenuPos, nodeData: node, linkDefs };
    }

    // ── Selection bar action handlers ────────────────────────────────────────

    /**
     * Executes the given button action on all selected nodes of the primary model.
     */
    onExecuteActionSelected(buttonDef) {
        const primaryId = this.selectedNodeId;
        if (!primaryId) return;
        const primaryNode = this.props.graphData.nodes.find((n) => n.id === primaryId);
        if (!primaryNode) return;
        const resIds = this.props.graphData.nodes
            .filter((n) => this.state.selectedNodeIds[n.id] && n.model === primaryNode.model)
            .map((n) => n.resId);
        this.props.onExecuteAction(primaryNode.model, resIds, buttonDef);
    }

    onClearSelection() {
        this._selectOnly(null);
    }

    /**
     * Applies visual pin state to Cytoscape nodes based on the `isPinned` flag
     * set by the controller (which injects/marks pins after BFS).
     * Called on every mount so injected pins are always highlighted on load.
     */
    _syncPinsFromStorage() {
        for (const node of this.props.graphData.nodes) {
            if (node.isPinned) {
                this.state.pinnedNodeIds[node.id] = true;
                this.cy?.getElementById(node.id).addClass("ig-pinned");
                this._nodeDivs[node.id]?.classList.add("o_ig_node_pinned");
            }
        }
    }

    // ── Relation circle handlers ──────────────────────────────────────────────

    onClickLink(linkDef) {
        const info = this.contextMenuInfo;
        if (!info || !linkDef.isCollapsed) return;
        this._revealHiddenNodes(info.nodeData, linkDef, null);
    }

    onStartLink(e, linkDef) {
        e.preventDefault();
        const info = this.contextMenuInfo;
        if (!info) return;

        const sourceNodeData = info.nodeData;
        const collapsed = linkDef.isCollapsed;

        const rect = this.container.el.getBoundingClientRect();
        const sourceX = info.pos.x1 + info.pos.w / 2;
        const sourceY = info.pos.y1 + info.pos.h / 2;

        this.state.linkingState = {
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

            if (!collapsed) {
                const graphPos = this._renderedToGraph(x, y);
                let hoverNodeId = null;
                this.cy?.nodes(":visible").forEach((node) => {
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
                if (this.state.linkingState) this.state.linkingState.hoverNodeId = hoverNodeId;
            }

            if (this.state.linkingState) {
                this.state.linkingState.mouseX = x;
                this.state.linkingState.mouseY = y;
            }
        };

        const onMouseUp = async (upEvent) => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            this._dragCleanup = null;

            this.cy?.userPanningEnabled(true);
            this.cy?.nodes().removeClass("ig-link-target");
            if (this.container.el) this.container.el.style.cursor = "";

            const mouseX = this.state.linkingState?.mouseX ?? 0;
            const mouseY = this.state.linkingState?.mouseY ?? 0;
            const hoverNodeId = this.state.linkingState?.hoverNodeId ?? null;
            this.state.linkingState = null;

            const r = this.container.el?.getBoundingClientRect();
            const overCanvas = r &&
                upEvent.clientX >= r.left && upEvent.clientX <= r.right &&
                upEvent.clientY >= r.top && upEvent.clientY <= r.bottom;
            if (!overCanvas) return;

            const dropGraphPos = this._renderedToGraph(mouseX, mouseY);

            if (collapsed) {
                this._revealHiddenNodes(sourceNodeData, linkDef, dropGraphPos);
            } else if (hoverNodeId) {
                const targetNodeData = this.props.graphData.nodes.find((n) => n.id === hoverNodeId);
                if (targetNodeData) {
                    await this.props.onLinkNodes(sourceNodeData, targetNodeData, linkDef);
                }
            } else {
                await this.props.onCreateAndLink(sourceNodeData, linkDef);
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

    // ── Hidden node helpers ───────────────────────────────────────────────────

    _getRelatedNodeIds(nodeData, linkDef) {
        const { edges, nodes } = this.props.graphData;
        const targetIds = new Set(
            nodes.filter((n) => n.model === linkDef.model).map((n) => n.id)
        );
        const related = [];
        for (const edge of edges) {
            if (linkDef.direction === "downstream" && edge.source === nodeData.id && targetIds.has(edge.target)) {
                related.push(edge.target);
            } else if (linkDef.direction === "upstream" && edge.target === nodeData.id && targetIds.has(edge.source)) {
                related.push(edge.source);
            }
        }
        return related;
    }

    _revealHiddenNodes(nodeData, linkDef, graphPos) {
        const relatedIds = this._getRelatedNodeIds(nodeData, linkDef);
        const hiddenIds = relatedIds.filter((id) => this.state.hiddenNodes[id]);
        if (!hiddenIds.length) return;

        hiddenIds.forEach((id, index) => {
            const cyNode = this.cy?.getElementById(id);
            if (!cyNode || cyNode.empty()) return;

            let pos;
            if (graphPos) {
                pos = { x: graphPos.x + index * 30, y: graphPos.y + index * 30 };
            } else {
                const selNode = this.cy?.getElementById(nodeData.id);
                const selPos = selNode?.position() || { x: 0, y: 0 };
                const xOffset = linkDef.direction === "upstream" ? -220 : 220;
                const yOffset = (index - (hiddenIds.length - 1) / 2) * 90;
                pos = { x: selPos.x + xOffset, y: selPos.y + yOffset };
            }

            cyNode.position(pos);
            cyNode.removeClass("ig-hidden");
            this.state.hiddenNodes[id] = false;
        });
    }

    // ── Selection management ─────────────────────────────────────────────────

    _notifySelectionChange() {
        const selectedNodes = this.props.graphData.nodes
            .filter((n) => this.state.selectedNodeIds[n.id])
            .map((n) => ({ model: n.model, resId: n.resId, id: n.id, label: n.label }));

        this.props.onSelectionChange?.(
            this.selectionCount,
            this.visibleButtons,
            selectedNodes,
            () => this._selectOnly(null),
            (btn) => this.onExecuteActionSelected(btn),
            () => {
                for (const { id } of selectedNodes) {
                    this.cy?.getElementById(id).addClass("ig-hidden");
                    this.state.hiddenNodes[id] = true;
                }
                this._selectOnly(null);
            },
        );
    }

    /**
     * Clears all selection and selects only nodeId (or clears all if null).
     * Keeps Cytoscape's internal selection state in sync.
     */
    _selectOnly(nodeId) {
        this._suppressSelectEvents = true;
        this.cy?.elements().unselect();
        this._suppressSelectEvents = false;

        // Clear HTML selection on all previously selected nodes
        for (const [id, selected] of Object.entries(this.state.selectedNodeIds)) {
            if (selected) this._nodeDivs[id]?.classList.remove("o_ig_node_selected");
        }

        this.state.selectedNodeIds = {};
        this.state.contextMenuPos = null;

        if (nodeId) {
            this._suppressSelectEvents = true;
            this.cy?.getElementById(nodeId).select();
            this._suppressSelectEvents = false;
            this.state.selectedNodeIds[nodeId] = true;
            this._nodeDivs[nodeId]?.classList.add("o_ig_node_selected");
            const nodeData = this.props.graphData.nodes.find((n) => n.id === nodeId);
            console.debug(`[ig:select] nodeId=${nodeId} label="${nodeData?.label}" model=${nodeData?.model}`);
            this._updateContextMenuPos();
        } else {
            console.debug("[ig:select] deselected");
        }
        this._notifySelectionChange();
    }

    /**
     * Toggles nodeId in/out of the multi-selection.
     */
    _toggleSelect(nodeId) {
        this._suppressSelectEvents = true;
        if (this.state.selectedNodeIds[nodeId]) {
            this.cy?.getElementById(nodeId).unselect();
            this.state.selectedNodeIds[nodeId] = false;
            this._nodeDivs[nodeId]?.classList.remove("o_ig_node_selected");
        } else {
            this.cy?.getElementById(nodeId).select();
            this.state.selectedNodeIds[nodeId] = true;
            this._nodeDivs[nodeId]?.classList.add("o_ig_node_selected");
        }
        this._suppressSelectEvents = false;

        if (!this.selectedNodeId) {
            this.state.contextMenuPos = null;
        } else {
            this._updateContextMenuPos();
        }
    }

    _updateContextMenuPos() {
        const nodeId = this.selectedNodeId;
        if (!nodeId || !this.cy) return;
        const nodeEl = this.cy.getElementById(nodeId);
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
                fit: false,
            },
            wheelSensitivity: 1,
            minZoom: 0.1,
            maxZoom: 3,
            boxSelectionEnabled: true,  // shift+drag to multi-select
        });

        // Re-apply hidden state from previous session
        for (const [nodeId, isHidden] of Object.entries(this.state.hiddenNodes)) {
            if (isHidden) this.cy.getElementById(nodeId).addClass("ig-hidden");
        }

        // Single-click: select only this node.
        // Shift+click: Cytoscape handles additive selection natively; select/unselect
        // listeners below keep our state in sync.
        this.cy.on("tap", "node", (evt) => {
            if (evt.originalEvent?.shiftKey) return;
            this._selectOnly(evt.target.id());
        });

        // Background tap: deselect all
        this.cy.on("tap", (evt) => {
            if (evt.target === this.cy) {
                this._selectOnly(null);
            }
        });

        // Double-click: open form (replaces the form icon button)
        this.cy.on("dbltap", "node", (evt) => {
            const nodeId = evt.target.id();
            const nodeData = this.props.graphData.nodes.find((n) => n.id === nodeId);
            if (nodeData) this.props.onOpenForm(nodeData);
        });

        // Box selection (shift+drag) and shift+click: sync Cytoscape's native selection to our state
        this.cy.on("select", "node", (evt) => {
            if (this._suppressSelectEvents) return;
            const id = evt.target.id();
            this.state.selectedNodeIds[id] = true;
            this._updateContextMenuPos();
            this._notifySelectionChange();
        });

        this.cy.on("unselect", "node", (evt) => {
            if (this._suppressSelectEvents) return;
            const id = evt.target.id();
            this.state.selectedNodeIds[id] = false;
            if (!this.selectedNodeId) {
                this.state.contextMenuPos = null;
            } else {
                this._updateContextMenuPos();
            }
            this._notifySelectionChange();
        });

        // Hover tooltip — suppressed when any node is selected or drag is active
        this.cy.on("mouseover", "node", (evt) => {
            if (this.selectedNodeId || this.state.linkingState) return;
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
                flowState: data.flowState || undefined,
                fields: data.tooltipFields,
            };
        });

        this.cy.on("mouseout", "node", () => {
            if (!this.selectedNodeId) this.container.el.style.cursor = "";
            this.state.tooltip = null;
        });

        // Keep context menu aligned on pan/zoom; sync HTML overlay
        this.cy.on("viewport", () => {
            this._syncHtmlLayerViewport();
            this.state.tooltip = null;
            this._updateContextMenuPos();
        });

        // After a node drag: move its HTML card to the new position
        this.cy.on("dragfree", "node", (evt) => {
            this._syncNodeHtmlPos(evt.target.id(), evt.target.position());
        });

        // After any layout completes: rebuild overlay cards at new positions
        this.cy.on("layoutstop", () => {
            this._initHtmlOverlay();
        });

        // The initial layout runs synchronously during cytoscape() construction,
        // so layoutstop already fired before our listener was registered above.
        // Call _initHtmlOverlay() explicitly here for the first render.
        this._initHtmlOverlay();
    }

    // ── HTML overlay node layer ──────────────────────────────────────────────

    _initHtmlOverlay() {
        const layer = this.htmlLayer?.el;
        if (!layer || !this.cy) return;
        this._nodeDivs = {};
        layer.innerHTML = "";

        for (const node of this.props.graphData.nodes) {
            const config = this.props.modelConfigs?.[node.model];
            if (!config?.nodeTemplate) continue;

            const cyNode = this.cy.getElementById(node.id);
            if (!cyNode || cyNode.empty()) continue;

            const pos = cyNode.position();
            const W = node.nodeWidth || 180;
            const H = node.nodeHeight || 120;

            const div = document.createElement("div");
            div.className = "o_ig_node_html";
            if (node.isPinned) div.classList.add("o_ig_node_pinned");
            if (this.state.selectedNodeIds[node.id]) div.classList.add("o_ig_node_selected");
            div.style.cssText = `left:${pos.x - W / 2}px;top:${pos.y - H / 2}px;width:${W}px;height:${H}px`;
            div.innerHTML = this._renderNodeTemplate(node, config);

            layer.appendChild(div);
            this._nodeDivs[node.id] = div;
        }
        this._syncHtmlLayerViewport();
    }

    _syncHtmlLayerViewport() {
        const layer = this.htmlLayer?.el;
        if (!layer || !this.cy) return;
        const { x, y } = this.cy.pan();
        const z = this.cy.zoom();
        layer.style.transform = `translate(${x}px,${y}px) scale(${z})`;
    }

    _syncNodeHtmlPos(nodeId, pos) {
        const div = this._nodeDivs[nodeId];
        if (!div) return;
        const node = this.props.graphData.nodes.find((n) => n.id === nodeId);
        const W = node?.nodeWidth || 180;
        const H = node?.nodeHeight || 120;
        div.style.left = `${pos.x - W / 2}px`;
        div.style.top = `${pos.y - H / 2}px`;
    }

    _refreshAllNodeHtmlPos() {
        for (const nodeId of Object.keys(this._nodeDivs)) {
            const cyNode = this.cy?.getElementById(nodeId);
            if (!cyNode || cyNode.empty()) continue;
            this._syncNodeHtmlPos(nodeId, cyNode.position());
        }
    }

    _renderNodeTemplate(node, config) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${config.nodeTemplate}</div>`, "text/html");
        const root = doc.body.firstChild;

        for (const span of [...root.querySelectorAll("[data-ig-field]")]) {
            const fname = span.getAttribute("data-ig-field");
            span.textContent = node.displayFields?.[fname] || "";
            span.removeAttribute("data-ig-field");
        }
        for (const span of [...root.querySelectorAll("[data-ig-image]")]) {
            const fname = span.getAttribute("data-ig-image");
            const dataUrl = node.displayFields?.[fname];
            if (dataUrl) {
                const img = document.createElement("img");
                img.src = dataUrl;
                const cls = span.getAttribute("data-ig-img-class");
                const sty = span.getAttribute("data-ig-img-style");
                if (cls) img.className = cls;
                if (sty) img.style.cssText = sty;
                span.parentNode.replaceChild(img, span);
            } else {
                span.remove();
            }
        }
        return root.innerHTML;
    }

    _buildStyle() {
        const primaryModel = this.props.primaryModel;
        return [
            {
                selector: "node",
                style: {
                    label: "data(label)",
                    "text-wrap": "ellipsis",
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
                    "transition-property": "border-color, border-width, overlay-opacity, overlay-color, background-color, opacity",
                    "transition-duration": "150ms",
                    "transition-timing-function": "ease",
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
            { selector: 'node[shape = "diamond"]',        style: { shape: "diamond", width: "140px", height: "140px", padding: "22px" } },
            { selector: 'node[shape = "ellipse"]',        style: { shape: "ellipse" } },
            { selector: 'node[shape = "octagon"]',        style: { shape: "octagon", width: "130px", height: "130px" } },
            // Selected node (uses Cytoscape's :selected pseudo-class)
            {
                selector: "node:selected",
                style: {
                    "border-width": 3,
                    "border-color": "#2563eb",
                    "overlay-opacity": 0.12,
                    "overlay-color": "#2563eb",
                    "overlay-padding": 6,
                },
            },
            // Pinned node — amber border on unselected state
            {
                selector: "node.ig-pinned:unselected",
                style: {
                    "border-color": "#f59e0b",
                    "border-width": 4,
                    "overlay-opacity": 0.06,
                    "overlay-color": "#f59e0b",
                    "overlay-padding": 4,
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
            // Template-mode nodes: transparent fill + no label; HTML overlay handles visuals
            {
                selector: "node[htmlNode]",
                style: {
                    width: "data(nodeWidth)",
                    height: "data(nodeHeight)",
                    "background-opacity": 0,
                    "text-opacity": 0,
                    "border-opacity": 0,
                },
            },
            {
                selector: "node[htmlNode]:selected",
                style: {
                    "border-opacity": 0,
                    "overlay-opacity": 0,
                },
            },
            // Image nodes — show image at top, label at bottom
            {
                selector: "node[imageDataUrl]",
                style: {
                    "background-image": "data(imageDataUrl)",
                    "background-fit": "none",
                    "background-clip": "node",
                    "background-width": "48px",
                    "background-height": "48px",
                    "background-position-x": "50%",
                    "background-position-y": "6px",
                    "background-image-opacity": 1,
                    height: "82px",
                    "text-valign": "bottom",
                    "text-margin-y": -6,
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
                    "transition-property": "opacity, line-color",
                    "transition-duration": "150ms",
                    "transition-timing-function": "ease",
                },
            },
        ];
    }

    // ── Layout controls ──────────────────────────────────────────────────────

    get currentLayout() {
        return InsightGraphRenderer.LAYOUTS.find((l) => l.key === this.state.layoutKey)
            || InsightGraphRenderer.LAYOUTS[0];
    }

    onToggleLayoutMenu(e) {
        e.stopPropagation();
        this.state.layoutMenuOpen = !this.state.layoutMenuOpen;
    }

    onSelectLayout(e, key) {
        e.stopPropagation();
        this.state.layoutKey = key;
        this.state.layoutMenuOpen = false;
        this._applyLayout(key);
    }

    _applyLayout(key) {
        if (!this.cy) return;
        const visibleEles = this.cy.elements(":visible");
        const base = { animate: true, animationDuration: 350, animationEasing: "ease-in-out-cubic", padding: 40, eles: visibleEles };
        let opts;
        switch (key) {
            case "dagre-lr":
                opts = { name: "dagre", rankDir: "LR", nodeSep: 50, rankSep: 100 };
                break;
            case "dagre-tb":
                opts = { name: "dagre", rankDir: "TB", nodeSep: 50, rankSep: 80 };
                break;
            case "circle":
                opts = { name: "circle" };
                break;
            case "concentric":
                opts = { name: "concentric", levelWidth: () => 1, minNodeSpacing: 60 };
                break;
            case "breadthfirst":
                opts = { name: "breadthfirst", directed: true, spacingFactor: 1.4 };
                break;
            case "grid":
                opts = { name: "grid", avoidOverlap: true, spacingFactor: 1.2 };
                break;
            case "cose":
                opts = { name: "cose", nodeRepulsion: () => 8000, idealEdgeLength: () => 120 };
                break;
            default:
                opts = { name: "dagre", rankDir: "LR", nodeSep: 50, rankSep: 100 };
        }
        this.cy.layout({ ...base, ...opts }).run();
    }

    onZoomToSelected() {
        const nodeId = this.selectedNodeId;
        if (!nodeId || !this.cy) return;
        const node = this.cy.getElementById(nodeId);
        if (!node || node.empty()) return;
        this.cy.animate({ fit: { eles: node, padding: 120 }, duration: 350, easing: "ease-in-out-cubic" });
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

    _centerOnNode(nodeId) {
        if (!this.cy) return;
        const node = this.cy.getElementById(nodeId);
        if (!node || node.empty()) return;
        const pos = node.position();
        const zoom = this.cy.zoom();
        this.cy.animate({
            pan: {
                x: this.cy.width() / 2 - pos.x * zoom,
                y: this.cy.height() / 2 - pos.y * zoom,
            },
            duration: 350,
            easing: "ease-in-out-cubic",
        });
    }

    _center() {
        const el = this.container.el;
        return { x: el.offsetWidth / 2, y: el.offsetHeight / 2 };
    }
}
