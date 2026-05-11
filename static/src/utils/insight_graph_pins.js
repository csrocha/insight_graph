/** @odoo-module **/

/**
 * Persistent cross-view pin storage backed by localStorage.
 *
 * A "pin" is a reference node { model, resId, label } chosen by the user as an
 * anchor while navigating between graph views.  When a pinned node naturally
 * appears in any graph (loaded by the normal BFS traversal) it receives a
 * visual indicator so the user can track it across different model views.
 */

const STORAGE_KEY = "o_insight_graph_pins";

function _read() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
        return [];
    }
}

function _write(pins) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}

/** Return all pinned entries. */
export function getPins() {
    return _read();
}

/** Pin a node. No-op if already pinned. */
export function pinNode(model, resId, label) {
    const pins = _read();
    if (!pins.find((p) => p.model === model && p.resId === resId)) {
        pins.push({ model, resId, label });
        _write(pins);
    }
}

/** Remove a pin. No-op if not pinned. */
export function unpinNode(model, resId) {
    _write(_read().filter((p) => !(p.model === model && p.resId === resId)));
}

/** Check whether a specific node is pinned. */
export function isPinnedNode(model, resId) {
    return _read().some((p) => p.model === model && p.resId === resId);
}
