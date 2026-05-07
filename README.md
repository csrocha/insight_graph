# insight_graph — Interactive DAG Graph View for Odoo

> **Versión en castellano más abajo / Spanish version below**

---

## Introduction

Modern ERP data is deeply relational. Providers feed columns, columns feed calculations, projects have sub-projects, tasks depend on other tasks. Yet Odoo's standard views — lists, kanbans, forms — flatten those relationships into tables and cards, hiding the structure that matters most.

**insight_graph** adds a new native view type to Odoo 17: an interactive Directed Acyclic Graph (DAG) that lets you see *and edit* the relationships between records as nodes and edges in a live diagram.

The module was born while building `survey_insights_manager`, where the indicator pipeline (data providers → indicator columns → calculations) was impossible to understand or debug from list views alone. Rather than building a one-off widget, we designed a **generic, declarative** solution: define a graph view in XML exactly like you would a form or list, and the framework handles the rest. Any Odoo module can now add a graph view to any model with a few lines of XML — no JavaScript required.

---

## Development — Using insight_graph in your own module

### 1. Add the dependency

In your module's `__manifest__.py`:

```python
"depends": ["insight_graph"],
```

### 2. Define a graph view in XML

Create a view with `type="insight_graph"` for your model. The architecture declares how records look as nodes (`<node>`) and which relational fields to follow as edges (`<link>`).

```xml
<record id="view_my_model_insight_graph" model="ir.ui.view">
    <field name="name">my.model.insight.graph</field>
    <field name="model">my.model</field>
    <field name="type">insight_graph</field>
    <field name="arch" type="xml">
        <insight_graph>
            <!-- Node appearance -->
            <node shape="roundrectangle">
                <field name="display_name" primary="true"/>  <!-- Node label -->
                <field name="state" color="true"/>           <!-- Drives node color -->
                <field name="responsible_id"/>               <!-- Shown in tooltip -->
            </node>

            <!-- Relational edges to traverse -->
            <link field="child_ids"  direction="downstream" model="my.model"/>
            <link field="parent_id"  direction="upstream"   model="my.model"/>
            <link field="task_ids"   direction="downstream" model="project.task"/>
        </insight_graph>
    </field>
</record>
```

**Node shapes:** `rectangle` (default), `roundrectangle`, `diamond`, `ellipse`

**Link directions:**
- `downstream` — the edge points *away* from the current record (children, outputs).
- `upstream` — the edge points *toward* the current record (parents, inputs). The arrow is visually reversed.

### 3. Register the view mode in a window action

```xml
<record id="action_my_model" model="ir.actions.act_window">
    <field name="name">My Model</field>
    <field name="res_model">my.model</field>
    <field name="view_mode">insight_graph,list,form</field>
    <field name="view_ids" eval="[
        (5, 0, 0),
        (0, 0, {'view_mode': 'insight_graph',
                'view_id': ref('view_my_model_insight_graph')}),
        (0, 0, {'view_mode': 'list'}),
        (0, 0, {'view_mode': 'form'}),
    ]"/>
</record>
```

### 4. Customize colors with CSS variables

insight_graph uses CSS custom properties so you can theme nodes and edges from your module's SCSS without touching any JavaScript. Define them under the `.o_insight_graph_view` selector:

```scss
// mymodule/static/src/scss/mymodule_graph.scss

.o_insight_graph_view {
    // Node state colors  →  --o-insight-state-{value}-{bg|border|text}
    --o-insight-state-draft-bg:      #fef3e8;
    --o-insight-state-draft-border:  #e67e22;
    --o-insight-state-draft-text:    #d35400;

    --o-insight-state-active-bg:     #d4edda;
    --o-insight-state-active-border: #28a745;
    --o-insight-state-active-text:   #155724;

    --o-insight-state-done-bg:       #e2e3e5;
    --o-insight-state-done-border:   #6c757d;
    --o-insight-state-done-text:     #383d41;

    // Edge colors  →  --o-insight-relation-{model-dashes}-{field}
    --o-insight-relation-my-model-child_ids:  #2563eb;
    --o-insight-relation-my-model-task_ids:   #10b981;
}
```

The `{model-dashes}` part replaces dots with dashes: `my.model` → `my-model`.

### 5. Multi-model graphs

insight_graph automatically loads **all** `insight_graph` views active in the database. If `project.task` also has an `insight_graph` view defined, those nodes will be styled according to that view's configuration when they appear in your graph. No extra configuration needed — the framework discovers everything through the declared `<link>` relationships.

### 6. Interactive features available to users

Once the view is set up, users get:

