# DESIGN.md — insight_graph

## 1. Propósito y Alcance

Tipo de vista genérico para Odoo 17 que renderiza cualquier modelo como un **grafo
dirigido acíclico (DAG)** usando **Cytoscape.js**. La arquitectura del grafo se define
declarativamente en XML (arch de `ir.ui.view`), sin código Python por parte del módulo
consumidor. Permite navegar relaciones entre registros, crear/vincular registros
directamente en el grafo y exportar a GraphML.

## 2. Arquitectura General

```
insight_graph/
├── models/
│   ├── ir_actions.py        # Registra "insight_graph" en ir.actions.act_window.view
│   └── ir_ui_view.py        # Registra "insight_graph" como tipo de ir.ui.view
└── static/src/
    ├── views/
    │   ├── insight_graph.js             # Registro del view type en el registry
    │   ├── insight_graph_arch_parser.js # Parser XML → config JS
    │   ├── insight_graph_controller.js  # OWL Controller (lógica de datos + BFS)
    │   ├── insight_graph_controller.xml # Template OWL del controller
    │   ├── insight_graph_renderer.js    # OWL Renderer (Cytoscape.js + overlays)
    │   └── insight_graph_renderer.xml  # Template OWL del renderer
    ├── components/
    │   ├── NodeTooltip.js / .xml       # Tooltip al hacer hover sobre nodo
    │   └── NodeContextMenu.js / .xml   # Menú contextual con círculos de relación
    ├── search/
    │   └── pinned_nodes_menu.js        # Menú de nodos fijados en SearchBarMenu
    ├── utils/
    │   └── insight_graph_pins.js       # Persistencia de pins en localStorage
    └── scss/
        └── insight_graph.scss
```

## 3. Modelos Python

Ambos modelos son extensiones mínimas que registran el nuevo tipo de vista:

**IrActionsActWindowView** (hereda `ir.actions.act_window.view`):
- Agrega `"insight_graph"` a la selección de `view_mode`

**IrUiView** (hereda `ir.ui.view`):
- Agrega `"insight_graph"` al campo `type`

No hay campos propios, ni métodos, ni ACL adicionales.

## 4. Registro del Tipo de Vista

**Archivo:** `static/src/views/insight_graph.js`

```javascript
export const insightGraphView = {
    type: "insight_graph",
    display_name: "Insight Graph",
    icon: "fa fa-share-alt",
    multiRecord: true,
    Controller: InsightGraphController,
    Renderer: InsightGraphRenderer,
    ArchParser: InsightGraphArchParser,
    searchMenuTypes: ["filter", "favorite"],
};
registry.category("views").add("insight_graph", insightGraphView);
```

## 5. Parser de Arch XML (InsightGraphArchParser)

**Archivo:** `static/src/views/insight_graph_arch_parser.js`

Convierte el XML del arch en un objeto de configuración JavaScript.

### 5.1 Formato del Arch

```xml
<insight_graph>
    <!-- Nodo: atributos shape, width, height -->
    <node shape="rectangle|diamond|octagon|roundrectangle|ellipse"
          width="180" height="120">
        <!-- Modo campo simple: -->
        <field name="display_name" primary="true"/>
        <field name="state" color="true"/>
        <field name="amount" type="monetary" currency_field="currency_id"/>
        <field name="some_field" invisible="state == 'draft'"/>
        <field name="image_128" type="image"/>

        <!-- Modo template HTML (si hay elementos no-<field> en <node>): -->
        <div class="...">
            <field name="name" primary="true"/>
            <field name="image_128" type="image" class="..." style="..."/>
        </div>
    </node>

    <!-- Botones de acción -->
    <button name="action_validate" type="object" class="oe_highlight"
            icon="fa-play" title="Validate" invisible="state != 'draft'"/>

    <!-- Relaciones: upstream = la relación apunta hacia el padre,
                     downstream = la relación apunta hacia los hijos -->
    <link field="parent_id" direction="upstream" model="res.partner"/>
    <link field="child_ids" direction="downstream" model="res.partner"/>
</insight_graph>
```

