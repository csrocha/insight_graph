# AGENTS.md - Directrices de Desarrollo para Agentes de IA

**Modulo**: Insight Graph
**Proposito**: Tipo de vista DAG/grafo declarativo generico para el backend de Odoo.
**Version actual**: 17.0.1.0.0 | **Entorno**: Odoo 17, rama `develop`

Para las directrices generales de desarrollo de modulos Odoo en Observatorio PyME,
ver el [AGENTS.md de fop_odoo_theme](https://github.com/observatoriopyme/fop_odoo_theme/blob/develop/AGENTS.md).

## Checklist Pre-commit

- [ ] `__manifest__.py` version en formato `17.0.X.Y.Z` e incrementada correctamente
      (Z para correcciones menores, Y para cambios funcionales significativos)
- [ ] `__init__.py` importa todos los subdirectorios con modulos nuevos
- [ ] Nuevos modelos tienen su entrada en `security/ir.model.access.csv`
- [ ] No se usa SQL crudo salvo necesidad justificada de performance
- [ ] Los templates XML usan `t-out` (no `t-esc`) para Odoo 17

## Actualización de CHANGELOG (obligatorio)

**Antes de cada commit**, agregar una entrada en `CHANGELOG.md` siguiendo el
formato y las reglas definidas en la **Sección 17 del AGENTS.md raíz** de `fop-odoo`.

No es un checkbox opcional: sin entrada en CHANGELOG no se completa el commit.
