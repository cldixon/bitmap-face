{% if references %}
{% include "_references.md" %}

{% endif %}
{% if no_copy and references %}
{% include "_no_copy.md" %}

{% endif %}
{% if context %}
{% include "_context.md" %}

{% endif %}
{% if target == "transcribe" %}
{% include "_transcribe.md" %}
{% else %}
{% if wanted|length == 1 %}Draw this face:{% else %}Draw these {{ wanted|length }} faces:{% endif %}


{% for face in wanted %}
- {{ face.name }}: {{ face.description }}
{% endfor %}
{% endif %}
