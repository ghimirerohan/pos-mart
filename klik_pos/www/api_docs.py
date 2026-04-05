"""Website context for Swagger UI page — always fresh (no CDN stale HTML)."""

no_cache = 1


def get_context(context):
	return context
