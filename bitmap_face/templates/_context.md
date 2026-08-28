Faces you have already drawn in this set. Keep the same construction -- eye placement, weight, spacing -- so the set hangs together:
{% for face in context %}

{{ face.name }}
{% for row in face.rows %}
{{ row }}
{% endfor %}
{% endfor %}
