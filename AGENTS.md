# insight_graph — Módulo de Vista en Grafo DAG para Odoo

## Objetivo

`insight_graph` es un módulo técnico genérico que introduce un nuevo tipo de vista en Odoo: una visualización interactiva de datos como grafo dirigido acíclico (DAG). El objetivo es poder representar cualquier modelo y sus relaciones como nodos y aristas en un diagrama navegable, sin necesidad de escribir código JavaScript específico para cada caso de uso. La configuración se realiza de forma **declarativa** mediante XML, igual que cualquier otra vista de Odoo (form, list, kanban).

El módulo fue creado para satisfacer la necesidad del módulo `survey_insights_manager` de visualizar el pipeline de indicadores (providers → columns → calculations), pero está diseñado como una herramienta reutilizable y agnóstica al dominio.

---

## Funcionalidades

### Vista declarativa tipo `insight_graph`

Registra un nuevo tipo de vista en Odoo que puede referenciarse desde cualquier `ir.actions.act_window`. La arquitectura XML de la vista define:

- **`<node>`**: cómo representar los registros del modelo principal (forma del nodo, campo de etiqueta, campo de color/estado).
- **`<link>`**: qué campos relacionales seguir para construir el grafo (dirección `downstream` o `upstream`, modelo destino).

### Carga automática de múltiples modelos

El controlador descarga **todas** las vistas `insight_graph` activas en la base de datos y construye un grafo que puede abarcar múltiples modelos. No es necesario configurar manualmente qué modelos participan — el sistema los descubre a través de las relaciones declaradas en cada vista.

### Traversal BFS de relaciones

A partir de los registros del modelo primario (filtrados por el dominio de búsqueda), el controlador realiza un recorrido en amplitud (BFS) siguiendo los campos `<link>` de cada vista, cargando registros relacionados de forma iterativa hasta agotar todas las relaciones alcanzables.

### Renderizado interactivo con Cytoscape.js

