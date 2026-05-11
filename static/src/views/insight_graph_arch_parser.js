/** @odoo-module **/

/**
 * Extracts field names referenced in a Python boolean expression (heuristic).
 * Used to ensure those fields are fetched when building node data.
 */
function extractInvisibleFields(expr) {
    if (!expr) return [];
    // Strip quoted string literals so values like 'draft' aren't mistaken for field names
    const stripped = expr.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
    const keywords = new Set([
        "in", "not", "and", "or", "true", "false", "none",
        "if", "else", "is", "True", "False", "None",
    ]);
    return [...stripped.matchAll(/\b([a-z][a-z0-9_]*)\b/g)]
        .map((m) => m[1])
        .filter((name) => !keywords.has(name));
}

/** Returns true for static always-true values that don't reference any field. */
function isTautologicallyTrue(expr) {
    const t = expr.trim().toLowerCase();
    return t === "true" || t === "1" || t === "yes";
}

/**
 * Parses the XML arch of an insight_graph ir.ui.view into a JS config object.
 *
 * Expected arch:
 *   <insight_graph>
 *       <button name="action_validate" type="object"
 *           class="oe_highlight" icon="fa-play" title="Validate"
 *           invisible="state not in ('draft', 'on_error')"/>
 *       <node shape="rectangle">
 *           <field name="display_name" primary="true"/>
 *           <field name="some_status" color="true"/>
 *           <field name="other_field"/>
 *           <field name="state" invisible="True"/>          <!-- always hidden, just fetched -->
 *           <field name="extra" invisible="state == 'x'"/>  <!-- hidden per-node at runtime -->
 *       </node>
 *       <link field="child_ids" direction="downstream" model="some.model"/>
 *       <link field="parent_id" direction="upstream" model="other.model"/>
 *   </insight_graph>
 *
 * invisible rules for <field> inside <node>:
 *   - absent                → visible, added to nodeFields normally.
 *   - tautologically true   → always hidden; added to invisibleFields, skipped in nodeFields.
 *   - computable expression on primary/color field → parse error (those fields drive the node's
 *                             visual representation and cannot be conditionally absent).
 *   - computable expression on a regular field → added to nodeFields with {invisible: expr};
 *                             evaluated per-node at render time; referenced fields added to
 *                             invisibleFields so they are fetched.
 *
 * Returns:
 *   {
 *       shape, primaryField, colorField,
 *       nodeFields: [{ name, primary, color, invisible }],  // invisible is null or expr string
 *       links,
 *       buttons: [{ name, type, btnClass, icon, title, invisible }],
 *       invisibleFields: string[],   // field names that must be fetched but never displayed
 *   }
 */
export class InsightGraphArchParser {
    parse(arch) {
        // arch is the root DOM element (<insight_graph>)
        const nodeEl = arch.querySelector("node");
        const shape = nodeEl?.getAttribute("shape") || "rectangle";

        const nodeFields = [];
        let primaryField = "display_name";
        let colorField = null;
        const invisibleFieldSet = new Set();

        if (nodeEl) {
            for (const fieldEl of nodeEl.querySelectorAll("field")) {
                const name = fieldEl.getAttribute("name");
                if (!name) continue;

                const invisibleExpr = fieldEl.getAttribute("invisible") || "";
                const isPrimary = fieldEl.getAttribute("primary") === "true";
                const isColor = fieldEl.getAttribute("color") === "true";

                if (invisibleExpr) {
                    if (isTautologicallyTrue(invisibleExpr)) {
                        // Always invisible: fetch for expression evaluation, never render.
                        invisibleFieldSet.add(name);
                    } else {
                        // Computable invisible: primary/color fields cannot be conditional.
                        if (isPrimary || isColor) {
                            throw new Error(
                                `insight_graph: field "${name}" has a computable invisible ` +
                                `expression but is marked as primary or color. These fields ` +
                                `drive the node's visual representation and must always be present.`
                            );
                        }
                        // Regular field: keep in nodeFields with the expression; also fetch
                        // any fields that the expression itself references.
                        nodeFields.push({ name, primary: false, color: false, invisible: invisibleExpr });
                        for (const f of extractInvisibleFields(invisibleExpr)) {
                            invisibleFieldSet.add(f);
                        }
                    }
                    continue;
                }

                nodeFields.push({ name, primary: isPrimary, color: isColor, invisible: null });
                if (isPrimary) primaryField = name;
                if (isColor) colorField = name;
            }
        }

        const links = [];
        for (const linkEl of arch.querySelectorAll("link")) {
            const field = linkEl.getAttribute("field");
            const model = linkEl.getAttribute("model");
            if (!field || !model) continue;
            links.push({
                field,
                direction: linkEl.getAttribute("direction") || "downstream",
                model,
            });
        }

        // Parse <button> direct children of the root element
        const buttons = [];
        for (const child of arch.children) {
            if (child.tagName.toLowerCase() !== "button") continue;
            const invisible = child.getAttribute("invisible");
            buttons.push({
                name: child.getAttribute("name"),
                type: child.getAttribute("type") || "object",
                btnClass: child.getAttribute("class") || "",
                icon: child.getAttribute("icon") || "",
                title: child.getAttribute("title") || "",
                invisible: invisible || null,
            });
            for (const f of extractInvisibleFields(invisible || "")) {
                invisibleFieldSet.add(f);
            }
        }

        return {
            shape,
            primaryField,
            colorField,
            nodeFields,
            links,
            buttons,
            invisibleFields: [...invisibleFieldSet],
        };
    }
}
