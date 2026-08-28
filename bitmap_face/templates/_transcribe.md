{% for face in given %}
{{ face.name }}
{% for row in face.rows %}
{{ row }}
{% endfor %}

{% endfor %}
Give the hex for {% if given|length > 1 %}each grid{% else %}this grid{% endif %} above{% if given|length > 1 %}, in the order shown{% endif %}.
