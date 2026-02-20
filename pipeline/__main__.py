"""CLI entry point for the monument onboarding pipeline.

Usage:
    python -m pipeline "Humayun's Tomb"
    python -m pipeline "Humayun's Tomb" "Red Fort" --force-fetch
    python -m pipeline --file monuments.txt
    python -m pipeline "Humayun's Tomb" --validate-only
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

import click
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from pipeline.config import DATA_DIR, LOGS_DIR, RAW_DIR, BUNDLES_DIR


def _setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(message)s",
        handlers=[logging.StreamHandler(sys.stderr)],
    )


@click.command()
@click.argument("monuments", nargs=-1)
@click.option("--file", "file_path", type=click.Path(exists=True), help="File with monument names, one per line.")
@click.option("--skip-fetch", is_flag=True, help="Skip fetching, use cached raw data.")
@click.option("--force-fetch", is_flag=True, help="Re-fetch all sources even if cached.")
@click.option("--validate-only", is_flag=True, help="Only validate existing bundles.")
@click.option("--verbose", "-v", is_flag=True, help="Enable debug logging.")
def main(
    monuments: tuple[str, ...],
    file_path: str | None,
    skip_fetch: bool,
    force_fetch: bool,
    validate_only: bool,
    verbose: bool,
) -> None:
    """Onboard monument data into tour bundles."""
    _setup_logging(verbose)

    # Ensure data directories exist
    for d in [DATA_DIR, RAW_DIR, BUNDLES_DIR, LOGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    # Collect monument names
    names: list[str] = list(monuments)
    if file_path:
        with open(file_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    names.append(line)

    if not names:
        click.echo("Error: provide monument names as arguments or via --file", err=True)
        sys.exit(1)

    click.echo(f"Onboarding {len(names)} monument(s)...\n")

    asyncio.run(_run_all(names, skip_fetch, force_fetch, validate_only))


async def _run_all(
    names: list[str],
    skip_fetch: bool,
    force_fetch: bool,
    validate_only: bool,
) -> None:
    from pipeline.onboard import onboard_monument

    results: list[tuple[str, bool, str]] = []

    for name in names:
        try:
            bundle = await onboard_monument(
                name,
                skip_fetch=skip_fetch,
                force_fetch=force_fetch,
                validate_only=validate_only,
            )
            results.append((name, True, f"{len(bundle.spots)} spots, {bundle.route.total_tour_minutes:.0f} min tour"))
        except Exception as e:
            logging.getLogger(__name__).exception("Failed to onboard '%s'", name)
            results.append((name, False, str(e)))

    # Summary
    click.echo("\n" + "=" * 60)
    click.echo("Summary:")
    for name, success, detail in results:
        status = "OK" if success else "FAILED"
        click.echo(f"  [{status}] {name}: {detail}")


if __name__ == "__main__":
    main()
