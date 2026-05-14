/** @odoo-module **/

import { Component, onWillStart, onWillUpdateProps, useState, useSubEnv } from "@odoo/owl";
import { evaluateBooleanExpr } from "@web/core/py_js/py_utils";
import { useService } from "@web/core/utils/hooks";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { Layout } from "@web/search/layout";
import { SearchBar } from "@web/search/search_bar/search_bar";
import { useSearchBarToggler } from "@web/search/search_bar/search_bar_toggler";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";
import { useDebugCategory } from "@web/core/debug/debug_context";
import { InsightGraphArchParser } from "./insight_graph_arch_parser";
import { InsightGraphRenderer } from "./insight_graph_renderer";
import { getPins, pinNode, unpinNode } from "../utils/insight_graph_pins";
import { formatMonetary } from "@web/views/fields/formatters";

export class InsightGraphController extends Component {
    static template = "insight_graph.InsightGraphController";
    static components = { InsightGraphRenderer, Layout, SearchBar, Dropdown, DropdownItem };
    static props = {
        resModel: { type: String },
        domain: { type: Array, optional: true },
        archInfo: { type: Object, optional: true },
        context: { type: Object, optional: true },
        fields: { type: Object, optional: true },
        useSampleData: { type: Boolean, optional: true },
        useSampleModel: { type: Boolean, optional: true },
        noBreadcrumbs: { type: Boolean, optional: true },
        display: { type: Object, optional: true },
        className: { type: String, optional: true },
        groupBy: { type: Array, optional: true },
        orderBy: { type: Array, optional: true },
        searchMenuTypes: { type: Array, optional: true },
        globalState: { type: Object, optional: true },
        irFilters: { type: Array, optional: true },
        allowedGroupBys: { type: Object, optional: true },
        info: { type: Object, optional: true },
        arch: { type: Object, optional: true },
        relatedModels: { type: Object, optional: true },
        selectRecord: { type: Function, optional: true },
        createRecord: { type: Function, optional: true },
        limit: { type: Number, optional: true },
        comparison: { optional: true },
    };

    setup() {
        this.orm = useService("orm");
        this.actionService = useService("action");
        this.dialogService = useService("dialog");
        this.searchBarToggler = useSearchBarToggler();
        useDebugCategory("view", { component: this });

        this.state = useState({
            loading: true,
            error: null,
            graphData: null,
            modelConfigs: {},
            selectionInfo: null,  // { count, buttons, selectedNodes } — populated by renderer
        });
        // Non-reactive: function refs provided by renderer on each selection change.
        this._selectionClear = null;
        this._selectionAction = null;
        this._selectionHide = null;
        this._rendererActions = null;  // { centerOnNode: (nodeId) => void }

        // Provide reactive state and centering callback to descendant components
        // (PinnedNodesMenu lives inside SearchBar which is a descendant via slots).
        useSubEnv({
            igControllerState: this.state,
            igCenterOnNode: (nodeId) => this._rendererActions?.centerOnNode(nodeId),
        });

        onWillStart(() => this._loadGraphData());
        onWillUpdateProps((nextProps) => {
            if (JSON.stringify(nextProps.domain) !== JSON.stringify(this.props.domain)) {
                this._loadGraphData(nextProps.domain);
            }
        });
    }

