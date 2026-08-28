{% if reference_set == "shapes" %}
Here are patterns in both forms, so you can see how a grid is written as hex:
{% else %}
Here are real faces from the Mac ROM, in both forms, so you can see the house style:
{% endif %}
{% for ref in references %}

{{ ref.name }}
{% for row in ref.rows %}
{{ row.grid }}  {{ row.hex }}
{% endfor %}
{% endfor %}
