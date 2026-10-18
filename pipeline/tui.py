"""tui: an interactive terminal UI for the Match Microscope pipeline.

Run it with::

    python pipeline/run_pipeline.py --tui
    python pipeline/run_pipeline.py --tui --input my-match.json --id my-match
    python pipeline/run_pipeline.py --tui --use-llm

The TUI is a thin shell over ``director.run_match``: it subscribes to the
pipeline's progress events and renders them live -- one row per job, one
streaming log. It never changes what the pipeline computes, so what you see
here is exactly what lands in ``public/data/``.

Requires the optional ``textual`` dependency (``pip install textual``).
"""

from __future__ import annotations

import contextlib
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jobs.common import load_json  # noqa: E402
from jobs.director import run_match  # noqa: E402

try:
    from textual import work
    from textual.app import App, ComposeResult
    from textual.containers import Horizontal, Vertical
    from textual.widgets import DataTable, Footer, Header, RichLog, Static
except ImportError:  # pragma: no cover - only hit without the optional dep
    sys.stderr.write(
        "The TUI needs the optional 'textual' package.\n"
        "Install it with:  pip install textual\n"
        "Then re-run:      python pipeline/run_pipeline.py --tui\n"
    )
    raise SystemExit(2)


STATUS_STYLE = {
    "ok": "green",
    "retry": "yellow",
    "failed": "red",
    "pending": "grey50",
    "running": "cyan",
}


