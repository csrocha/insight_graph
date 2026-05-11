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
 *       </node>
 *       <link field="child_ids" direction="downstream" model="some.model"/>
 *       <link field="parent_id" direction="upstream" model="other.model"/>
 *   </insight_graph>
 *
 * Returns:
 *   {
 *       shape, primaryField, colorField, nodeFields, links,
 *       buttons: [{ name, type, btnClass, icon, title, invisible }],
 *       invisibleFields: string[],   // field names referenced in invisible expressions
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

        if (nodeEl) {
            for (const fieldEl of nodeEl.querySelectorAll("field")) {
                const name = fieldEl.getAttribute("name");
                if (!name) continue;
                const isPrimary = fieldEl.getAttribute("primary") === "true";
                const isColor = fieldEl.getAttribute("color") === "true";
                nodeFields.push({ name, primary: isPrimary, color: isColor });
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
        const invisibleFieldSet = new Set();
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
