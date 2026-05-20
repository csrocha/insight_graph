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

        let imageField = null;

        if (nodeEl) {
            for (const fieldEl of nodeEl.querySelectorAll("field")) {
                const name = fieldEl.getAttribute("name");
                if (!name) continue;

                const invisibleExpr = fieldEl.getAttribute("invisible") || "";
                const isPrimary = fieldEl.getAttribute("primary") === "true";
                const isColor = fieldEl.getAttribute("color") === "true";
                const isImage = fieldEl.getAttribute("type") === "image";

                if (isImage) {
                    if (isPrimary || isColor) {
                        throw new Error(
                            `insight_graph: field "${name}" has type="image" but is also ` +
                            `marked as primary or color, which is not supported.`
                        );
                    }
                    imageField = name;
                    invisibleFieldSet.add(name);
                    continue;
                }

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

                const isMonetary = fieldEl.getAttribute("type") === "monetary";
                const currencyField = isMonetary
                    ? (fieldEl.getAttribute("currency_field") || "currency_id")
                    : null;
                if (currencyField) invisibleFieldSet.add(currencyField);
                nodeFields.push({ name, primary: isPrimary, color: isColor, invisible: null, monetary: isMonetary, currencyField });
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

        const nodeWidth = parseInt(nodeEl?.getAttribute("width") || "180");
        const nodeHeight = parseInt(nodeEl?.getAttribute("height") || "120");

        // Detect template mode: <node> has non-<field> direct/descendant elements
        const hasTemplate = nodeEl
            ? [...nodeEl.children].some((ch) => ch.tagName.toLowerCase() !== "field")
            : false;

        let nodeTemplate = null;
        if (hasTemplate) {
            // Scan <field> elements inside the template to know which fields to fetch
            for (const fieldEl of nodeEl.querySelectorAll("field")) {
                const name = fieldEl.getAttribute("name");
                if (!name) continue;
                const isImage = fieldEl.getAttribute("type") === "image";
                if (isImage) {
                    imageField = name;
                    invisibleFieldSet.add(name);
                } else {
                    const isPrimary = fieldEl.getAttribute("primary") === "true";
                    const isColor = fieldEl.getAttribute("color") === "true";
                    const isMonetary = fieldEl.getAttribute("type") === "monetary";
                    const currencyField = isMonetary
                        ? (fieldEl.getAttribute("currency_field") || "currency_id")
                        : null;
                    if (currencyField) invisibleFieldSet.add(currencyField);
                    if (!nodeFields.find((f) => f.name === name)) {
                        nodeFields.push({ name, primary: isPrimary, color: isColor, invisible: null, monetary: isMonetary, currencyField });
                    }
                    if (isPrimary) primaryField = name;
                    if (isColor) colorField = name;
                }
            }
            // Clone and convert <field> elements to span placeholders for runtime rendering
            const clone = nodeEl.cloneNode(true);
            for (const fieldEl of [...clone.querySelectorAll("field")]) {
                const name = fieldEl.getAttribute("name");
                const isImage = fieldEl.getAttribute("type") === "image";
                const span = document.createElement("span");
                if (isImage) {
                    span.setAttribute("data-ig-image", name);
                    const cls = fieldEl.getAttribute("class");
                    const sty = fieldEl.getAttribute("style");
                    if (cls) span.setAttribute("data-ig-img-class", cls);
                    if (sty) span.setAttribute("data-ig-img-style", sty);
                } else {
                    span.setAttribute("data-ig-field", name);
                }
                fieldEl.parentNode.replaceChild(span, fieldEl);
            }
            nodeTemplate = clone.innerHTML;
        }

        return {
            shape,
            primaryField,
            colorField,
            imageField,
            nodeFields,
            links,
            buttons,
            invisibleFields: [...invisibleFieldSet],
            nodeWidth,
            nodeHeight,
            nodeTemplate,
        };
    }
}
