"""CSV exports (usage, ledger, activity, payments)."""

import csv
import io
from collections.abc import AsyncIterator, Sequence

from fastapi.responses import StreamingResponse


def csv_cell(value: object) -> str:
    text = "" if value is None else str(value)
    # Neutralise spreadsheet formula injection.
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def csv_stream(
    header: list[str], rows: Sequence[Sequence[object]], filename: str
) -> StreamingResponse:
    async def generate() -> AsyncIterator[str]:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(header)
        for row in rows:
            writer.writerow([csv_cell(v) for v in row])
            if buf.tell() > 64_000:
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate()
        yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