### 5.2 Config resultante

```javascript
{
    shape: string,
    primaryField: string,
    colorField: string | null,
    imageField: string | null,
    nodeFields: [{ name, primary, color, invisible, monetary, currencyField }],
    links: [{ field, direction, model, fieldString }],
    buttons: [{ name, type, btnClass, icon, title, invisible }],
    invisibleFields: string[],
    nodeWidth: number,
    nodeHeight: number,
    nodeTemplate: string | null,   // HTML serializado para modo template
    stateLabels: { [value]: label } // etiquetas de selección para colorField
}
```

**Reglas de parsing:**
- `invisible="true"` / `"1"` / `"yes"` → siempre oculto; cualquier otro valor → expresión booleana evaluada con datos del nodo
- `primary="true"` → campo mostrado como etiqueta principal del nodo
- `color="true"` → estado que determina el color de fondo del nodo; `stateLabels` se carga por el Controller via RPC
- `type="image"` → campo renderizado como imagen base64 en la parte superior del nodo
- `type="monetary"` → formateado con símbolo de moneda
- Si `<node>` contiene elementos HTML además de `<field>` → modo template; Cytoscape muestra el nodo vacío y un overlay DOM lo cubre

## 6. Controller (InsightGraphController)

**Archivo:** `static/src/views/insight_graph_controller.js`

OWL Controller estándar de Odoo. Gestiona datos, BFS y callbacks de interacción.

### 6.1 Estado interno

```javascript
{
    loading: boolean,
    error: string | null,
    graphData: { nodes[], edges[], nodeLegend, edgeLegend },
    modelConfigs: { [model]: parsedArch },
    selectionInfo: { count, buttons, selectedNodes } | null
}
```

### 6.2 Método principal: `_loadGraphData(domain)`

1. Busca todas las vistas `insight_graph` disponibles para cada modelo relacionado
2. Parsea el arch XML de cada vista con `InsightGraphArchParser`
3. Carga metadata de campos (labels para `fieldString`, opciones de selección para `colorField`) via RPC
4. **BFS graph traversal:**
   - Wave 0: registros primarios del modelo principal (filtrados por `domain`)
   - Wave N+1: registros relacionados descubiertos via los `links` del arch
   - Continúa hasta que no hay nuevas waves
5. Inyecta nodos fijados (pins) desde `localStorage` aunque no estén en el BFS
6. Construye arrays `nodes[]` y `edges[]` para Cytoscape
7. Construye leyendas (`nodeLegend`, `edgeLegend`)

### 6.3 Callbacks de interacción

| Callback | Descripción |
|----------|-------------|
| `onOpenForm(nodeData)` | Abre vista de formulario del nodo |
| `onDeleteNode(nodeData)` | Confirma y desvincula (unlink) el registro |
| `onLinkNodes(src, tgt, linkDef)` | Escribe campo de relación para vincular dos nodos |
| `onPinNode / onUnpinNode` | Persiste en localStorage y recarga el grafo |
| `onCreateAndLink` | Abre `FormViewDialog` con contexto pre-rellenado |
| `onExecuteAction(model, resIds, btnDef)` | Ejecuta método server-side en selección |
| `onExportGraphML()` | Genera y descarga archivo GraphML |
| `onSelectionBarAction` / `onDeleteSelectedNodes` / `onPinSelectedNodes` | Acciones multi-selección |

## 7. Renderer (InsightGraphRenderer)

**Archivo:** `static/src/views/insight_graph_renderer.js`

OWL Renderer que inicializa y gestiona la instancia Cytoscape.js.

### 7.1 Setup de Cytoscape

