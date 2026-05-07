/** @odoo-module **/

/**
 * Parses the XML arch of an insight_graph ir.ui.view into a JS config object.
 *
 * Expected arch:
 *   <insight_graph>
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
 *       shape: "rectangle",
 *       primaryField: "display_name",
 *       colorField: "some_status",
 *       nodeFields: [{ name, primary, color }],
 *       links: [{ field, direction, model }],
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

        return { shape, primaryField, colorField, nodeFields, links };
    }
}