| Feature | How |
|---|---|
| **Open record** | Click node → Form button |
| **Delete record** | Click node → Delete button (with confirmation) |
| **Hide node** | Click node → Hide button (session-persisted) |
| **Link two existing records** | Drag from a relation circle to another node |
| **Create and link a new record** | Drag from a relation circle to empty space |
| **Reveal hidden nodes** | Drag/click the orange collapsed circle |
| **Change layout** | Layout selector in toolbar (dagre, circle, grid, force…) |
| **Hover tooltip** | Shows label, state, and extra fields |

---

## Conclusion — Patterns and complex structures

### Finding patterns

A graph view immediately surfaces things that are invisible in list views:

- **Orphan records** — nodes with no edges are immediately visible as isolated dots.
- **Bottleneck nodes** — records with many incoming edges stand out visually as hubs.
- **Broken chains** — an expected path that stops mid-graph signals a missing relationship.
- **Circular dependencies** — cycles in what should be a DAG are obvious the moment you see an arrow looping back.

Use the **search bar** (supports existing Odoo filters and favorites) to zoom into a specific subset of the graph. A filtered view lets you study one branch of a complex pipeline without the noise of the full dataset.

### Editing complex structures

The drag-to-link and drag-to-create interactions are designed for situations where the relational structure *is* the content:

- **Restructuring a hierarchy** — hide the parts you don't need, rearrange a sub-tree by linking and unlinking nodes, reveal the hidden nodes when done.
- **Building a pipeline from scratch** — start from one node, drag to empty space to create the next stage, repeat. The context system auto-populates the inverse relationship so records are correctly wired without having to open each form.
- **Auditing data quality** — switch between `dagre-lr` (horizontal flow) and `dagre-tb` (vertical hierarchy) to see the structure from different perspectives.

---

## License

This module is released under the **LGPL-3 (GNU Lesser General Public License v3.0)**.

You are free to:
- **Use** it in any project, commercial or otherwise.
- **Copy, distribute, and modify** the source code.
- **Build proprietary modules** that depend on it (LGPL, not GPL).
- **Sell it** or include it in a paid product.

The only requirement: if you modify `insight_graph` itself, share those modifications under the same license.

The module will be published on the **Odoo App Store** so the community can install it directly from the market.

---

## Acknowledgements

### Claude Code

