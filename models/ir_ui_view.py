# -*- coding: utf-8 -*-

from odoo import fields, models


class IrUiView(models.Model):
    _inherit = "ir.ui.view"

    type = fields.Selection(
        selection_add=[("insight_graph", "Insight Graph")],
        ondelete={"insight_graph": "cascade"},
    )
