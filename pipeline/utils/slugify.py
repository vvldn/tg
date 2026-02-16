"""Name to URL-safe slug conversion."""

from slugify import slugify as _slugify


def make_slug(name: str) -> str:
    """Convert a monument or spot name to a URL-safe slug."""
    return _slugify(name, lowercase=True)