El grafo se renderiza con [Cytoscape.js](https://cytoscape.org/) usando el plugin `cytoscape-dagre` para el layout DAG. El usuario puede:

- **Seleccionar nodos**: muestra un menú de contexto con acciones.
- **Abrir el formulario**: navegar al registro en una vista form estándar de Odoo.
- **Eliminar el registro**: con confirmación, desvincula el registro del grafo y la base de datos.
- **Ocultar nodos**: elimina visualmente nodos del grafo en la sesión actual.
- **Vincular nodos**: arrastrando desde un círculo de relación hacia otro nodo existente, se escribe la relación en la base de datos.
- **Crear y vincular**: arrastrando desde un círculo de relación hacia el espacio vacío, se abre un `FormViewDialog` para crear un nuevo registro relacionado.
- **Revelar nodos ocultos**: los círculos de relación con nodos ocultos se muestran en naranja; arrastrando o haciendo clic sobre ellos se revelan.

### Múltiples layouts

El usuario puede cambiar el algoritmo de layout en tiempo real:
- `dagre-lr` (izquierda→derecha, predeterminado)
- `dagre-tb` (arriba→abajo)
- `circle`, `concentric`, `breadthfirst`, `grid`, `cose`

### Tooltip y contexto visual

- **Tooltip**: al pasar el cursor sobre un nodo muestra etiqueta, estado y campos adicionales.
- **Leyendas**: barra superior con leyenda de modelos (forma + nombre) y leyenda de tipos de aristas (color + campo).
- **Colores de estado y aristas**: completamente temizables mediante variables CSS custom, sin necesidad de modificar el código.

---

## Implementación

### Estructura

```
insight_graph/
├── models/
│   ├── ir_ui_view.py          # Registra "insight_graph" como tipo de vista válido
│   └── ir_actions.py          # Registra "insight_graph" como modo de vista válido
└── static/src/
    ├── views/
    │   ├── insight_graph.js                # Registro del view type en el registry de Odoo
    │   ├── insight_graph_arch_parser.js    # Parser del XML de arquitectura
    │   ├── insight_graph_controller.js     # Carga de datos, construcción del grafo, acciones ORM
    │   ├── insight_graph_controller.xml    # Template del controlador
    │   ├── insight_graph_renderer.js       # Cytoscape, interacciones, overlays OWL
    │   └── insight_graph_renderer.xml      # Template del renderer
    ├── components/
    │   ├── NodeContextMenu/               # Menú de contexto sobre el nodo seleccionado
    │   └── NodeTooltip/                   # Tooltip en hover
    └── scss/
        └── insight_graph.scss             # Estilos y variables CSS
```

### Backend (Python)

Son únicamente dos modelos que extienden los registros de Odoo para aceptar el nuevo tipo:

- **`ir.ui.view`** — agrega `"insight_graph"` al campo `type`.
- **`ir.actions.act_window.view`** — agrega `"insight_graph"` al campo `view_mode`.

No hay modelos propios, ni tablas nuevas. El módulo no almacena datos.

### Parser de arquitectura (`insight_graph_arch_parser.js`)

Lee el XML de la vista y produce un objeto de configuración:

```javascript
{
    shape: "rectangle",          // Forma del nodo: rectangle, diamond, ellipse, roundrectangle
    primaryField: "display_name",
    colorField: "state",
    nodeFields: [{ name, primary, color }],
    links: [{ field, direction, model }]
}
```

### Controlador (`insight_graph_controller.js`)

El método central es `_loadGraphData(domain)`:

1. Carga todos los `ir.ui.view` con `type = "insight_graph"`.
2. Parsea cada arquitectura y agrupa las configuraciones por modelo (`modelConfigs`).
3. Recupera los registros del modelo primario filtrados por el dominio.
4. Ejecuta un BFS: cada "ola" extrae los IDs de los campos `<link>`, realiza un `search_read` para el modelo destino, y encola los nuevos registros para la siguiente ola.
5. Construye el array `nodes` con metadatos (label, shape, flowState, tooltipFields, isPrimary).
6. Construye el array `edges` con deduplicación por dirección visual (`src→tgt`).
7. Genera las leyendas de modelos y aristas.
8. Almacena el resultado en el estado reactivo de OWL.

### Renderer (`insight_graph_renderer.js`)

Gestiona la instancia de Cytoscape y todos los overlays OWL:

- Al montar (`onMounted`), inicializa Cytoscape en el elemento DOM con elementos y estilos, luego adjunta los event listeners.
- Al actualizar (`onPatched`), si cambian los datos del grafo reinicializa Cytoscape; si solo cambia el layout, anima la transición.
- Usa un `ResizeObserver` para ajustar la altura del canvas al viewport.
- Los colores de nodos y aristas se resuelven leyendo variables CSS custom del DOM con `getComputedStyle`.
- El menú de contexto se posiciona usando `node.renderedBoundingBox()` de Cytoscape, y se actualiza en cada evento `viewport` (pan/zoom).

---

## Tomas de decisiones

### Por qué Cytoscape.js

Cytoscape es la librería de grafos más madura para JavaScript. Tiene soporte nativo para DAG a través del plugin `cytoscape-dagre`, múltiples algoritmos de layout intercambiables, y una API estable para styling, eventos e interacciones. Se empaquetaron las tres librerías como archivos `.min.js` en `static/lib/` para evitar dependencias de build (npm/webpack), coherente con la forma en que Odoo maneja librerías externas.

### Por qué BFS y no recursión

El traversal de relaciones usa un loop iterativo con un `Map` de sets pendientes en lugar de recursión, para evitar stack overflows en grafos profundos y mantener control preciso sobre qué registros ya fueron visitados. La clave de visita es `"model::id"`, evitando cargar el mismo registro dos veces aunque sea referenciado desde múltiples nodos.

### Por qué deduplicación de aristas por dirección visual

Un `<link>` con `direction="upstream"` significa que la arista debe mostrarse como `relacionado → primario` aunque la relación en la base de datos sea `primario.parent_id`. Sin deduplicación, una relación bidireccional (parent_id + child_ids) generaría dos aristas solapadas. La solución es normalizar todas las aristas a `src→tgt` según la dirección visual antes de deduplicar por clave.

### Por qué configuración por CSS variables y no por props

Los colores de estados y tipos de aristas se definen como variables CSS custom (`--o-insight-state-{value}-bg`, etc.) que el módulo consumidor sobreescribe en su propio SCSS. Esto desacopla el módulo técnico del dominio semántico (no tiene que saber qué significa `state = "draft"`), permite theming sin modificar código JS, y es coherente con el sistema de diseño de Odoo 17.

### Por qué closures en lugar de estado OWL durante el drag

Durante el drag de vinculación, los datos del nodo origen y la definición de link se capturan en variables de closure al inicio del drag, y no se leen del estado reactivo de OWL. La razón: cuando OWL re-renderiza durante el drag (al actualizar `linkingState`), los proxies de los objetos de estado anteriores son revocados y lanzarían errores al acceder a ellos. Los closures garantizan acceso estable a los datos del inicio del drag.

### Por qué descubrir el campo inverso automáticamente en `_buildCreateContext`

Cuando el usuario crea un registro nuevo desde el drag, el sistema necesita pre-rellenar la relación inversa para que el nuevo registro quede vinculado. En lugar de requerir que el autor de la vista XML lo declare explícitamente, el controlador lo descubre automáticamente: primero busca en `edgeLegend` si existe una arista inversa registrada, y si no, recorre los campos del modelo destino buscando un Many2one que apunte al modelo origen. Esto reduce la configuración necesaria en el XML.

### Por qué nodos ocultos son estado del renderer (no del controlador)

La visibilidad de nodos es una preferencia de presentación, no un filtro de datos. Los nodos ocultos persisten en `this.state.hiddenNodes` del renderer (sobreviven a recargas del grafo dentro de la sesión) pero se resetean al desmontar el componente. Mantener este estado en el renderer evita que el controlador mezcle lógica de datos con lógica de presentación.

### Por qué el módulo es genérico y no específico al pipeline de indicadores

Aunque el caso de uso original fue visualizar el pipeline de `survey_insights_manager`, se tomó la decisión de implementarlo como un módulo técnico reutilizable. Esto permite que cualquier otro módulo de Odoo agregue una vista de grafo a cualquier modelo simplemente declarando un XML, sin escribir JavaScript. El costo adicional de generalización fue mínimo comparado con el valor de tener una herramienta reusable.

---

## Ejemplo de uso

**Definir la vista:**

```xml
<record id="view_my_model_insight_graph" model="ir.ui.view">
    <field name="name">my.model.insight.graph</field>
    <field name="model">my.model</field>
    <field name="type">insight_graph</field>
    <field name="arch" type="xml">
        <insight_graph>
            <node shape="roundrectangle">
                <field name="display_name" primary="true"/>
                <field name="state" color="true"/>
                <field name="responsible_id"/>
            </node>
            <link field="child_ids" direction="downstream" model="my.model"/>
            <link field="parent_id" direction="upstream" model="my.model"/>
            <link field="task_ids" direction="downstream" model="project.task"/>
        </insight_graph>
    </field>
</record>
```

**Registrar en la acción:**

```xml
<field name="view_mode">insight_graph,list,form</field>
```

**Personalizar colores en el SCSS del módulo consumidor:**

```scss
.o_insight_graph_view {
    --o-insight-state-draft-bg: #fef3e8;
    --o-insight-state-draft-border: #e67e22;
    --o-insight-state-done-bg: #d4edda;
    --o-insight-state-done-border: #28a745;
    --o-insight-relation-my-model-child_ids: #2563eb;
}
```