A large part of this module — the architecture, the BFS traversal, the Cytoscape integration, the OWL component structure, the drag-to-link interaction — was designed and written with the help of **[Claude Code](https://claude.ai/code)**, Anthropic's AI coding assistant. It was an unusually good collaboration: the kind where you describe a problem and get back working code that you actually want to keep.

If you have used AI tools and wondered whether they can carry a complex frontend feature end-to-end in a non-trivial framework like Odoo 17's OWL — the answer, at least in this case, is yes.

### Buy the developer a coffee

If this module saved you time, helped you understand your data, or just made your Odoo installation a little more interesting, consider buying the developer a coffee. It genuinely helps keep projects like this alive.

[![Invitame un café en cafecito.app](https://cdn.cafecito.app/imgs/buttons/button_1.svg)](https://cafecito.app/csrocha)

---

## Get involved

### Developers

Contributions are welcome. Open a pull request, file an issue, or fork the repo and take it somewhere new. Some areas that would benefit from help:

- Additional layout algorithms or layout persistence across sessions.
- Edge label rendering (show field names on arrows).
- Export to SVG/PNG.
- Support for `one2many` inline creation without a dialog.
- Performance optimizations for large graphs (>500 nodes).

### Users

Found a bug? Have a feature request? Something that should work but doesn't?
Open an issue in the repository. The more specific, the better: model name, XML configuration, and a description of what you expected vs. what happened.

---
---

# insight_graph — Vista de Grafo DAG Interactiva para Odoo

## Introducción

Los datos de un ERP moderno son profundamente relacionales. Los proveedores alimentan columnas, las columnas alimentan cálculos, los proyectos tienen subproyectos, las tareas dependen de otras tareas. Sin embargo, las vistas estándar de Odoo — listas, kanbans, formularios — aplanan esas relaciones en tablas y tarjetas, ocultando la estructura que más importa.

**insight_graph** agrega un nuevo tipo de vista nativa a Odoo 17: un Grafo Dirigido Acíclico (DAG) interactivo que permite ver *y editar* las relaciones entre registros como nodos y aristas en un diagrama en vivo.

El módulo nació mientras se construía `survey_insights_manager`, donde el pipeline de indicadores (proveedores de datos → columnas de indicadores → cálculos) era imposible de entender o depurar desde vistas de lista. En lugar de construir un widget de un solo uso, se diseñó una solución **genérica y declarativa**: definir una vista de grafo en XML exactamente igual que un formulario o una lista, y el framework se encarga del resto. Cualquier módulo de Odoo puede ahora agregar una vista de grafo a cualquier modelo con unas pocas líneas de XML — sin JavaScript.

---

## Desarrollo — Cómo usar insight_graph en tu módulo

### 1. Agregar la dependencia

En el `__manifest__.py` de tu módulo:

```python
"depends": ["insight_graph"],
```

### 2. Definir una vista de grafo en XML

Crear una vista con `type="insight_graph"` para tu modelo. La arquitectura declara cómo se ven los registros como nodos (`<node>`) y qué campos relacionales seguir como aristas (`<link>`).

```xml
<record id="view_mi_modelo_insight_graph" model="ir.ui.view">
    <field name="name">mi.modelo.insight.graph</field>
    <field name="model">mi.modelo</field>
    <field name="type">insight_graph</field>
    <field name="arch" type="xml">
        <insight_graph>
            <!-- Apariencia del nodo -->
            <node shape="roundrectangle">
                <field name="display_name" primary="true"/>  <!-- Etiqueta del nodo -->
                <field name="state" color="true"/>           <!-- Define el color del nodo -->
                <field name="responsible_id"/>               <!-- Se muestra en el tooltip -->
            </node>

            <!-- Aristas relacionales a recorrer -->
            <link field="child_ids"  direction="downstream" model="mi.modelo"/>
            <link field="parent_id"  direction="upstream"   model="mi.modelo"/>
            <link field="task_ids"   direction="downstream" model="project.task"/>
        </insight_graph>
    </field>
</record>
```

**Formas de nodo:** `rectangle` (predeterminado), `roundrectangle`, `diamond`, `ellipse`

**Dirección de los links:**
- `downstream` — la arista apunta *desde* el registro actual (hijos, salidas).
- `upstream` — la arista apunta *hacia* el registro actual (padres, entradas). La flecha se invierte visualmente.

### 3. Registrar el modo de vista en una acción de ventana

```xml
<record id="action_mi_modelo" model="ir.actions.act_window">
    <field name="name">Mi Modelo</field>
    <field name="res_model">mi.modelo</field>
    <field name="view_mode">insight_graph,list,form</field>
    <field name="view_ids" eval="[
        (5, 0, 0),
        (0, 0, {'view_mode': 'insight_graph',
                'view_id': ref('view_mi_modelo_insight_graph')}),
        (0, 0, {'view_mode': 'list'}),
        (0, 0, {'view_mode': 'form'}),
    ]"/>
</record>
```

### 4. Personalizar colores con variables CSS

insight_graph usa propiedades CSS custom para que puedas personalizar nodos y aristas desde el SCSS de tu módulo sin tocar ningún JavaScript. Definilas bajo el selector `.o_insight_graph_view`:

```scss
// mymodule/static/src/scss/mymodule_graph.scss

.o_insight_graph_view {
    // Colores de estado de nodo  →  --o-insight-state-{valor}-{bg|border|text}
    --o-insight-state-borrador-bg:      #fef3e8;
    --o-insight-state-borrador-border:  #e67e22;
    --o-insight-state-borrador-text:    #d35400;

    --o-insight-state-activo-bg:        #d4edda;
    --o-insight-state-activo-border:    #28a745;
    --o-insight-state-activo-text:      #155724;

    --o-insight-state-hecho-bg:         #e2e3e5;
    --o-insight-state-hecho-border:     #6c757d;
    --o-insight-state-hecho-text:       #383d41;

    // Colores de aristas  →  --o-insight-relation-{modelo-guiones}-{campo}
    --o-insight-relation-mi-modelo-child_ids:  #2563eb;
    --o-insight-relation-mi-modelo-task_ids:   #10b981;
}
```

La parte `{modelo-guiones}` reemplaza los puntos por guiones: `mi.modelo` → `mi-modelo`.

### 5. Grafos multi-modelo

insight_graph carga automáticamente **todas** las vistas `insight_graph` activas en la base de datos. Si `project.task` también tiene una vista `insight_graph` definida, esos nodos se estilizarán según la configuración de esa vista cuando aparezcan en tu grafo. Sin configuración extra — el framework lo descubre todo a través de las relaciones declaradas en los `<link>`.

### 6. Funcionalidades interactivas disponibles para los usuarios

Una vez configurada la vista, los usuarios tienen:

| Funcionalidad | Cómo |
|---|---|
| **Abrir registro** | Click en nodo → botón Formulario |
| **Eliminar registro** | Click en nodo → botón Eliminar (con confirmación) |
| **Ocultar nodo** | Click en nodo → botón Ocultar (persiste en la sesión) |
| **Vincular dos registros existentes** | Arrastrar desde un círculo de relación hacia otro nodo |
| **Crear y vincular un nuevo registro** | Arrastrar desde un círculo de relación hacia el espacio vacío |
| **Revelar nodos ocultos** | Arrastrar/click en el círculo naranja colapsado |
| **Cambiar layout** | Selector de layout en la barra (dagre, círculo, grilla, fuerza…) |
| **Tooltip al pasar el cursor** | Muestra etiqueta, estado y campos adicionales |

---

## Conclusión — Patrones y estructuras complejas

### Encontrar patrones

Una vista de grafo revela inmediatamente cosas que son invisibles en vistas de lista:

- **Registros huérfanos** — los nodos sin aristas son inmediatamente visibles como puntos aislados.
- **Nodos cuello de botella** — los registros con muchas aristas entrantes se destacan visualmente como hubs.
- **Cadenas rotas** — un camino esperado que se corta a mitad del grafo señala una relación faltante.
- **Dependencias circulares** — los ciclos en lo que debería ser un DAG son obvios en cuanto se ve una flecha que vuelve hacia atrás.

Usa la **barra de búsqueda** (soporta los filtros y favoritos existentes de Odoo) para enfocarte en un subconjunto específico del grafo. Una vista filtrada permite estudiar una rama de un pipeline complejo sin el ruido del dataset completo.

### Editar estructuras complejas

Las interacciones de arrastrar-para-vincular y arrastrar-para-crear están diseñadas para situaciones donde la estructura relacional *es* el contenido:

- **Reestructurar una jerarquía** — ocultar las partes que no necesitás, reorganizar un subárbol vinculando y desvinculando nodos, revelar los nodos ocultos cuando terminaste.
- **Construir un pipeline desde cero** — empezar desde un nodo, arrastrar al espacio vacío para crear la siguiente etapa, repetir. El sistema de contexto auto-completa la relación inversa para que los registros queden correctamente conectados sin abrir cada formulario.
- **Auditar la calidad de datos** — alternar entre `dagre-lr` (flujo horizontal) y `dagre-tb` (jerarquía vertical) para ver la estructura desde diferentes perspectivas.

---

## Licencia

Este módulo se publica bajo la licencia **LGPL-3 (GNU Lesser General Public License v3.0)**.

Sos libre de:
- **Usarlo** en cualquier proyecto, comercial o no.
- **Copiar, distribuir y modificar** el código fuente.
- **Construir módulos propietarios** que dependan de él (LGPL, no GPL).
- **Venderlo** o incluirlo en un producto de pago.

El único requisito: si modificás el módulo `insight_graph` en sí mismo, compartí esas modificaciones bajo la misma licencia.

El módulo será publicado en el **Odoo App Store** para que la comunidad pueda instalarlo directamente desde el market.

---

## Agradecimientos

### Claude Code

Gran parte de este módulo — la arquitectura, el recorrido BFS, la integración con Cytoscape, la estructura de componentes OWL, la interacción de arrastrar-para-vincular — fue diseñado y escrito con la ayuda de **[Claude Code](https://claude.ai/code)**, el asistente de programación con IA de Anthropic. Fue una colaboración inusualmente buena: del tipo en que describís un problema y recibís código funcionando que realmente querés conservar.

Si usaste herramientas de IA y te preguntaste si pueden llevar una funcionalidad frontend compleja de principio a fin en un framework no trivial como OWL de Odoo 17 — la respuesta, al menos en este caso, es sí.

### Invitá al desarrollador a un café

Si este módulo te ahorró tiempo, te ayudó a entender tus datos, o simplemente hizo tu instalación de Odoo un poco más interesante, considerá invitar al desarrollador a un café. Genuinamente ayuda a mantener vivos proyectos como este.

[![Invitame un café en cafecito.app](https://cdn.cafecito.app/imgs/buttons/button_1.svg)](https://cafecito.app/csrocha)

---

## Sumate

### Desarrolladores

Las contribuciones son bienvenidas. Abrí un pull request, reportá un issue, o hacé un fork del repo y llevalo a otro lado. Algunas áreas que se beneficiarían de ayuda:

- Algoritmos de layout adicionales o persistencia del layout entre sesiones.
- Renderizado de etiquetas en aristas (mostrar nombres de campos en las flechas).
- Exportación a SVG/PNG.
- Soporte para creación `one2many` inline sin diálogo.
- Optimizaciones de performance para grafos grandes (>500 nodos).

### Usuarios

¿Encontraste un bug? ¿Tenés una solicitud de funcionalidad? ¿Algo que debería funcionar y no funciona?
Abrí un issue en el repositorio. Cuanto más específico, mejor: nombre del modelo, configuración XML, y una descripción de lo que esperabas vs. lo que pasó.
