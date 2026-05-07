/** @odoo-module **/

import { Component, onWillStart, onWillUpdateProps, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { Layout } from "@web/search/layout";
import { SearchBar } from "@web/search/search_bar/search_bar";
import { useSearchBarToggler } from "@web/search/search_bar/search_bar_toggler";
import { InsightGraphArchParser } from "./insight_graph_arch_parser";
import { InsightGraphRenderer } from "./insight_graph_renderer";

export class InsightGraphController extends Component {
    static template = "insight_graph.InsightGraphController";
    static components = { InsightGraphRenderer, Layout, SearchBar };
    static props = {
        resModel: { type: String },
        domain: { type: Array, optional: true },
        archInfo: { type: Object, optional: true },
        // standard view props — must declare all to satisfy OWL strict prop checking
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
        this.searchBarToggler = useSearchBarToggler();

        this.state = useState({
            loading: true,
            error: null,
            graphData: null,
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
            // Load all insight_graph arch configs from the server (all models)
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

            const primaryConfig = modelConfigs[this.props.resModel];
            if (!primaryConfig) {
                this.state.error = `No insight_graph view defined for model "${this.props.resModel}".`;
                return;
            }

            // Fetch primary records (those matching the current domain/filter)
            const primaryFields = this._getNeededFields(primaryConfig);
            const primaryRecords = await this.orm.searchRead(
                this.props.resModel,
                domain ?? this.props.domain ?? [],
                primaryFields
            );

            // BFS: wave-based traversal collecting nodes and edges
            const nodes = [];
            const edges = [];
            const visited = new Map(); // "model::id" → nodeId string
            const edgeSet = new Set();
            const pendingEdges = []; // { fromKey, toKey, direction }

            // Seed the first wave from primary records
            let currentWave = new Map(); // model → Set<id>

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

            // BFS expansion — stop when no new records are discovered
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

            // Resolve edges — skip if either endpoint was never fetched
            for (const { fromKey, toKey, direction, fromModel, field } of pendingEdges) {
                const fromId = visited.get(fromKey);
                const toId = visited.get(toKey);
                if (!fromId || !toId) continue;

                // direction "downstream": from → to; "upstream": to → from (data flows left→right)
                const [src, tgt] = direction === "upstream" ? [toId, fromId] : [fromId, toId];
                const key = `${src}→${tgt}`;
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push({ source: src, target: tgt, relationModel: fromModel, relationField: field });
                }
            }

            // Build nodeLegend: one entry per unique model present in the graph
            const uniqueModels = [...new Set(nodes.map((n) => n.model))];
            const nodeLegend = uniqueModels.map((model) => ({
                model,
                shape: modelConfigs[model]?.shape || "rectangle",
                isPrimary: model === this.props.resModel,
            }));

            // Build edgeLegend: unique source→target link types (downstream direction only)
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

            this.state.graphData = { nodes, edges, nodeLegend, edgeLegend };
        } catch (e) {
            console.error("InsightGraph: error loading graph data", e);
            this.state.error = e.message || String(e);
        } finally {
            this.state.loading = false;
        }
    }

    _getNeededFields(config) {
        const fields = new Set(["id"]);
        if (!config) return [...fields, "display_name"];
        if (config.primaryField) fields.add(config.primaryField);
        if (config.colorField) fields.add(config.colorField);
        for (const f of config.nodeFields || []) fields.add(f.name);
        for (const l of config.links || []) fields.add(l.field);
        return [...fields];
    }

    _nodeId(model, id) {
        return `${model.replace(/\./g, "_")}_${id}`;
    }

    _makeNode(rec, model, config, isPrimary) {
        const primary = config?.primaryField || "display_name";
        const colorFieldName = config?.colorField;
        const rawLabel = rec[primary];
        // Many2one fields return [id, name] — unwrap if needed
        const label = Array.isArray(rawLabel) ? rawLabel[1] : String(rawLabel ?? rec.id);
        const flowState = colorFieldName ? (rec[colorFieldName] || null) : null;

        const tooltipFields = (config?.nodeFields || [])
            .filter((f) => !f.primary)
            .map((f) => {
                const val = rec[f.name];
                return { name: f.name, value: Array.isArray(val) ? val[1] : String(val ?? "") };
            });

        return {
            id: this._nodeId(model, rec.id),
            label,
            model,
            resId: rec.id,
            shape: config?.shape || "rectangle",
            flowState,
            isPrimary,
            tooltipFields,
        };
    }

    _extractIds(fieldValue) {
        if (!fieldValue || fieldValue === false) return [];
        if (!Array.isArray(fieldValue)) return [];
        if (fieldValue.length === 0) return [];
        // Many2one: [id, "name"] — first element is a number, second a string
        if (fieldValue.length === 2 && typeof fieldValue[0] === "number" && typeof fieldValue[1] === "string") {
            return [fieldValue[0]];
        }
        // One2many / Many2many: array of integer IDs
        return fieldValue.filter((v) => typeof v === "number");
    }

    onNodeClick(nodeData) {
        this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: nodeData.model,
            res_id: nodeData.resId,
            views: [[false, "form"]],
            target: "current",
        });
    }
}
