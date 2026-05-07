# -*- coding: utf-8 -*-
{
    'name': "Insight Graph",
    'version': '17.0.1.0.0',
    'category': 'Technical',
    'summary': "Generic declarative DAG/graph view type for Odoo backend",
    'description': """
        Provides the `insight_graph` view type.
        Any module can register an ir.ui.view with type="insight_graph"
        using a declarative XML arch to visualize relational data as a graph.
    """,
    'author': "Observatorio PyME",
    'depends': ['web'],
    'data': [],
    'assets': {
        'web.assets_backend': [
            'insight_graph/static/lib/dagre.min.js',
            'insight_graph/static/lib/cytoscape.min.js',
            'insight_graph/static/lib/cytoscape-dagre.min.js',
            'insight_graph/static/src/views/insight_graph_arch_parser.js',
            'insight_graph/static/src/views/insight_graph_controller.js',
            'insight_graph/static/src/views/insight_graph_controller.xml',
            'insight_graph/static/src/views/insight_graph_renderer.js',
            'insight_graph/static/src/views/insight_graph_renderer.xml',
            'insight_graph/static/src/views/insight_graph.js',
            'insight_graph/static/src/components/NodeTooltip/NodeTooltip.js',
            'insight_graph/static/src/components/NodeTooltip/NodeTooltip.xml',
            'insight_graph/static/src/scss/insight_graph.scss',
        ],
    },
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