class MatchMicroscopeTUI(App):
    """Live view of the ten pipeline jobs, one row each."""

    CSS = """
    #body { height: 1fr; }
    #left { width: 46%; border: round $accent; }
    #right { width: 1fr; border: round $accent; }
    .panel-title { background: $panel; color: $text; text-style: bold; padding: 0 1; }
    #status { dock: bottom; height: 1; padding: 0 1; background: $panel; color: $text-muted; }
    DataTable { height: 1fr; }
    RichLog { height: 1fr; }
    """

    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "rerun", "Re-run"),
    ]

    def __init__(self, use_llm=False, input_path=None, match_id=None):
        super().__init__()
        self.use_llm = use_llm
        self.input_path = input_path
        self.match_id = match_id

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal(id="body"):
            with Vertical(id="left"):
                yield Static(" JOBS", classes="panel-title")
                yield DataTable(id="jobs", zebra_stripes=True)
            with Vertical(id="right"):
                yield Static(" LIVE TRACE", classes="panel-title")
                yield RichLog(id="log", highlight=True, markup=True, wrap=True)
        yield Static(" starting…", id="status")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#jobs", DataTable)
        table.add_column("job", key="job", width=12)
        table.add_column("status", key="status", width=12)
        table.add_column("detail", key="detail")
        table.cursor_type = "row"
        self.query_one("#log", RichLog).write(
            "[b]Match Microscope[/b] — pipeline running as a live trace\n"
        )
        self._start()

    def action_rerun(self) -> None:
        self.query_one("#jobs", DataTable).clear()
        self.query_one("#log", RichLog).clear()
        self._start()

    # -- worker ------------------------------------------------------------

    def _start(self) -> None:
        self.run_pipeline_worker()

    @work(thread=True, exclusive=True)
    def run_pipeline_worker(self) -> None:
        """Resolve the match list, then run each match, reporting live."""
        try:
            matches, raw = self._resolve_matches()
        except Exception as exc:  # noqa: BLE001
            self._post("log", f"[red]cannot start: {exc}[/red]")
            self._post("status", " failed to start")
            return

        total = len(matches)
        for position, match_id in enumerate(matches, start=1):
            self._post("match_start", match_id, position, total)
            buffer = io.StringIO()
            try:
                with contextlib.redirect_stdout(buffer):
                    run_match(
                        match_id,
                        use_llm=self.use_llm,
                        raw=raw,
                        on_event=lambda event, m=match_id: self._post("event", event, m),
                    )
            except Exception as exc:  # noqa: BLE001
                self._post("log", f"[red]{match_id}: aborted — {exc}[/red]")
                continue
            self._post(
                "log",
                f"[green]✔[/green] {match_id} written to public/data/",
            )
        self._post("status", f" done — {total} match(es) processed")

    def _resolve_matches(self):
        """Return (match_ids, raw_payload). raw is only set for --input."""
        if self.input_path:
            # Reuse the exact registration logic the plain CLI uses.
            from run_pipeline import _register_in_index, _resolve_input

            raw = _resolve_input(self.input_path)
            match_id = self.match_id or raw["match"].get("id") or "custom"
            raw["match"]["id"] = match_id
            from jobs.common import save_json

            save_json(f"match-{match_id}.json", raw)
            _register_in_index(raw)
            return [match_id], raw
        if self.match_id and self.match_id != "all":
            return [self.match_id], None
        index = load_json("index.json")
        return [m["id"] for m in index["matches"]], None

    # -- thread-safe UI updates -------------------------------------------

    def _post(self, kind, *payload) -> None:
        """Marshal a worker-thread update onto the UI thread."""
        self.call_from_thread(self._apply, kind, *payload)

    def _apply(self, kind, *payload) -> None:
        if kind == "log":
            self.query_one("#log", RichLog).write(payload[0])
        elif kind == "status":
            self.query_one("#status", Static).update(payload[0])
        elif kind == "match_start":
            match_id, position, total = payload
            table = self.query_one("#jobs", DataTable)
            table.clear()
            log = self.query_one("#log", RichLog)
            log.write(f"\n[b cyan]▶ {match_id}[/b cyan]  ({position}/{total})")
            for job in JOB_NAMES:
                table.add_row(
                    job,
                    "[grey50]pending[/grey50]",
                    "",
                    key=f"{match_id}:{job}",
                )
        elif kind == "event":
            self._apply_event(*payload)

    def _apply_event(self, event, match_id) -> None:
        table = self.query_one("#jobs", DataTable)
        log = self.query_one("#log", RichLog)
        etype = event.get("type")

        def set_row(job, status, detail):
            key = f"{match_id}:{job}"
            try:
                table.update_cell(key, "status", status, update_width=True)
                table.update_cell(key, "detail", detail, update_width=True)
            except Exception as exc:  # noqa: BLE001 - surface, don't crash the UI
                log.write(f"[red]table update failed for {key}: {exc}[/red]")

        if etype == "job_start":
            set_row(event["job"], f"[cyan]running…[/cyan]", "")
        elif etype == "job_retry":
            set_row(
                event["job"],
                f"[yellow]retry {event['attempt']}[/yellow]",
                "[yellow]inference failed, retrying…[/yellow]",
            )
            log.write(
                f"  [yellow]↻[/yellow] {event['job']} retry {event['attempt']}: "
                f"{event['detail']}"
            )
        elif etype == "agent_start":
            log.write(
                "  [magenta]◆ agents[/magenta] engaged: "
                + ", ".join(event["crew"])
            )
        elif etype == "agent_step":
            count = event.get("drafts") or event.get("verdicts") or event.get("decided")
            log.write(f"    [magenta]→ {event['agent']}[/magenta]  ({count})")
        elif etype == "job_done":
            status = event["status"]
            tone = STATUS_STYLE.get("retry" if status.startswith("retry") else status, "white")
            detail = event["detail"]
            set_row(event["job"], f"[{tone}]{status}[/{tone}]", detail)
            mark = {"ok": "●", "failed": "✖"}.get(status, "↻")
            log.write(f"  [{tone}]{mark}[/{tone}] [b]{event['job']}[/b]  {detail}")
        elif etype == "match_done":
            self.query_one("#status", Static).update(f" {match_id}: trace written")


JOB_NAMES = [
    "ingest",
    "tracker",
    "pressure",
    "lanes",
    "space",
    "charts",
    "explain",
    "verify",
    "personalize",
    "director",
]


def main():  # pragma: no cover - convenience entry
    MatchMicroscopeTUI().run()


if __name__ == "__main__":
    main()
