# -*- coding: utf-8 -*-

from odoo import fields, models


class IrActionsActWindowView(models.Model):
    _inherit = "ir.actions.act_window.view"

    view_mode = fields.Selection(
        selection_add=[("insight_graph", "Insight Graph")],
        ondelete={"insight_graph": "cascade"},
    )
