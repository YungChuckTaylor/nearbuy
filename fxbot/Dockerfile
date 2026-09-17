# One process, 24/5: the long-lived worker.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=UTC

WORKDIR /app

# deps first so code changes don't invalidate the layer
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY fxbot/ ./fxbot/
COPY deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV PYTHONPATH=/app
VOLUME ["/app/data"]

CMD ["./entrypoint.sh"]