- **Elementos:** nodos (con `data`: todos los campos del registro) + aristas (source/target/lineColor)
- **Estilos:** por selector (shape, color de estado, imagen de fondo, selección, oculto, fijado)
- **Layout:** Dagre LR (por defecto), Circle, Concentric, BreadthFirst, Grid, Cose
- **Bibliotecas:** `cytoscape.min.js` + `dagre.min.js` + `cytoscape-dagre.min.js`

### 7.2 Capa de overlay HTML (modo template)

Para nodos en modo template (con HTML en el arch):
1. Crea divs DOM posicionados absolutamente sobre el canvas Cytoscape
2. Sincroniza posición via CSS transform en cada evento pan/zoom/layout
3. Reemplaza placeholders `<field>` por valores reales del nodo:
   - `data-ig-field` → valor del campo como texto
   - `data-ig-image` → `src` con base64 del campo imagen

### 7.3 Menú contextual (círculos de relación)

- Posicionado en la parte inferior del nodo seleccionado
- Un círculo por cada `<link>` definido en el arch
- **Estado colapsado** (naranja sólido, "+") → nodos relacionados ocultos; clic para mostrar
- **Estado vacío** (azul punteado) → nodos relacionados visibles; drag para vincular o crear

### 7.4 Tooltips

- Hover sobre nodo no seleccionado → `NodeTooltip` con etiqueta + campos no primarios
- Se suprime con nodo seleccionado o durante drag

### 7.5 Multi-selección y barra de acciones

- Click → selecciona solo ese nodo
- Shift+click → toggle en multi-selección
- Shift+drag → box select
- Barra de selección aparece con botones de acción filtrados por modelo y expresiones `invisible`

### 7.6 Controles de layout y zoom

- Dropdown selector de algoritmos de layout
- Zoom in/out, zoom to selected, fit to screen
- Animación de layout: 350ms `ease-in-out-cubic`

## 8. Persistencia de Pins (insight_graph_pins.js)

**Clave localStorage:** `"o_insight_graph_pins"`

**API:**
- `getPins()` → `{ [model]: { [resId]: label } }`
- `pinNode(model, resId, label)` → agrega pin
- `unpinNode(model, resId)` → elimina pin
- `isPinnedNode(model, resId)` → boolean

Los pins persisten entre sesiones del navegador. El BFS inyecta nodos fijados
incluso si no están en el dominio activo.

## 9. Menú de Nodos Fijados (pinned_nodes_menu.js)

Componente OWL inyectado en `SearchBarMenu` via herencia de template.
- Muestra lista de nodos fijados con filtro de búsqueda
- Click en un pin → centra el grafo en ese nodo via callback `igCenterOnNode`
- Solo visible cuando hay pins activos

## 10. Decisiones de Diseño

**Declarativo XML en lugar de código:**
El arch define completamente la topología del grafo (campos, relaciones, botones) sin
necesidad de código Python o JS por parte del módulo consumidor. El parser convierte
el XML a una config JS que el renderer interpreta.

**BFS en lugar de carga completa:**
Con relaciones profundas, cargar todo el grafo sería ineficiente. El BFS por waves
permite controlar la profundidad y carga incremental.

**Overlay DOM para templates HTML:**
Cytoscape.js renderiza en canvas y no soporta HTML nativo en nodos. El overlay DOM
sincronizado via CSS transform es el patrón estándar para templates ricos.

**Pins en localStorage:**
Los pins son una preferencia de navegación del usuario, no datos de negocio.
`localStorage` es el almacenamiento adecuado: no requiere endpoints backend,
persiste entre sesiones y no contamina la base de datos.

**Círculos de relación en lugar de menú contextual clásico:**
Los círculos son más intuitivos en un grafo: indican visualmente que hay relaciones
disponibles y permiten drag-to-link como interacción natural.

**GraphML export:**
Permite importar el grafo en herramientas externas (yEd, Gephi) para análisis
adicional sin depender de Odoo.
