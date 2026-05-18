.PHONY: lint lint-fix
lint:
	ruff check .
	ruff format --check .
	black --check web/routes web/services web/schemas.py

lint-fix:
	ruff check --fix .
	ruff format .
	black web/routes web/services web/schemas.py
