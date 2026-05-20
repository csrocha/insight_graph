# CHANGELOG

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/).
Versionado: `17.0.MAYOR.MENOR.PARCHE`.

Cada entrada de version incluye el **prompt** que motivo los cambios
y las **discusiones de diseno** relevantes que influyeron en las decisiones,
para trazabilidad completa del razonamiento de agentes de IA.

---

## [17.0.1.0.0] - 2026-05-18

### Prompt

> Me gusta el patron de CHANGELOG.md para replicarlo en el resto de los modulos.
> Podrias agregarlo en AGENTS.md y agregar un CHANGELOG.md que empiece a partir
> de este cambio?
>
> Estoy hablando de los addons que son submodulos de fop-odoo, no otros.
>
> Unifica el formato de las versiones para que sigan el formato de los addons de Odoo.

### Discusion de diseno

- **Adopcion del patron CHANGELOG**: el modulo `fop_encuestas_portal` establecio
  la convencion de registrar en el CHANGELOG tanto el prompt como las discusiones
  de diseno (alternativas evaluadas, decisiones tomadas, motivos de descarte).
  Se replica aqui para mantener trazabilidad uniforme en todos los submodulos de `fop-odoo`.
- **AGENTS.md minimo con enlace a directrices base**: en lugar de duplicar las
  reglas generales de Observatorio PyME en cada addon, se mantiene un AGENTS.md
  local con el checklist especifico y un enlace al AGENTS.md canonico de `fop_odoo_theme`.


### Anadido

- `AGENTS.md`: directrices para agentes de IA con checklist pre-commit,
  incluyendo la obligacion de documentar discusiones de diseno en el CHANGELOG.
- `CHANGELOG.md`: este archivo. Primera entrada registrando la adopcion del
  patron de trazabilidad de cambios.
