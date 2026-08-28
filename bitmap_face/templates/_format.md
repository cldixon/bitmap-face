{%- if target == "transcribe" -%}
You are given a face as a grid. Return its hex.

{% include "_hex_rule.md" %}

In the grid, "{{ filled }}" is a set pixel and "{{ empty }}" is an empty one.
{%- elif target == "both" -%}
You give each face in two forms, and they must describe the same pixels.

1. {% include "_grid_rule.md" %}
2. {% include "_hex_rule.md" %}

Draw the grid first, then read the hex off it row by row.
{%- elif target == "grid_only" -%}
You give each face as a grid.

{% include "_grid_rule.md" %}
{%- elif target == "hex_only" -%}
You give each face directly as hex, without drawing a grid first.

{% include "_hex_rule.md" %}
{%- endif -%}
