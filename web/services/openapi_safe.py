"""OpenAPI generation wrapper that never crashes the app."""

from __future__ import annotations

from typing import Any, Callable

from fastapi.openapi.utils import get_openapi


def make_safe_openapi(app, *, logger) -> Callable[[], dict[str, Any]]:
    """
    Build OpenAPI schema but never crash the app if schema generation fails.

    Some dependency combinations can make Pydantic JSON schema generation fail at runtime.
    We still want the API itself to work; docs will degrade gracefully.
    """

    def _openapi() -> dict[str, Any]:
        if getattr(app, "openapi_schema", None):
            return app.openapi_schema  # type: ignore[attr-defined]
        try:
            schema = get_openapi(
                title=str(getattr(app, "title", "API")),
                version=str(getattr(app, "version", "0")),
                routes=getattr(app, "routes", []),
            )
        except Exception as exc:  # pragma: no cover
            # Work around a Pydantic bug on some Python 3.9 builds where JSON
            # schema generation crashes with:
            # AttributeError: '_SpecialForm' object has no attribute 'replace'
            msg = str(exc)
            if isinstance(exc, AttributeError) and "SpecialForm" in msg and "replace" in msg:
                try:
                    from typing import Literal

                    from pydantic_core import core_schema
                    import pydantic.json_schema as _pydantic_json_schema
                    from typing_inspection.introspection import get_literal_values

                    vals = tuple(get_literal_values(core_schema.CoreSchemaType)) + tuple(
                        get_literal_values(core_schema.CoreSchemaFieldType)
                    )
                    _pydantic_json_schema.CoreSchemaOrFieldType = (  # type: ignore[attr-defined]
                        Literal[vals]
                    )
                    schema = get_openapi(
                        title=str(getattr(app, "title", "API")),
                        version=str(getattr(app, "version", "0")),
                        routes=getattr(app, "routes", []),
                    )
                    logger.info(
                        "OpenAPI generation recovered via Pydantic schema-type workaround."
                    )
                except Exception as exc2:
                    logger.warning("OpenAPI generation failed (after workaround): %s", exc2)
                    schema = {
                        "openapi": "3.0.0",
                        "info": {
                            "title": str(getattr(app, "title", "API")),
                            "version": str(getattr(app, "version", "0")),
                        },
                        "paths": {},
                    }
            else:
                logger.warning("OpenAPI generation failed: %s", exc)
                schema = {
                    "openapi": "3.0.0",
                    "info": {
                        "title": str(getattr(app, "title", "API")),
                        "version": str(getattr(app, "version", "0")),
                    },
                    "paths": {},
                }
        app.openapi_schema = schema  # type: ignore[attr-defined]
        return schema

    return _openapi