    async _loadGraphData(domain) {
        this.state.loading = true;
        this.state.error = null;
        try {
            const allViews = await this.orm.searchRead(
                "ir.ui.view",
                [["type", "=", "insight_graph"], ["active", "=", true]],
                ["model", "arch"],
                { limit: 200 }
            );

            const parser = new InsightGraphArchParser();
            const modelConfigs = {};
            for (const { model, arch } of allViews) {
                const doc = new DOMParser().parseFromString(arch, "text/xml");
                modelConfigs[model] = parser.parse(doc.documentElement);
            }

            // Fetch human-readable field labels for all link fields (parallel RPCs)
            await Promise.all(
                Object.entries(modelConfigs).map(async ([model, config]) => {
                    if (!config?.links?.length) return;
                    const fieldNames = [...new Set(config.links.map((l) => l.field))];
                    const fieldsInfo = await this.orm.call(
                        model, "fields_get", [fieldNames], { attributes: ["string"] }
                    );
                    for (const link of config.links) {
                        link.fieldString = fieldsInfo[link.field]?.string || link.field;
                    }
                })
            );

            const primaryConfig = modelConfigs[this.props.resModel];
            if (!primaryConfig) {
                this.state.error = `No insight_graph view defined for model "${this.props.resModel}".`;
                return;
            }

            const primaryFields = this._getNeededFields(primaryConfig);
            const primaryRecords = await this.orm.searchRead(
                this.props.resModel,
                domain ?? this.props.domain ?? [],
                primaryFields
            );

            const nodes = [];
            const edges = [];
            const visited = new Map();
            const edgeSet = new Set();
            const pendingEdges = [];

            let currentWave = new Map();

            for (const rec of primaryRecords) {
                const key = `${this.props.resModel}::${rec.id}`;
                const nodeId = this._nodeId(this.props.resModel, rec.id);
                visited.set(key, nodeId);
                nodes.push(this._makeNode(rec, this.props.resModel, primaryConfig, true));

                for (const link of primaryConfig.links) {
                    const ids = this._extractIds(rec[link.field]);
                    for (const id of ids) {
                        const targetKey = `${link.model}::${id}`;
                        pendingEdges.push({ fromKey: key, toKey: targetKey, direction: link.direction, fromModel: this.props.resModel, field: link.field });
                        if (!visited.has(targetKey)) {
                            if (!currentWave.has(link.model)) currentWave.set(link.model, new Set());
                            currentWave.get(link.model).add(id);
                        }
                    }
                }
            }

            while (currentWave.size > 0) {
                const nextWave = new Map();

                for (const [model, idSet] of currentWave) {
                    const unvisited = [...idSet].filter((id) => !visited.has(`${model}::${id}`));
                    if (!unvisited.length) continue;

                    const config = modelConfigs[model];
                    const fields = this._getNeededFields(config);
                    const records = await this.orm.read(model, unvisited, fields);

                    for (const rec of records) {
                        const key = `${model}::${rec.id}`;
                        const nodeId = this._nodeId(model, rec.id);
                        visited.set(key, nodeId);
                        nodes.push(this._makeNode(rec, model, config, false));

                        if (!config) continue;
                        for (const link of config.links) {
                            const ids = this._extractIds(rec[link.field]);
                            for (const id of ids) {
                                const targetKey = `${link.model}::${id}`;
                                pendingEdges.push({ fromKey: key, toKey: targetKey, direction: link.direction, fromModel: model, field: link.field });
                                if (!visited.has(targetKey)) {
                                    if (!nextWave.has(link.model)) nextWave.set(link.model, new Set());
                                    nextWave.get(link.model).add(id);
                                }
                            }
                        }
                    }
                }

                currentWave = nextWave;
            }

            for (const { fromKey, toKey, direction, fromModel, field } of pendingEdges) {
                const fromId = visited.get(fromKey);
                const toId = visited.get(toKey);
                if (!fromId || !toId) continue;

                const [src, tgt] = direction === "upstream" ? [toId, fromId] : [fromId, toId];
                const key = `${src}→${tgt}`;
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push({ source: src, target: tgt, relationModel: fromModel, relationField: field });
                }
            }

            // ── Pin injection ────────────────────────────────────────────────
            // Pinned nodes always appear in every graph so the user can see
            // whether (and how) a cross-view reference connects to this view.
            // Nodes already loaded by BFS are just marked; missing ones are fetched
            // and connected to whatever is already in the graph.
            const pins = getPins();
            if (pins.length) {
                // Group missing pins by model for batched RPC
                const toFetch = new Map(); // model → [pin, ...]
                for (const pin of pins) {
                    const pinKey = `${pin.model}::${pin.resId}`;
                    if (visited.has(pinKey)) {
                        const existingNode = nodes.find((n) => n.id === visited.get(pinKey));
                        if (existingNode) existingNode.isPinned = true;
                    } else {
                        if (!modelConfigs[pin.model]) continue;
                        if (!toFetch.has(pin.model)) toFetch.set(pin.model, []);
                        toFetch.get(pin.model).push(pin);
                    }
                }

                for (const [model, modelPins] of toFetch) {
                    const config = modelConfigs[model];
                    const fields = this._getNeededFields(config);
                    let records;
                    try {
                        records = await this.orm.read(model, modelPins.map((p) => p.resId), fields);
                    } catch { continue; }

                    for (const rec of records) {
                        const pin = modelPins.find((p) => p.resId === rec.id);
                        if (!pin) continue;
                        const pinNode = this._makeNode(rec, model, config, false);
                        pinNode.isPinned = true;
                        nodes.push(pinNode);
                        const pinKey = `${model}::${rec.id}`;
                        visited.set(pinKey, pinNode.id);

                        // Edges via pin's own link fields (both directions)
                        for (const link of config.links || []) {
                            const relatedIds = this._extractIds(rec[link.field]);
                            for (const relId of relatedIds) {
                                const relNodeId = visited.get(`${link.model}::${relId}`);
                                if (!relNodeId) continue;
                                const [src, tgt] = link.direction === "upstream"
                                    ? [relNodeId, pinNode.id]
                                    : [pinNode.id, relNodeId];
                                const eKey = `${src}→${tgt}`;
                                if (!edgeSet.has(eKey)) {
                                    edgeSet.add(eKey);
                                    edges.push({ source: src, target: tgt, relationModel: model, relationField: link.field });
                                }
                            }
                        }

                        // Edges from existing graph nodes that reference the pin
                        // (handles links declared only from the other side)
                        for (const existingNode of nodes) {
                            if (existingNode.id === pinNode.id) continue;
                            const exConfig = modelConfigs[existingNode.model];
                            if (!exConfig) continue;
                            for (const link of exConfig.links || []) {
                                if (link.model !== model) continue;
                                const fieldVal = existingNode.rawFields?.[link.field];
                                const refs = typeof fieldVal === "number"
                                    ? [fieldVal]
                                    : Array.isArray(fieldVal) ? fieldVal : [];
                                if (!refs.includes(rec.id)) continue;
                                const [src, tgt] = link.direction === "upstream"
                                    ? [pinNode.id, existingNode.id]
                                    : [existingNode.id, pinNode.id];
                                const eKey = `${src}→${tgt}`;
                                if (!edgeSet.has(eKey)) {
                                    edgeSet.add(eKey);
                                    edges.push({ source: src, target: tgt, relationModel: existingNode.model, relationField: link.field });
                                }
                            }
                        }
                    }
                }
            }

            const uniqueModels = [...new Set(nodes.map((n) => n.model))];
            const nodeLegend = uniqueModels.map((model) => ({
                model,
                shape: modelConfigs[model]?.shape || "rectangle",
                isPrimary: model === this.props.resModel,
            }));

            const edgeLegend = [];
            const seenEdgeTypes = new Set();
            for (const [model, config] of Object.entries(modelConfigs)) {
                if (!config) continue;
                for (const link of config.links) {
                    if (link.direction !== "downstream") continue;
                    const edgeKey = `${model}→${link.model}`;
                    if (seenEdgeTypes.has(edgeKey)) continue;
                    seenEdgeTypes.add(edgeKey);
                    const inverse = modelConfigs[link.model]?.links.find(
                        (l) => l.model === model && l.direction === "upstream"
                    );
                    edgeLegend.push({
                        sourceModel: model,
                        sourceField: link.field,
                        targetModel: link.model,
                        targetField: inverse?.field || null,
                    });
                }
            }

            this.state.modelConfigs = modelConfigs;
            this.state.graphData = { nodes, edges, nodeLegend, edgeLegend };
        } catch (e) {
            console.error("InsightGraph: error loading graph data", e);
            this.state.error = e.message || String(e);
        } finally {
            this.state.loading = false;
        }
    }

    // ── Toolbar actions ──────────────────────────────────────────────────────

    onCreateRecord() {
        this.props.createRecord?.();
    }

    // ── Node action handlers ─────────────────────────────────────────────────

    onOpenForm(nodeData) {
        console.debug(`[ig:action] open form model=${nodeData.model} resId=${nodeData.resId} label="${nodeData.label}"`);
        this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: nodeData.model,
            res_id: nodeData.resId,
            views: [[false, "form"]],
            target: "current",
        });
    }

    onDeleteNode(nodeData) {
        this.dialogService.add(ConfirmationDialog, {
            title: "Eliminar registro",
            body: `¿Eliminar "${nodeData.label}"? Esta acción no se puede deshacer.`,
            confirm: async () => {
                await this.orm.unlink(nodeData.model, [nodeData.resId]);
                await this._loadGraphData();
            },
        });
    }

    async onLinkNodes(sourceNodeData, targetNodeData, linkDef) {
        await this._writeLink(sourceNodeData, targetNodeData.resId, linkDef);
        await this._loadGraphData();
    }

    async onPinNode(nodeData) {
        pinNode(nodeData.model, nodeData.resId, nodeData.label);
        await this._loadGraphData();
    }

    async onUnpinNode(nodeData) {
        unpinNode(nodeData.model, nodeData.resId);
        await this._loadGraphData();
    }

    // ── Selection bar (notified by renderer, rendered in layout-actions slot) ──

    onSelectionChange(count, buttons, selectedNodes, onClear, onAction, onHide) {
        this.state.selectionInfo = count > 0 ? { count, buttons, selectedNodes } : null;
        this._selectionClear = onClear;
        this._selectionAction = onAction;
        this._selectionHide = onHide;
    }

    onSelectionBarClear() {
        this._selectionClear?.();
    }

    onSelectionBarAction(btn) {
        this._selectionAction?.(btn);
    }

    onHideSelectedNodes() {
        this._selectionHide?.();
    }

    // ── Renderer actions (centering, etc.) ───────────────────────────────────

    onRendererReady(actions) {
        this._rendererActions = actions;
    }

    async onPinSelectedNodes() {
        const nodes = this.state.selectionInfo?.selectedNodes;
        if (!nodes?.length) return;
        for (const node of nodes) {
            pinNode(node.model, node.resId, node.label);
        }
        await this._loadGraphData();
    }

    async onUnpinSelectedNodes() {
        const nodes = this.state.selectionInfo?.selectedNodes;
        if (!nodes?.length) return;
        for (const node of nodes) {
            unpinNode(node.model, node.resId);
        }
        await this._loadGraphData();
    }

    async onDeleteSelectedNodes() {
        const nodes = this.state.selectionInfo?.selectedNodes;
        if (!nodes?.length) return;
        const byModel = {};
        for (const node of nodes) (byModel[node.model] ||= []).push(node.resId);
        const count = nodes.length;
        this.dialogService.add(ConfirmationDialog, {
            title: "Eliminar registros",
            body: `¿Eliminar ${count} registro${count > 1 ? "s" : ""}? Esta acción no se puede deshacer.`,
            confirm: async () => {
                await Promise.all(
                    Object.entries(byModel).map(([model, ids]) => this.orm.unlink(model, ids))
                );
                await this._loadGraphData();
            },
        });
    }

    onExportGraphML() {
        const graphData = this.state.graphData;
        if (!graphData) return;

        const esc = (str) => String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        const allFieldNames = new Set();
        for (const node of graphData.nodes) {
            for (const f of node.tooltipFields || []) allFieldNames.add(f.name);
        }

        const hiddenNodeIds = this._rendererActions?.getHiddenNodeIds?.() ?? new Set();

        const lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<graphml xmlns="http://graphml.graphdrawing.org/graphml">',
            '  <key id="d_label" for="node" attr.name="label" attr.type="string"/>',
            '  <key id="d_model" for="node" attr.name="model" attr.type="string"/>',
            '  <key id="d_resId" for="node" attr.name="resId" attr.type="int"/>',
            '  <key id="d_flowState" for="node" attr.name="flowState" attr.type="string"/>',
            '  <key id="d_hidden" for="node" attr.name="hidden" attr.type="boolean"/>',
            '  <key id="d_pinned" for="node" attr.name="pinned" attr.type="boolean"/>',
        ];
        for (const fname of allFieldNames) {
            lines.push(`  <key id="d_${esc(fname)}" for="node" attr.name="${esc(fname)}" attr.type="string"/>`);
        }
        lines.push('  <key id="e_model" for="edge" attr.name="model" attr.type="string"/>');
        lines.push('  <key id="e_field" for="edge" attr.name="field" attr.type="string"/>');
        lines.push('  <graph id="G" edgedefault="directed">');

        for (const node of graphData.nodes) {
            lines.push(`    <node id="${esc(node.id)}">`);
            lines.push(`      <data key="d_label">${esc(node.label)}</data>`);
            lines.push(`      <data key="d_model">${esc(node.model)}</data>`);
            lines.push(`      <data key="d_resId">${node.resId}</data>`);
            if (node.flowState) {
                lines.push(`      <data key="d_flowState">${esc(node.flowState)}</data>`);
            }
            if (hiddenNodeIds.has(node.id)) {
                lines.push('      <data key="d_hidden">true</data>');
            }
            if (node.isPinned) {
                lines.push('      <data key="d_pinned">true</data>');
            }
            for (const f of node.tooltipFields || []) {
                lines.push(`      <data key="d_${esc(f.name)}">${esc(f.value)}</data>`);
            }
            lines.push('    </node>');
        }

        graphData.edges.forEach((edge, i) => {
            lines.push(`    <edge id="e${i}" source="${esc(edge.source)}" target="${esc(edge.target)}">`);
            lines.push(`      <data key="e_model">${esc(edge.relationModel)}</data>`);
            lines.push(`      <data key="e_field">${esc(edge.relationField)}</data>`);
            lines.push('    </edge>');
        });

        lines.push('  </graph>');
        lines.push('</graphml>');

        const blob = new Blob([lines.join("\n")], { type: "application/xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${this.props.resModel.replace(/\./g, "_")}_graph.graphml`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async onExecuteAction(model, resIds, buttonDef) {
        const result = await this.orm.call(model, buttonDef.name, [resIds]);
        if (result && typeof result === "object" && result.type) {
            await this.actionService.doAction(result);
        } else {
            await this._loadGraphData();
        }
    }

    async onCreateAndLink(sourceNodeData, linkDef) {
        const context = await this._buildCreateContext(sourceNodeData, linkDef);
        console.debug(`[ig:action] open create dialog model=${linkDef.model} source=${sourceNodeData.model}#${sourceNodeData.resId} context=${JSON.stringify(context)}`);
        this.dialogService.add(FormViewDialog, {
            resModel: linkDef.model,
            context,
            onRecordSaved: async (record) => {
                console.debug(`[ig:action] record saved resId=${record.resId} → linking to source`);
                await this._writeLink(sourceNodeData, record.resId, linkDef);
                await this._loadGraphData();
            },
        });
    }

    async _buildCreateContext(sourceNodeData, linkDef) {
        // 1. Try declared inverse from edgeLegend
        const edgeLeg = this.state.graphData?.edgeLegend.find(
            (e) => e.sourceModel === sourceNodeData.model && e.sourceField === linkDef.field
        );
        let backField = edgeLeg?.targetField || null;

        // 2. If not declared, auto-discover: look for a m2o on the target model
        //    pointing back to the source model.
        if (!backField) {
            const allFields = await this.orm.call(
                linkDef.model, "fields_get", [], { attributes: ["type", "relation"] }
            );
            for (const [fname, finfo] of Object.entries(allFields)) {
                if (finfo.type === "many2one" && finfo.relation === sourceNodeData.model) {
                    backField = fname;
                    break;
                }
            }
        }

        if (!backField) return {};

        // 3. Fetch type to build the correct ORM default value
        const fieldsInfo = await this.orm.call(
            linkDef.model, "fields_get", [[backField]], { attributes: ["type"] }
        );
        const fieldType = fieldsInfo[backField]?.type;

        if (fieldType === "many2one") {
            return { [`default_${backField}`]: sourceNodeData.resId };
        } else if (fieldType === "many2many") {
            return { [`default_${backField}`]: [[6, 0, [sourceNodeData.resId]]] };
        }
        return {};
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    async _writeLink(sourceNodeData, targetResId, linkDef) {
        const writeValues = linkDef.direction === "upstream"
            ? { [linkDef.field]: targetResId }
            : { [linkDef.field]: [[4, targetResId]] };
        await this.orm.write(sourceNodeData.model, [sourceNodeData.resId], writeValues);
    }

    _getNeededFields(config) {
        const fields = new Set(["id"]);
        if (!config) return [...fields, "display_name"];
        if (config.primaryField) fields.add(config.primaryField);
        if (config.colorField) fields.add(config.colorField);
        for (const f of config.nodeFields || []) fields.add(f.name);
        for (const l of config.links || []) fields.add(l.field);
        for (const f of config.invisibleFields || []) fields.add(f);
        return [...fields];
    }

    _nodeId(model, id) {
        return `${model.replace(/\./g, "_")}_${id}`;
    }

    _makeNode(rec, model, config, isPrimary) {
        const primary = config?.primaryField || "display_name";
        const colorFieldName = config?.colorField;
        const rawLabel = rec[primary];
        const label = Array.isArray(rawLabel) ? rawLabel[1] : String(rawLabel ?? rec.id);
        const flowState = colorFieldName ? (rec[colorFieldName] || null) : null;

        // Raw field values for button/field invisible evaluation AND pin edge detection.
        // Must be computed before tooltipFields so computable invisible expressions can
        // be evaluated against this record's data.
        const rawFields = {};
        const fieldsToStore = new Set([
            config?.primaryField,
            config?.colorField,
            ...(config?.nodeFields || []).map((f) => f.name),
            ...(config?.invisibleFields || []),
            ...(config?.links || []).map((l) => l.field),  // needed to detect pin edges
        ].filter(Boolean));
        for (const fname of fieldsToStore) {
            if (fname in rec) {
                const val = rec[fname];
                // For many2one [id, "name"] tuples, store the ID for expression evaluation
                rawFields[fname] = (
                    Array.isArray(val) && val.length === 2 &&
                    typeof val[0] === "number" && typeof val[1] === "string"
                ) ? val[0] : val;
            }
        }

        const tooltipFields = (config?.nodeFields || [])
            .filter((f) => !f.primary)
            .filter((f) => {
                if (!f.invisible) return true;
                try {
                    return !evaluateBooleanExpr(f.invisible, rawFields);
                } catch {
                    return true;
                }
            })
            .map((f) => {
                const val = rec[f.name];
                return { name: f.name, value: Array.isArray(val) ? val[1] : String(val ?? "") };
            });

        const imageField = config?.imageField;
        const imageDataUrl = imageField && rec[imageField]
            ? `data:image/png;base64,${rec[imageField]}`
            : null;

        const hasTemplate = Boolean(config?.nodeTemplate);

        return {
            id: this._nodeId(model, rec.id),
            label,
            model,
            resId: rec.id,
            shape: config?.shape || "rectangle",
            flowState,
            isPrimary,
            tooltipFields,
            rawFields,
            // Only include imageDataUrl when there is actually an image — setting it to null
            // causes Cytoscape's [imageDataUrl] selector to still match (null key exists in data),
            // which incorrectly applies `text-valign: bottom` and `height: 82px` to all nodes.
            ...(imageDataUrl ? { imageDataUrl } : {}),
            // HTML overlay fields: only include when in template mode to avoid Cytoscape
            // misinterpreting null/undefined values as matching data-mapped style selectors.
            ...(hasTemplate ? {
                htmlNode: true,
                nodeWidth: config?.nodeWidth || 180,
                nodeHeight: config?.nodeHeight || 120,
            } : {}),
            displayFields: this._buildDisplayFields(rec, config),
        };
    }

    _buildDisplayFields(rec, config) {
        const result = {};
        for (const f of config?.nodeFields || []) {
            const val = rec[f.name];
            if (f.monetary && val !== false && val != null) {
                const rawCurrency = f.currencyField ? rec[f.currencyField] : undefined;
                const currencyId = Array.isArray(rawCurrency) ? rawCurrency[0] : rawCurrency;
                result[f.name] = formatMonetary(val, { currencyId });
            } else {
                result[f.name] = Array.isArray(val) ? val[1] : String(val ?? "");
            }
        }
        const imgField = config?.imageField;
        if (imgField && rec[imgField]) {
            result[imgField] = `data:image/png;base64,${rec[imgField]}`;
        }
        return result;
    }

    _extractIds(fieldValue) {
        if (!fieldValue || fieldValue === false) return [];
        if (!Array.isArray(fieldValue)) return [];
        if (fieldValue.length === 0) return [];
        if (fieldValue.length === 2 && typeof fieldValue[0] === "number" && typeof fieldValue[1] === "string") {
            return [fieldValue[0]];
        }
        return fieldValue.filter((v) => typeof v === "number");
    }
}
